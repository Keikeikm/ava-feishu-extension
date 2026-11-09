const path = require('node:path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {
  BitableAppWebpackPlugin,
  opdevMiddleware,
} = require('@lark-opdev/block-bitable-webpack-utils');
const runtime = require('./runtime.config.json');
const developmentProxy = require('../scripts/dev-proxy.cjs');
const pluginDisplayName = require('../scripts/plugin-display-name.cjs');

module.exports = (_env, argv) => {
  // The official plugin checks NODE_ENV to emit the opdev deployment manifests.
  process.env.NODE_ENV = argv.mode || 'production';
  const debugPort = Number(process.env.FEISHU_DEBUG_PORT ?? 8080);
  const managed = argv.mode === 'development' && process.env.AVA_DEV_PROXY === '1';
  const localProxy = managed
    ? developmentProxy(process.env.AVA_DEV_API_ORIGIN, process.env.PLUGIN_ACCESS_TOKEN, debugPort)
    : null;
  const apiOrigin =
    argv.mode === 'development'
      ? managed
        ? `http://localhost:${debugPort}`
        : process.env.AVA_DEV_API_ORIGIN || runtime.apiOrigin
      : runtime.apiOrigin;
  let debugBaseUrl = '';
  if (argv.mode === 'development') {
    const tableUrl = new URL(require('./block.json').url);
    tableUrl.searchParams.set('debugPort', String(debugPort));
    debugBaseUrl = tableUrl.href;
  }
  return {
    context: __dirname,
    entry: { index: path.resolve(__dirname, '../src/plugin.tsx') },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].[contenthash:8].js',
      // Feishu's debug middleware treats this as a literal URL path.
      // Production keeps automatic asset paths for Feishu's hosted bundle.
      publicPath: argv.mode === 'development' ? '/' : 'auto',
      clean: true,
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        // AntV publishes extensionless ESM imports; resolve its bundle like Vite/Next.js.
        { test: /\.m?js$/, resolve: { fullySpecified: false } },
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true, compilerOptions: { noEmit: false } },
          },
        },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: path.resolve(__dirname, 'index.html') }),
      new webpack.DefinePlugin({
        __AVA_API_ORIGIN__: JSON.stringify(apiOrigin),
        __AVA_MANAGED_CONNECTION__: JSON.stringify(managed),
        __FEISHU_DEBUG_BASE_URL__: JSON.stringify(debugBaseUrl),
      }),
      new BitableAppWebpackPlugin({ open: process.env.AVA_DEV_OPEN !== '0' }),
    ],
    devServer: {
      host: 'localhost',
      port: debugPort,
      hot: true,
      client: { overlay: true },
      ...(localProxy ? { proxy: [localProxy.proxy] } : {}),
      setupMiddlewares(middlewares, devServer) {
        middlewares.unshift({
          name: 'ava-plugin-display-name',
          middleware: pluginDisplayName(require('./block.json')),
        });
        if (localProxy)
          middlewares.unshift({ name: 'ava-local-api-guard', middleware: localProxy.guard });
        middlewares.push(opdevMiddleware(devServer));
        return middlewares;
      },
    },
    devtool: argv.mode === 'development' ? 'eval-source-map' : false,
  };
};
