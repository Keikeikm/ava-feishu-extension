import { createApp } from './app';

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
app.listen(Number(process.env.PORT) || 3001, host, () => {
  console.log(
    `AVA 插件服务 http://${host}:${process.env.PORT || 3001} · ${model ? '模型已配置' : '演示模式'}`,
  );
});
