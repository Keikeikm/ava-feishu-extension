import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { demoSnapshot } from '../shared/demo';
import { DEMO_QUESTIONS } from '../shared/types';

const payload = { question: DEMO_QUESTIONS[0], mode: 'demo', snapshot: demoSnapshot };
describe('分析 HTTP 服务', () => {
  it('允许白名单内的正式插件跨域调用，并处理带令牌的预检', async () => {
    const app = createApp({ token: 'token', allowedOrigins: ['https://plugin.example.test'] });
    const preflight = await request(app)
      .options('/api/analyze')
      .set('Origin', 'https://plugin.example.test')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://plugin.example.test');
    const result = await request(app)
      .post('/api/analyze')
      .set('Origin', 'https://plugin.example.test')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Authorization', 'Bearer token')
      .send(payload);
    expect(result.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .set('Origin', 'https://other.example.test')
          .set('Authorization', 'Bearer token')
          .send(payload)
      ).status,
    ).toBe(403);
  });
  it('跨域服务没有配置令牌时拒绝执行分析', async () => {
    const result = await request(createApp({ allowedOrigins: ['http://localhost:8080'] }))
      .post('/api/analyze')
      .set('Origin', 'http://localhost:8080')
      .send(payload);
    expect(result.status).toBe(503);
  });
  it('报告状态，不泄漏密钥', async () => {
    const res = await request(
      createApp({ model: { model: 'test', apiKey: 'secret' }, token: 'token' }),
    ).get('/api/status');
    expect(res.body).toEqual({ ready: true, model: 'test', authRequired: true });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
  it('保护分析接口，拒绝错误令牌和跨站请求', async () => {
    const app = createApp({ token: 'token' });
    expect((await request(app).post('/api/analyze').send(payload)).status).toBe(401);
    expect(
      (await request(app).post('/api/analyze').set('Authorization', 'Bearer wrong').send(payload))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .set('Authorization', 'Bearer token')
          .set('Sec-Fetch-Site', 'cross-site')
          .send(payload)
      ).status,
    ).toBe(403);
    const good = await request(app)
      .post('/api/analyze')
      .set('Authorization', 'Bearer token')
      .send(payload);
    expect(good.status).toBe(200);
    expect(good.body.data.length).toBe(6);
  });
  it('未配置模型时不把飞书数据降级为演示', async () => {
    const app = createApp();
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .send({ ...payload, mode: 'live' })
      ).status,
    ).toBe(503);
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .send({ ...payload, snapshot: { ...demoSnapshot, source: 'feishu' } })
      ).status,
    ).toBe(400);
  });
  it('拒绝无效请求和过大的正文', async () => {
    const app = createApp();
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .send({ ...payload, question: '' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/analyze').set('Content-Type', 'application/json').send('{bad'))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/analyze')
          .send({ x: 'a'.repeat(8 * 1024 * 1024) })
      ).status,
    ).toBe(413);
  });
  it('不向客户端泄露模型错误中的密钥及原始数据', async () => {
    const analyze = vi.fn(async () => {
      throw new Error('API_KEY=secret TABLE_DATA=private');
    });
    const res = await request(createApp({ analyze })).post('/api/analyze').send(payload);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|private/);
  });
});
