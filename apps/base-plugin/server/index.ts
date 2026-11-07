import { createApp } from './app';
import { writeFile, rename } from 'node:fs/promises';

const { AVA_API_KEY, AVA_MODEL, AVA_BASE_URL, PLUGIN_ACCESS_TOKEN } = process.env;
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !PLUGIN_ACCESS_TOKEN) {
  throw new Error('对外提供服务时必须设置 PLUGIN_ACCESS_TOKEN');
}
const model =
  AVA_API_KEY && AVA_MODEL
    ? { apiKey: AVA_API_KEY, model: AVA_MODEL, baseURL: AVA_BASE_URL || undefined }
    : undefined;
const allowedOrigins = (process.env.PLUGIN_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (allowedOrigins.includes('*') || allowedOrigins.includes('null'))
  throw new Error('PLUGIN_ALLOWED_ORIGINS 必须填写明确的插件 origin');
const app = createApp({ model, token: PLUGIN_ACCESS_TOKEN, allowedOrigins });
const preferredPort = Number(process.env.PORT) || 3001;
function listen(port: number) {
  const server = app.listen(port, host);
  server.once('error', (error: NodeJS.ErrnoException) => {
    const nextPort = port + 1 === Number(process.env.FEISHU_DEBUG_PORT) ? port + 2 : port + 1;
    if (
      process.env.AVA_DEV_READY_FILE &&
      error.code === 'EADDRINUSE' &&
      nextPort <= Math.min(preferredPort + 99, 65535)
    ) {
      listen(nextPort);
    } else {
      throw error;
    }
  });
  server.once('listening', async () => {
    const browserHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
    const apiOrigin = `http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${port}`;
    if (process.env.AVA_DEV_READY_FILE) {
      const path = process.env.AVA_DEV_READY_FILE;
      await writeFile(
        path + '.tmp',
        JSON.stringify({ runId: process.env.AVA_DEV_RUN_ID, apiOrigin }),
        { mode: 0o600 },
      );
      await rename(path + '.tmp', path);
    }
    console.log(`AVA 插件服务 ${apiOrigin} · ${model ? '模型已配置' : '演示模式'}`);
  });
}
listen(preferredPort);
