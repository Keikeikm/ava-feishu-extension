import { test, expect, type Page, type FrameLocator } from '@playwright/test';
import type { AnalysisJob } from '../../shared/types';

// Only synthetic table data and a fake analysis service are used here.
async function fixture(page: Page, background = false, serviceToken = '') {
  const jobs = new Map<string, { key: string; question: string; table: string }>();
  let complete = !background;
  let submissions = 0;
  const status = { ready: true, model: 'fixture', authRequired: !!serviceToken };
  await page.route('**/conversation-host**', (route) => {
    const params = new URL(route.request().url()).search;
    return route.fulfill({
      contentType: 'text/html',
      body: `<iframe title="测试宿主" src="/conversation-plugin${params}" width="1200" height="900"></iframe>`,
    });
  });
  await page.route('**/conversation-plugin**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/src/plugin.tsx');
      </script></html>`,
    }),
  );
  await page.route(/block-bitable-api[^?]*\.js(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
      const params = new URLSearchParams(location.search);
      const names = { orders: '订单', products: '产品' };
      export const bitable = {
        base: {
          getTableMetaList: async () => Object.entries(names).map(([id, name]) => ({id, name})),
          getSelection: async () => ({baseId: params.get('base') || 'base-a', tableId: 'orders', viewId: 'plugin-view'}),
          getTableById: async (id) => ({
            getName: async () => names[id],
            getFieldMetaList: async () => [{id: 'category', name: '类别', type: 1}, {id: 'amount', name: '金额', type: 2}],
            getViewMetaList: async () => [{id: 'filtered', name: '可见范围', type: 1}],
            getViewById: async () => ({getVisibleFieldIdList: async () => ['category', 'amount']}),
            getRecordsByPage: async () => ({total: 1, hasMore: false, records: [{fields: {category: 'synthetic-source-row', amount: id === 'orders' ? 10 : 20}}]}),
          }),
        },
        bridge: {getData: async () => null, setData: async () => true, getUserId: async () => params.get('user') || 'user-a'},
      };
    `,
    }),
  );
  await page.route('**/api/status', (route) => route.fulfill({ json: status }));
  const authorized = (header?: string) => !serviceToken || header === `Bearer ${serviceToken}`;
  await page.route('**/api/connection', (route) =>
    authorized(route.request().headers().authorization)
      ? route.fulfill({ json: status })
      : route.fulfill({ status: 401, json: { error: '令牌错误' } }),
  );
  const response = (id: string): AnalysisJob => {
    const job = jobs.get(id)!;
    return complete
      ? {
          id,
          status: 'succeeded',
          result: {
            id,
            query: job.question,
            text: `${job.table}的分析已完成。`,
            data: [{ total: 10 }],
            chart: null,
            rowCount: 1,
            elapsedMs: 1,
            mode: 'live',
            createdAt: '2026-01-01T00:00:00Z',
          },
        }
      : { id, status: 'running' };
  };
  await page.route('**/api/analysis-jobs', (route) => {
    if (!authorized(route.request().headers().authorization)) {
      return route.fulfill({ status: 401, json: { error: '令牌错误' } });
    }
    submissions++;
    const { id, key, payload } = route.request().postDataJSON();
    jobs.set(id, { key, question: payload.question, table: payload.snapshot.tableName });
    return route.fulfill({ status: complete ? 200 : 202, json: response(id) });
  });
  await page.route('**/api/analysis-jobs/*', (route) => {
    const id = route.request().url().split('/').pop()!;
    const job = jobs.get(id);
    if (!job || route.request().headers()['x-ava-job-key'] !== job.key)
      return route.fulfill({ status: 404, json: { error: '任务已过期，请重新提问' } });
    return route.fulfill({ json: response(id) });
  });
  return {
    finish: () => {
      complete = true;
    },
    expire: () => jobs.clear(),
    submissions: () => submissions,
  };
}
const plugin = (page: Page) => page.frameLocator('iframe');
async function switchTable(frame: FrameLocator, id: string) {
  await frame.getByRole('button', { name: '数据范围', exact: true }).click();
  await frame.getByRole('combobox', { name: '数据表', exact: true }).selectOption(id);
  await frame.getByRole('button', { name: '加载数据快照', exact: true }).click();
  await expect(frame.getByRole('dialog')).toHaveCount(0);
}
async function analyze(frame: FrameLocator, question: string) {
  await frame.getByRole('textbox', { name: '分析问题' }).fill(question);
  await frame.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(frame.getByRole('region', { name: '分析结果' })).toBeVisible();
}

