import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import type { AnalysisResult } from '../../shared/types';

test('真实 SSE 首段提前显示，刷新恢复进度，最终展示双轴图与对话布局', async ({
  page,
  baseURL,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const result: AnalysisResult = {
    id: 'stream-result',
    query: '分析收入与毛利率',
    text: '收入增加，但毛利率下降。\n\n- 收入从 120 增至 180。\n- 毛利率从 30% 降至 25%。\n\n建议进一步核对成本与折扣。',
    data: [
      { 月份: '01月', 收入: 120, 毛利率: 30 },
      { 月份: '02月', 收入: 150, 毛利率: 28 },
      { 月份: '03月', 收入: 180, 毛利率: 25 },
    ],
    sql: 'SELECT month, revenue, margin FROM data ORDER BY month',
    chart: {
      chartType: 'dual-axes',
      config: {
        type: 'dual-axes',
        title: '收入与毛利率',
        categories: ['01月', '02月', '03月'],
        series: [
          { type: 'column', axisYTitle: '收入（千美元）', data: [120, 150, 180] },
          { type: 'line', axisYTitle: '毛利率（%）', data: [30, 28, 25] },
        ],
      },
    },
    mode: 'live',
    rowCount: 72,
    elapsedMs: 300,
    createdAt: '2026-01-01T00:00:00Z',
    steps: [
      { id: 'source', label: '读取所选数据快照', status: 'done' },
      { id: 'query', label: '执行只读查询', status: 'done', detail: '返回 3 行' },
      { id: 'summary', label: '解读查询结果', status: 'done' },
      { id: 'chart', label: '生成可视化图表', status: 'done' },
    ],
  };
  const app = createApp({
    token: 'browser-fixture',
    allowedOrigins: [baseURL!],
    model: { model: 'fixture', apiKey: 'unused' },
    analyze: async (_q, _s, _m, _c, _r, publish) => {
      calls++;
      publish!({ type: 'step', step: result.steps![0] });
      publish!({ type: 'query', sql: result.sql!, data: result.data });
      publish!({ type: 'step', step: { id: 'summary', label: '解读查询结果', status: 'running' } });
      publish!({ type: 'text', delta: '收入增加，但毛利率下降。' });
      await gate;
      publish!({ type: 'text', delta: result.text.slice('收入增加，但毛利率下降。'.length) });
      return result;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.setViewportSize({ width: 1720, height: 1150 });
    await page.addInitScript((origin) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === 'string' && input.startsWith('/api/analysis-jobs')) {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', 'Bearer browser-fixture');
          return original(origin + input, { ...init, headers });
        }
        return original(input, init);
      };
    }, origin);
    await page.route('**/api/status', (route) =>
      route.fulfill({ json: { ready: true, authRequired: false, model: 'fixture' } }),
    );
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '分析问题' });
    const send = page.getByRole('button', { name: '开始分析', exact: true });
    await input.fill('分析收入与毛利率');
    await send.click();
    await expect(page.locator('.user-question')).toHaveText('分析收入与毛利率');
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
    await expect(page.locator('.conversation-answer')).toContainText('收入增加，但毛利率下降。');
    await input.fill('按地区比较收入');
    await expect(send).toBeDisabled();
    await input.press('Enter');
    expect(calls).toBe(1);
    await page.reload();
    await expect(page.locator('.conversation-answer')).toHaveText('收入增加，但毛利率下降。');
    await expect(page.getByText('实时更新', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('按地区比较收入');
    release();
    await expect(page.locator('.conversation-answer')).toContainText('建议进一步核对成本与折扣。');
    await expect(input).toHaveValue('按地区比较收入');
    await expect(send).toBeEnabled();
    await expect(page.locator('.antv-chart[data-state="ready"] canvas')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.antv-chart')).toHaveAttribute('data-chart-type', 'dual-axes');
    await expect(page.locator('iframe[title="AVA 分析图表"]')).toHaveCount(0);
    expect(calls).toBe(1);
    await page
      .getByRole('region', { name: 'AVA 分析工作台' })
      .screenshot({ path: testInfo.outputPath('analytics-desktop.png') });
    await page.getByRole('tab', { name: '查询依据' }).click();
    await expect(page.locator('.sql-block')).toContainText('SELECT month');
    await page.getByRole('tab', { name: '计算结果' }).click();
    await expect(page.getByRole('cell', { name: '180', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '可视化图表' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.antv-chart[data-state="ready"] canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole('region', { name: 'AVA 分析工作台' })
      .screenshot({ path: testInfo.outputPath('analytics-mobile.png') });
  } finally {
    release();
    server.closeAllConnections();
    server.close();
  }
});

test('发送失败时保留下一条草稿，输入框为空时恢复未发送的问题', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route('**/api/analysis-jobs', async (route) => {
    const attempt = ++attempts;
    await gate;
    await route.fulfill({ status: 400, json: { error: `发送失败 ${attempt}` } });
  });
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '分析问题' });
    const send = page.getByRole('button', { name: '开始分析', exact: true });
    await input.fill('分析总收入');
    await send.click();
    await expect(input).toHaveValue('');
    await input.fill('按月份比较收入');
    release();
    await expect(page.getByRole('alert')).toHaveText('发送失败 1');
    await expect(input).toHaveValue('按月份比较收入');
    await send.click();
    await expect(page.getByRole('alert')).toHaveText('发送失败 2');
    await expect(input).toHaveValue('按月份比较收入');
  } finally {
    release();
  }
});
