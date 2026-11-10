import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { it, expect, vi } from 'vitest';
import { createApp } from '../server/app';
import { runAnalysis } from '../server/analysis';
import { demoSnapshot } from '../shared/demo';
import { streamAnalysisJob } from '../src/lib/api';
import type {
  AnalysisResult,
  AnalysisUpdate,
  JobStreamEvent,
  PendingAnalysis,
} from '../shared/types';

const final: AnalysisResult = {
  id: 'result',
  query: '汇总',
  text: '第一段，第二段。',
  data: [{ 合计: 6 }],
  chart: null,
  rowCount: 3,
  mode: 'live',
  elapsedMs: 10,
  createdAt: '2026-01-01T00:00:00Z',
};

it('SSE 在任务结束前发出文本；断开后任务继续，新连接收到完整快照且不重复运行', async (context) => {
  let publish!: (value: AnalysisUpdate) => void;
  let finish!: (result: AnalysisResult) => void;
  let calls = 0;
  const app = createApp({
    token: 'test-service-token',
    analyze: async (_q, _s, _m, _c, _r, update) => {
      calls++;
      publish = update!;
      return new Promise<AnalysisResult>((resolve) => {
        finish = resolve;
      });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const id = randomUUID(),
    key = randomUUID();
  const headers = {
    Authorization: 'Bearer test-service-token',
    'Content-Type': 'application/json',
    'X-AVA-Job-Key': key,
  };
  expect(
    (
      await fetch(`${origin}/api/analysis-jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id,
          key,
          payload: { mode: 'demo', snapshot: demoSnapshot, question: '汇总' },
        }),
      })
    ).status,
  ).toBe(202);
  expect(
    (
      await fetch(`${origin}/api/analysis-jobs/${id}/events`, {
        headers: { ...headers, 'X-AVA-Job-Key': randomUUID() },
      })
    ).status,
  ).toBe(404);
  expect(
    (await fetch(`${origin}/api/analysis-jobs/${id}/events`, { headers: { 'X-AVA-Job-Key': key } }))
      .status,
  ).toBe(401);
  const nativeFetch = globalThis.fetch;
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => nativeFetch(new URL(String(input), origin), init));
  context.onTestFinished(() => fetchMock.mockRestore());
  const pending: PendingAnalysis = { id, key, query: '汇总', createdAt: new Date().toISOString() };
  const first: JobStreamEvent[] = [];
  const abort = new AbortController();
  const open = streamAnalysisJob(pending, 'test-service-token', abort.signal, (event) =>
    first.push(event),
  ).catch(() => {});
  await vi.waitFor(() => expect(first[0]?.type).toBe('snapshot'));
  publish({ type: 'text', delta: '第一段，' });
  await vi.waitFor(() =>
    expect(first.some((event) => event.type === 'update' && event.update.type === 'text')).toBe(
      true,
    ),
  );
  expect(first.some((event) => event.type === 'snapshot' && event.job.status === 'succeeded')).toBe(
    false,
  );
  abort.abort();
  await open;
  publish({ type: 'text', delta: '第二段。' });
  const resumed: JobStreamEvent[] = [];
  const complete = streamAnalysisJob(
    pending,
    'test-service-token',
    new AbortController().signal,
    (event) => resumed.push(event),
  );
  await vi.waitFor(() =>
    expect(resumed[0]).toMatchObject({
      type: 'snapshot',
      job: { status: 'running', progress: { text: '第一段，第二段。' } },
    }),
  );
  finish(final);
  await complete;
  expect(resumed.at(-1)).toMatchObject({
    type: 'snapshot',
    job: { status: 'succeeded', result: final },
  });
  expect(calls).toBe(1);
  expect(JSON.stringify(resumed)).not.toContain(key);
});

it('SSE 解析保留跨字节中文，兼容心跳、CRLF 和断开的 JSON 数据块', async () => {
  const events: JobStreamEvent[] = [
    { type: 'update', update: { type: 'text', delta: '中文首段' } },
    { type: 'snapshot', job: { id: 'test', status: 'succeeded', result: final } },
  ];
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\n' +
      events.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join(''),
  );
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 7)
        controller.enqueue(bytes.slice(index, index + 7));
      controller.close();
    },
  });
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  try {
    const read: JobStreamEvent[] = [];
    await streamAnalysisJob(
      { id: 'test', key: 'private-capability', query: 'q', createdAt: '' },
      'service-token',
      new AbortController().signal,
      (event) => read.push(event),
    );
    expect(read).toEqual(events);
    expect(String(mock.mock.calls[0][0])).not.toContain('private-capability');
    expect(mock.mock.calls[0][1]?.headers).toMatchObject({ 'X-AVA-Job-Key': 'private-capability' });
  } finally {
    mock.mockRestore();
  }
});

it('真实 AVA 查询后解读模型以 token 流返回，首段提前出现，推理字段不转发', async (context) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = express();
  provider.use(express.json());
  provider.post('/v1/chat/completions', (req, res) => {
    const prompt = req.body.messages
      .map((message: { content: string }) => message.content)
      .join('\n');
    if (req.body.stream) {
      res.set('Content-Type', 'text/event-stream');
      res.flushHeaders();
      const chunk = (content: string) =>
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content, reasoning_content: 'PRIVATE_REASONING' }, finish_reason: null }] })}\n\n`;
      res.write(chunk('已完成地区汇总。'));
      void gate.then(() => {
        res.write(chunk('\n\n结果来自只读查询。'));
        res.end('data: [DONE]\n\n');
      });
      return;
    }
    const content = prompt.includes('SQL expert')
      ? 'SELECT "地区" AS category, SUM("销售额") AS value FROM data GROUP BY "地区"'
      : 'none';
    res.json({
      id: 'fixture',
      object: 'chat.completion',
      created: 1,
      model: 'fixture',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  const server = provider.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.onTestFinished(() => {
    release();
    server.closeAllConnections();
    server.close();
  });
  const updates: AnalysisUpdate[] = [];
  let finished = false;
  const task = runAnalysis(
    '按地区汇总销售额',
    demoSnapshot,
    'live',
    {
      model: 'fixture',
      apiKey: 'fixture-only',
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    },
    undefined,
    (update) => updates.push(update),
  ).then((result) => {
    finished = true;
    return result;
  });
  await vi.waitFor(
    () =>
      expect(
        updates.some((value) => value.type === 'text' && value.delta === '已完成地区汇总。'),
      ).toBe(true),
    { timeout: 10_000 },
  );
  expect(finished).toBe(false);
  expect(updates.find((value) => value.type === 'query')).toMatchObject({
    data: expect.any(Array),
    sql: expect.stringContaining('SELECT'),
  });
  release();
  const result = await task;
  expect(result.text).toBe('已完成地区汇总。\n\n结果来自只读查询。');
  expect(result.data).toHaveLength(4);
  expect(result.steps?.every((step) => step.status === 'done')).toBe(true);
  expect(JSON.stringify(updates)).not.toContain('PRIVATE_REASONING');
});

it('模型流式和普通解读均失败时，仍返回已执行的 SQL、数据和图表', async (context) => {
  const provider = express();
  provider.use(express.json());
  const summaryRequests: { stream: boolean; system: string | undefined }[] = [];
  provider.post('/v1/chat/completions', (req, res) => {
    const messages: { role: string; content: string }[] = req.body.messages;
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('实际查询结果：')) {
      summaryRequests.push({
        stream: req.body.stream === true,
        system: messages.find((message) => message.role === 'system')?.content,
      });
      res.status(503).json({ error: { message: 'private-provider-error', type: 'server_error' } });
      return;
    }
    const content = prompt.includes('SQL expert')
      ? 'SELECT "地区" AS category, SUM("销售额") AS value FROM data GROUP BY "地区"'
      : 'none';
    res.json({
      id: 'fixture',
      object: 'chat.completion',
      created: 1,
      model: 'fixture',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  const server = provider.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const updates: AnalysisUpdate[] = [];
  const result = await runAnalysis(
    '按地区汇总销售额',
    demoSnapshot,
    'live',
    {
      model: 'fixture',
      apiKey: 'fixture-only',
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    },
    undefined,
    (update) => updates.push(update),
  );
  expect(summaryRequests.map(({ stream }) => stream)).toEqual([true, false]);
  expect(summaryRequests[0].system).toContain('右侧结果栏负责展示图表、SQL 和完整数据表');
  expect(summaryRequests[0].system).toContain('省略绘图能力说明、图表配置、SQL、Markdown 表格');
  expect(summaryRequests[1].system).toBe(summaryRequests[0].system);
  expect(result.sql).toContain('SELECT');
  expect(result.data).toHaveLength(4);
  expect(result.chart).not.toBeNull();
  expect(result.text).toContain('查询已完成');
  expect(result.steps?.find((step) => step.id === 'summary')?.status).toBe('error');
  expect(JSON.stringify({ result, updates })).not.toContain('private-provider-error');
});
