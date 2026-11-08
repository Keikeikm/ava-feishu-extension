import express from 'express';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import request from 'supertest';
import { developmentEnvironment } from '../scripts/dev.mjs';
import { createApp } from '../server/app';
import { demoSnapshot } from '../shared/demo';
import { DEMO_QUESTIONS } from '../shared/types';
import developmentProxy from '../scripts/dev-proxy.cjs';
const require = createRequire(import.meta.url);
const { createProxyMiddleware } = createRequire(require.resolve('webpack-dev-server'))(
  'http-proxy-middleware',
);

async function occupy(host: string, context: TestContext) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host, ipv6Only: true }, resolve);
  });
  context.onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return address.port;
}

it('跳过 IPv4 API 和 IPv6 调试端口占用，选择的来源可通过 API 鉴权', async (context) => {
  const apiPort = await occupy('127.0.0.1', context);
  const debugPort = await occupy('::1', context);
  const env = await developmentEnvironment({
    PORT: String(apiPort),
    FEISHU_DEBUG_PORT: String(debugPort),
    PLUGIN_ALLOWED_ORIGINS: 'https://configured.example.test',
  });
  expect(Number(env.PORT)).toBeGreaterThan(apiPort);
  expect(Number(env.FEISHU_DEBUG_PORT)).toBeGreaterThan(debugPort);
  expect(env.FEISHU_DEBUG_PORT).not.toBe(env.PORT);
  expect(env.PLUGIN_ACCESS_TOKEN).toMatch(/^[a-f0-9]{64}$/);
  expect(env.AVA_DEV_PROXY).toBe('1');
  expect(env.AVA_DEV_API_ORIGIN).toBe(`http://127.0.0.1:${env.PORT}`);
  const origins = env.PLUGIN_ALLOWED_ORIGINS.split(',');
  expect(origins).toContain('https://configured.example.test');
  const origin = `http://localhost:${env.FEISHU_DEBUG_PORT}`;
  expect(origins).toContain(origin);
  expect(origins).toContain(`http://127.0.0.1:${env.FEISHU_DEBUG_PORT}`);
  const response = await request(createApp({ token: 'fixture-token', allowedOrigins: origins }))
    .post('/api/analyze')
    .set('Origin', origin)
    .set('Authorization', 'Bearer fixture-token')
    .send({ question: DEMO_QUESTIONS[0], mode: 'demo', snapshot: demoSnapshot });
  expect(response.status).toBe(200);
});

it('API 和调试服务配置同一起始端口时，仍选择两个不同端口', async (context) => {
  const port = await occupy('127.0.0.1', context);
  const env = await developmentEnvironment({ PORT: String(port), FEISHU_DEBUG_PORT: String(port) });
  expect(env.PORT).not.toBe(env.FEISHU_DEBUG_PORT);
});

