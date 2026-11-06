const path = require('node:path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {
  BitableAppWebpackPlugin,
  opdevMiddleware,
} = require('@lark-opdev/block-bitable-webpack-utils');
const runtime = require('./runtime.config.json');

module.exports = (_env, argv) => {
  // The official plugin checks NODE_ENV to emit the opdev deployment manifests.
  process.env.NODE_ENV = argv.mode || 'production';
  const debugPort = Number(process.env.FEISHU_DEBUG_PORT ?? 8080);
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
        __AVA_API_ORIGIN__: JSON.stringify(runtime.apiOrigin),
        __FEISHU_DEBUG_BASE_URL__: JSON.stringify(debugBaseUrl),
      }),
      new BitableAppWebpackPlugin({ open: true }),
    ],
    devServer: {
      host: 'localhost',
      port: debugPort,
      hot: true,
      client: { overlay: true },
      setupMiddlewares(middlewares, devServer) {
        middlewares.push(opdevMiddleware(devServer));
        return middlewares;
      },
    },
    devtool: argv.mode === 'development' ? 'eval-source-map' : false,
  };
};
