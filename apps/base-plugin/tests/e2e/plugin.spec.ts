import { test, expect } from '@playwright/test';

test('完整演示：提问、图表、结果、SQL 和导出', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('让数据，开口说话。');
  await page.getByRole('button', { name: /发现趋势/ }).click();
  await expect(page.getByRole('region', { name: '分析结果' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.recharts-line')).toBeVisible();
  await expect(page.getByRole('tab', { name: '可视化图表' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: /计算结果/ }).click();
  await expect(page.getByRole('cell', { name: '2026-01', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '查询依据' }).click();
  await expect(page.locator('.sql-block')).toContainText('SUM("销售额")');
  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出计算结果 CSV' }).click();
  expect((await csvPromise).suggestedFilename()).toBe('AVA-计算结果.csv');
  const reportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告' }).click();
  expect((await reportPromise).suggestedFilename()).toBe('AVA-分析报告.md');
});

test('普通浏览器连接飞书时给出明确提示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '连接飞书数据' }).click();
  await page.getByRole('button', { name: '连接当前多维表格' }).click();
  await expect(page.getByRole('alert')).toContainText('请在飞书多维表格');
});

test('演示自由输入不生成虚构答案，仍可预览原始数据', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '分析问题' }).fill('预测明年的销售额');
  await page.getByRole('button', { name: '开始分析' }).click();
  await expect(page.getByRole('alert')).toContainText('演示模式支持');
  await page.getByRole('button', { name: /数据预览/ }).click();
  await expect(page.getByRole('heading', { name: '源数据预览' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '销售额', exact: true })).toBeVisible();
});

test('窄屏完成分析，无水平溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /比较表现/ }).click();
  await expect(page.locator('.recharts-bar')).toBeVisible({ timeout: 30_000 });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test('正式插件构建在宿主外显示未连接，不自动展示演示数据', async ({ page }) => {
  await page.goto('/plugin/dist/index.html');
  await expect(page.getByRole('heading', { name: '请在飞书多维表格中打开 AVA' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '分析问题' })).toHaveCount(0);
  await expect(page.getByText('数据已连接', { exact: false })).toHaveCount(0);
  await expect(page.getByText('销售经营数据', { exact: true })).toHaveCount(0);
  await expect(page.getByText('正在使用虚构的销售数据。', { exact: false })).toHaveCount(0);
});

test('飞书 SDK 夹具：关联两张表，只提交选定视图的已勾选字段', async ({ page }) => {
  await page.route('**/mock-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<iframe title="飞书宿主夹具" src="/mock-plugin" width="1100" height="760"></iframe>',
    }),
  );
  await page.route('**/mock-plugin', (route) =>
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
      const table = (name, fields, records) => ({
        getName: async () => name,
        getFieldMetaList: async () => fields.map(([id, name]) => ({ id, name, type: 1 })),
        getViewMetaList: async () => [{ id: 'filtered', name: '仅可见字段', type: 1 }],
        getViewById: async () => ({ getVisibleFieldIdList: async () => ['id', 'region'] }),
        getRecordsByPage: async () => ({ total: 1, hasMore: false, records: [{ fields: records }] }),
      });
      const orders = table('订单', [['customer', '客户号']], { customer: '001' });
      const customers = table('客户', [['id', '编号'], ['region', '地区'], ['private', '隐藏字段']],
        { id: '001', region: '华东', private: 'secret' });
      export const bitable = {
        base: {
          getTableMetaList: async () => [{ id: 'orders', name: '订单' }, { id: 'customers', name: '客户' }],
          getSelection: async () => ({ tableId: 'orders' }),
          getTableById: async (id) => id === 'orders' ? orders : customers,
        },
        bridge: { getData: async () => null },
      };
    `,
    }),
  );
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: { ready: true, model: 'fixture', authRequired: false },
    }),
  );
  await page.route('**/api/analyze', (route) =>
    route.fulfill({
      json: {
        id: 'result',
        query: '统计订单',
        text: '共一条订单。',
        data: [{ count: 1 }],
        chart: null,
        rowCount: 1,
        elapsedMs: 1,
        mode: 'live',
        createdAt: '2026-01-01T00:00:00Z',
        joinQuality: {
          matchedRows: 1,
          primaryRows: 1,
          primaryMissingKeys: 0,
          relatedMissingKeys: 0,
        },
      },
    }),
  );
  await page.goto('/mock-host');
  const plugin = page.frameLocator('iframe');
  await plugin.getByRole('button', { name: '添加关联表' }).click();
  await plugin.getByRole('combobox', { name: '关联表', exact: true }).selectOption('customers');
  await plugin.getByRole('combobox', { name: '关联表记录范围' }).selectOption('filtered');
  await plugin.getByRole('button', { name: '加载并选择关联键' }).click();
  await expect(plugin.getByLabel('隐藏字段')).toHaveCount(0);
  await plugin.getByLabel('地区', { exact: true }).uncheck();
  await plugin.getByRole('combobox', { name: '主表关联键' }).selectOption('customer');
  await plugin.getByRole('combobox', { name: '关联表唯一键' }).selectOption('id');
  await plugin.getByRole('button', { name: '完成选择' }).click();
  await plugin.getByRole('textbox', { name: '分析问题' }).fill('统计订单');
  const submitted = page.waitForRequest('**/api/analyze');
  await plugin.getByRole('button', { name: '开始分析' }).click();
  expect((await submitted).postDataJSON().related).toMatchObject({
    primaryFieldId: 'customer',
    relatedFieldId: 'id',
    snapshot: { tableId: 'customers', viewId: 'filtered', rows: [{ 编号: '001' }] },
  });
  await expect(plugin.getByText(/关联键匹配：1 \/ 1 条主表记录/)).toBeVisible();
});