test('正式插件仅保存验证通过的令牌，同一账号换表可用，并可取消保存', async ({ page, context }) => {
  const token = 'test-browser-token';
  await fixture(page, false, token);
  await page.goto('/conversation-host');
  const frame = plugin(page);
  const prompt = frame.getByText('填写服务访问令牌后即可提问。');
  const dialog = frame.getByRole('dialog', { name: '连接设置' });
  const openSettings = () =>
    frame.getByRole('button', { name: '连接设置', exact: true }).first().click();
  await expect(prompt).toBeVisible();
  await openSettings();
  const input = dialog.getByLabel(/服务访问令牌/);
  const remember = dialog.getByRole('checkbox', { name: '在此浏览器记住令牌' });
  const apply = dialog.getByRole('button', { name: '应用设置' });
  await expect(remember).not.toBeChecked();
  await input.fill('wrong-token');
  await remember.check();
  await apply.click();
  await expect(dialog.getByText('令牌错误')).toBeVisible();
  await page.reload();
  await expect(prompt).toBeVisible();
  await openSettings();
  await expect(input).toBeEmpty();
  await input.fill(token);
  await remember.check();
  await apply.click();
  await expect(dialog).toHaveCount(0);

  const another = await context.newPage();
  await fixture(another, false, token);
  await another.goto('/conversation-host?base=base-b');
  await expect(plugin(another).locator('.context-bar')).toContainText('订单');
  await analyze(plugin(another), '统计另一张表');
  await another.goto('/conversation-host?base=base-b&user=user-b');
  await expect(plugin(another).getByText('填写服务访问令牌后即可提问。')).toBeVisible();
  await another.close();

  await page.reload();
  await expect(frame.locator('.context-bar')).toContainText('订单');
  await openSettings();
  await expect(remember).toBeChecked();
  await remember.uncheck();
  await apply.click();
  await expect(dialog).toHaveCount(0);
  await analyze(frame, '继续本次分析');
  await page.reload();
  await expect(prompt).toBeVisible();
});

