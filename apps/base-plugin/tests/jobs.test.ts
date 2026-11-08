import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { AnalysisJobs } from '../server/analysis-jobs';
import { demoSnapshot } from '../shared/demo';
import type { AnalysisResult } from '../shared/types';

const result: AnalysisResult = {
  id: 'result',
  query: '求和',
  text: '合计为 6。',
  data: [{ total: 6 }],
  chart: null,
  rowCount: 3,
  elapsedMs: 1,
  mode: 'demo',
  createdAt: '2026-01-01T00:00:00Z',
};

it('提交后断开请求仍完成任务，相同提交不会重复调用模型，结果按独立凭证隔离', async () => {
  let complete!: (result: AnalysisResult) => void;
  const analyze = vi.fn(
    () =>
      new Promise<AnalysisResult>((resolve) => {
        complete = resolve;
      }),
  );
  const app = createApp({ token: 'service-token', analyze });
  const id = randomUUID(),
    key = randomUUID();
  const payload = { question: '求和', snapshot: demoSnapshot, mode: 'demo' };
  const post = () =>
    request(app)
      .post('/api/analysis-jobs')
      .set('Authorization', 'Bearer service-token')
      .send({ id, key, payload });
  const read = (capability = key) =>
    request(app)
      .get(`/api/analysis-jobs/${id}`)
      .set('Authorization', 'Bearer service-token')
      .set('X-AVA-Job-Key', capability);
  const started = await post();
  expect(started.status).toBe(202);
  expect(started.body).toEqual({ id, status: 'running' });
  expect((await post()).body.status).toBe('running');
  expect(analyze).toHaveBeenCalledTimes(1);
  expect((await read(randomUUID())).status).toBe(404);
  // Status polling must not exhaust the 15/minute analysis submission limit.
  for (let index = 0; index < 18; index++) expect((await read()).status).toBe(200);
  complete(result);
  await vi.waitFor(async () => expect((await read()).body.status).toBe('succeeded'));
  expect((await read()).body.result).toEqual(result);
  expect(JSON.stringify((await read()).body)).not.toContain(key);
  expect(
    (await request(app).get(`/api/analysis-jobs/${id}`).set('X-AVA-Job-Key', key)).status,
  ).toBe(401);
});

it('后台任务沿用分析并发上限，不接受第三个并行任务', async () => {
  const deferred: ((result: AnalysisResult) => void)[] = [];
  const analyze = vi.fn(() => new Promise<AnalysisResult>((resolve) => deferred.push(resolve)));
  const app = createApp({ analyze });
  const submit = () =>
    request(app)
      .post('/api/analysis-jobs')
      .send({
        id: randomUUID(),
        key: randomUUID(),
        payload: { question: '求和', snapshot: demoSnapshot, mode: 'demo' },
      });
  expect((await submit()).status).toBe(202);
  expect((await submit()).status).toBe(202);
  expect((await submit()).status).toBe(429);
  deferred.forEach((resolve) => resolve(result));
});

it('已完成后台结果过期后释放，异常中的密钥由公开错误转换器屏蔽', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const jobs = new AnalysisJobs(1000);
    jobs.start(
      'job',
      'capability',
      async () => result,
      () => '分析失败',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(jobs.get('job', 'capability')?.status).toBe('succeeded');
    now = 2001;
    expect(jobs.get('job', 'capability')).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
  const app = createApp({
    analyze: async () => {
      throw new Error('provider-secret-key');
    },
  });
  const id = randomUUID(),
    key = randomUUID();
  await request(app)
    .post('/api/analysis-jobs')
    .send({ id, key, payload: { question: '求和', snapshot: demoSnapshot, mode: 'demo' } });
  const response = await request(app).get(`/api/analysis-jobs/${id}`).set('X-AVA-Job-Key', key);
  expect(response.body.status).toBe('failed');
  expect(JSON.stringify(response.body)).not.toContain('provider-secret-key');
});
