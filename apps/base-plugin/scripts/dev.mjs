import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';
import { readConfig, validateConfig } from './plugin-config.mjs';

async function portAvailable(port, hosts) {
  const servers = [];
  try {
    for (const host of hosts) {
      const server = createServer();
      servers.push(server);
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen({ port, host, ipv6Only: true }, resolve);
        });
      } catch (error) {
        // Some development machines have IPv6 disabled.
        if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) continue;
        throw error;
      }
    }
    return true;
  } catch (error) {
    if (['EADDRINUSE', 'EACCES'].includes(error.code)) return false;
    throw error;
  } finally {
    await Promise.all(
      servers
        .filter((server) => server.listening)
        .map(
          (server) =>
            new Promise((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            }),
        ),
    );
  }
}

function preferredPort(value, fallback, name) {
  const port = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1～65535 之间的整数。`);
  }
  return port;
}

async function findPort(preferred, hosts, excluded = new Set()) {
  for (let port = preferred; port <= Math.min(preferred + 99, 65535); port++) {
    if (!excluded.has(port) && (await portAvailable(port, hosts))) return port;
  }
  throw new Error(`${preferred} 起的 100 个端口内没有可用端口，请设置其他起始端口。`);
}

export async function developmentEnvironment(env) {
  const apiHost = env.HOST?.trim() || '127.0.0.1';
  const apiPreferred = preferredPort(env.PORT, 3001, 'PORT');
  const debugPreferred = preferredPort(env.FEISHU_DEBUG_PORT, 8080, 'FEISHU_DEBUG_PORT');
  const apiHosts = apiHost === 'localhost' ? ['127.0.0.1', '::1'] : [apiHost];
  const apiPort = await findPort(apiPreferred, apiHosts);
  const debugPort = await findPort(debugPreferred, ['127.0.0.1', '::1'], new Set([apiPort]));
  const browserHost = ['0.0.0.0', '::'].includes(apiHost) ? '127.0.0.1' : apiHost;
  const apiOrigin = `http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${apiPort}`;
  const allowedOrigins = new Set(
    (env.PLUGIN_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  allowedOrigins.add(`http://localhost:${debugPort}`);
  allowedOrigins.add(`http://127.0.0.1:${debugPort}`);
  return {
    ...env,
    HOST: apiHost,
    PORT: String(apiPort),
    FEISHU_DEBUG_PORT: String(debugPort),
    AVA_DEV_API_ORIGIN: apiOrigin,
    // A fresh, process-local credential removes manual setup without publishing a credential.
    PLUGIN_ACCESS_TOKEN: randomBytes(32).toString('hex'),
    AVA_DEV_PROXY: '1',
    AVA_DEV_OPEN: env.AVA_DEV_OPEN || '1',
    PLUGIN_ALLOWED_ORIGINS: [...allowedOrigins].join(','),
  };
}

async function main() {
  const config = await readConfig();
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join('\n'));
  const env = await developmentEnvironment(process.env);
  const state = new URL('../.dev/', import.meta.url);
  await mkdir(state, { recursive: true, mode: 0o700 });
  env.AVA_DEV_RUN_ID = randomUUID();
  env.AVA_DEV_READY_FILE = fileURLToPath(new URL(`api-${env.AVA_DEV_RUN_ID}.json`, state));
  env.AVA_DEV_PARENT_PID = String(process.pid);
  const tableUrl = new URL(config.block.url);
  tableUrl.searchParams.set('debugPort', env.FEISHU_DEBUG_PORT);
  console.log(`飞书调试服务：http://localhost:${env.FEISHU_DEBUG_PORT}`);
  console.log(`本地分析 API：${env.AVA_DEV_API_ORIGIN}`);
  console.log(`配置文件：${fileURLToPath(new URL('../.env', import.meta.url))}`);
  const missing = ['AVA_API_KEY', 'AVA_MODEL'].filter((key) => !env[key]?.trim());
  console.log(
    missing.length
      ? `模型配置缺少：${missing.join('、')}`
      : '模型配置已加载；本地连接与认证自动完成。',
  );
  console.log(`飞书调试表：${tableUrl}`);
  const { result } = concurrently(
    [
      { name: 'api', command: 'npm run dev:server', env },
      { name: 'plugin', command: 'node scripts/start-plugin.mjs', env },
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      killOthersOn: ['success', 'failure'],
      killTimeout: 3000,
    },
  );
  try {
    await result;
  } catch {
    // concurrently already prints each service's errors. Never print its env-bearing close events.
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