it('开发包使用选定的 API 和调试端口，生产包继续使用持久配置', async () => {
  const runtime = JSON.parse(
    await readFile(new URL('../plugin/runtime.config.json', import.meta.url), 'utf8'),
  );
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const makeConfig = require('./webpack.config.cjs');
    const read = (mode) => {
      const config = makeConfig({}, {mode});
      return config.plugins.find(p => p.definitions?.__AVA_API_ORIGIN__).definitions;
    };
    console.log(JSON.stringify({dev: read('development'), prod: read('production')}));
  `,
    ],
    {
      cwd: fileURLToPath(new URL('../plugin/', import.meta.url)),
      env: {
        ...process.env,
        AVA_DEV_PROXY: '1',
        PLUGIN_ACCESS_TOKEN: 'server-only-fixture-secret',
        FEISHU_DEBUG_PORT: '18081',
        AVA_DEV_API_ORIGIN: 'http://127.0.0.1:13002',
      },
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const { dev, prod } = JSON.parse(result.stdout);
  expect(JSON.parse(dev.__AVA_API_ORIGIN__)).toBe('http://localhost:18081');
  expect(dev.__AVA_MANAGED_CONNECTION__).toBe('true');
  expect(JSON.stringify({ dev, prod })).not.toContain('server-only-fixture-secret');
  expect(prod.__AVA_MANAGED_CONNECTION__).toBe('false');
  expect(new URL(JSON.parse(dev.__FEISHU_DEBUG_BASE_URL__)).searchParams.get('debugPort')).toBe(
    '18081',
  );
  expect(JSON.parse(prod.__AVA_API_ORIGIN__)).toBe(runtime.apiOrigin);
  expect(JSON.parse(prod.__FEISHU_DEBUG_BASE_URL__)).toBe('');
});

it('非法端口在启动服务前明确报错', async () => {
  await expect(developmentEnvironment({ PORT: 'NaN' })).rejects.toThrow('PORT 必须');
  await expect(developmentEnvironment({ FEISHU_DEBUG_PORT: '65536' })).rejects.toThrow(
    'FEISHU_DEBUG_PORT 必须',
  );
});

it('本地代理自动认证，拒绝外站和无来源的写请求，API 本身仍要求凭证', async (context) => {
  const api = createApp({
    token: 'only-on-server',
    model: { model: 'fixture', apiKey: 'not-a-real-key' },
  });
  const server = api.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const local = developmentProxy(`http://127.0.0.1:${address.port}`, 'only-on-server', 18081);
  const gateway = express();
  gateway.use(local.guard);
  gateway.use(createProxyMiddleware(local.proxy.context, { ...local.proxy, logLevel: 'silent' }));
  // These belong to the official opdev middleware, not the analysis API.
  gateway.get('/api/block', (_req, res) =>
    res.json({ code: 0, data: { blocks: [{ blockTypeID: 'blk_fixture' }] } }),
  );
  gateway.get('/api/meta', (_req, res) =>
    res.json({ code: 0, data: { app_metas: [{ app_id: 'cli_fixture' }] } }),
  );
  for (const endpoint of ['/api/block?app_id=cli_fixture', '/api/meta']) {
    const registration = await request(gateway)
      .get(endpoint)
      .set('Host', 'localhost:18081')
      .set('Origin', 'https://my.feishu.cn')
      .set('Sec-Fetch-Site', 'cross-site');
    expect(registration.status).toBe(200);
    expect(registration.body.code).toBe(0);
  }
  expect((await request(api).get('/api/connection')).status).toBe(401);
  const connected = await request(gateway)
    .get('/api/connection')
    .set('Host', 'localhost:18081')
    .set('Origin', 'http://localhost:18081');
  expect(connected.status).toBe(200);
  expect(connected.body.ready).toBe(true);
  expect(JSON.stringify(connected.body)).not.toContain('only-on-server');
  const analyzed = await request(gateway)
    .post('/api/analyze')
    .set('Host', 'localhost:18081')
    .set('Origin', 'http://localhost:18081')
    .send({ question: DEMO_QUESTIONS[0], snapshot: demoSnapshot, mode: 'demo' });
  expect(analyzed.status).toBe(200);
  expect(analyzed.body.data).toHaveLength(6);
  const id = randomUUID(),
    key = randomUUID();
  const started = await request(gateway)
    .post('/api/analysis-jobs')
    .set('Host', 'localhost:18081')
    .set('Origin', 'http://localhost:18081')
    .send({
      id,
      key,
      payload: { question: DEMO_QUESTIONS[0], snapshot: demoSnapshot, mode: 'demo' },
    });
  expect(started.status).toBe(202);
  await vi.waitFor(async () => {
    const polled = await request(gateway)
      .get(`/api/analysis-jobs/${id}`)
      .set('Host', 'localhost:18081')
      .set('Origin', 'http://localhost:18081')
      .set('X-AVA-Job-Key', key);
    expect(polled.body.status).toBe('succeeded');
    expect(polled.body.result.data).toHaveLength(6);
  });
  for (const origin of ['https://untrusted.example', 'null']) {
    const blocked = await request(gateway)
      .post('/api/analyze')
      .set('Host', 'localhost:18081')
      .set('Origin', origin)
      .send({});
    expect(blocked.status).toBe(403);
  }
  expect(
    (await request(gateway).post('/api/analyze').set('Host', 'localhost:18081').send({})).status,
  ).toBe(403);
});

it('实际绑定时端口再次被占用，API 仍能换端口并发布本次实例的就绪地址', async (context) => {
  const occupied = await occupy('127.0.0.1', context);
  const directory = await mkdtemp(join(tmpdir(), 'ava-api-ready-'));
  const path = join(directory, 'ready.json');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(occupied),
      FEISHU_DEBUG_PORT: String(occupied + 1),
      AVA_API_KEY: '',
      AVA_MODEL: '',
      PLUGIN_ACCESS_TOKEN: 'readiness-fixture',
      AVA_DEV_READY_FILE: path,
      AVA_DEV_RUN_ID: 'current-test-run',
    },
    stdio: 'ignore',
  });
  context.onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  let ready: { runId: string; apiOrigin: string } | undefined;
  await vi.waitFor(
    async () => {
      ready = JSON.parse(await readFile(path, 'utf8'));
      expect(ready?.runId).toBe('current-test-run');
    },
    { timeout: 10000 },
  );
  expect(Number(new URL(ready!.apiOrigin).port)).toBeGreaterThan(occupied + 1);
  const response = await fetch(ready!.apiOrigin + '/api/connection', {
    headers: { Authorization: 'Bearer readiness-fixture' },
  });
  expect(response.status).toBe(200);
});