test('切换表格、刷新和重开窗口后恢复草稿、结果及字段，用户和 Base 之间隔离', async ({
  page,
  context,
}) => {
  await fixture(page);
  await page.goto('/conversation-host');
  let frame = plugin(page);
  await analyze(frame, '统计订单');
  await frame.getByRole('textbox', { name: '分析问题' }).fill('订单草稿');
  await frame.getByRole('button', { name: '选择字段', exact: true }).click();
  await frame.getByLabel('类别', { exact: true }).uncheck();
  await frame.getByRole('button', { name: '完成选择', exact: true }).click();
  await frame.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(frame.getByRole('region', { name: '分析结果' })).toContainText('订单的分析已完成');
  await expect(frame.getByRole('textbox', { name: '分析问题' })).toHaveValue('订单草稿');
  await switchTable(frame, 'products');
  await expect(frame.getByRole('region', { name: '分析结果' })).toHaveCount(0);
  await expect(frame.getByRole('textbox', { name: '分析问题' })).toBeEmpty();
  await analyze(frame, '统计产品');
  await switchTable(frame, 'orders');
  await expect(frame.getByRole('textbox', { name: '分析问题' })).toHaveValue('订单草稿');
  await expect(frame.getByRole('region', { name: '分析结果' })).toContainText('订单的分析已完成');
  await page.reload();
  frame = plugin(page);
  await expect(frame.getByRole('textbox', { name: '分析问题' })).toHaveValue('订单草稿');
  await expect(frame.locator('.context-bar')).toContainText('1 个字段');
  await expect(frame.getByRole('region', { name: '分析结果' })).toContainText('订单的分析已完成');

  const reopened = await context.newPage();
  await fixture(reopened);
  await reopened.goto('/conversation-host');
  await expect(plugin(reopened).getByRole('textbox', { name: '分析问题' })).toHaveValue('订单草稿');
  await expect(plugin(reopened).getByRole('region', { name: '分析结果' })).toContainText(
    '订单的分析已完成',
  );
  // Opening another window must not require persisting any raw table snapshot.
  const stored = await reopened.frames()[1].evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('ava-conversations');
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<unknown[]>((resolve) => {
      const r = db.transaction('sessions').objectStore('sessions').getAll();
      r.onsuccess = () => resolve(r.result);
    });
  });
  expect(JSON.stringify(stored)).not.toContain('synthetic-source-row');
  await reopened.close();
  for (const other of ['?user=user-b', '?base=base-b']) {
    await page.goto(`/conversation-host${other}`);
    await expect(plugin(page).getByRole('textbox', { name: '分析问题' })).toBeEmpty();
    await expect(plugin(page).getByRole('region', { name: '分析结果' })).toHaveCount(0);
  }
  await page.goto('/conversation-host');
  await expect(plugin(page).getByRole('region', { name: '分析结果' })).toBeVisible();
  await plugin(page).getByRole('button', { name: '清空对话', exact: true }).click();
  await expect(plugin(page).getByRole('textbox', { name: '分析问题' })).toBeEmpty();
  await page.reload();
  await expect(plugin(page).getByRole('textbox', { name: '分析问题' })).toBeEmpty();
  await expect(plugin(page).getByRole('region', { name: '分析结果' })).toHaveCount(0);
  await switchTable(plugin(page), 'products');
  await expect(plugin(page).getByRole('region', { name: '分析结果' })).toContainText(
    '产品的分析已完成',
  );
});

test('分析中销毁插件页面，返回后取回后台结果，不重复提交分析', async ({ page }) => {
  const backend = await fixture(page, true);
  await page.goto('/conversation-host');
  const frame = plugin(page);
  await frame.getByRole('textbox', { name: '分析问题' }).fill('后台统计订单');
  await frame.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect.poll(backend.submissions).toBe(1);
  await expect(frame.getByText('正在寻找数据中的答案', { exact: true })).toBeVisible();
  await page.goto('/'); // Feishu can destroy the iframe when a user switches views.
  backend.finish();
  await page.goto('/conversation-host');
  await expect(plugin(page).getByRole('region', { name: '分析结果' })).toContainText(
    '订单的分析已完成',
  );
  expect(backend.submissions()).toBe(1);
  await page.reload();
  await expect(plugin(page).getByRole('region', { name: '分析结果' })).toBeVisible();
  expect(backend.submissions()).toBe(1);
});

test('后台任务已过期时保留问题并给出重试提示，不自动重复调用模型', async ({ page }) => {
  const backend = await fixture(page, true);
  await page.goto('/conversation-host');
  await plugin(page).getByRole('textbox', { name: '分析问题' }).fill('待恢复的问题');
  await plugin(page).getByRole('button', { name: '开始分析', exact: true }).click();
  await expect.poll(backend.submissions).toBe(1);
  await page.goto('/');
  backend.expire();
  await page.goto('/conversation-host');
  await expect(plugin(page).getByRole('alert')).toContainText('任务已过期', { timeout: 12_000 });
  await expect(plugin(page).getByRole('textbox', { name: '分析问题' })).toHaveValue('待恢复的问题');
  await expect(plugin(page).getByRole('button', { name: '开始分析', exact: true })).toBeEnabled();
  expect(backend.submissions()).toBe(1);
});
