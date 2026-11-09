import { test, expect } from '@playwright/test';
import type { AnalysisResult } from '../../shared/types';

const aggregates = [
  { 品类: '咖啡', 记录数: 300, 平均金额: 250.5, 最低金额: 1.5 },
  { 品类: '果汁', 记录数: 300, 平均金额: 252.5, 最低金额: 2.5 },
  { 品类: '点心', 记录数: 300, 平均金额: 249.5, 最低金额: 0.5 },
  { 品类: '茶', 记录数: 300, 平均金额: 250.1667, 最低金额: 1 },
  { 品类: null, 记录数: 2, 平均金额: null, 最低金额: null },
];
const base: AnalysisResult = {
  id: 'antv-fixture',
  query: '分析各个品类的价格',
  text: '各品类的平均价格差异不大。',
  data: aggregates,
  chart: null,
  rowCount: 1202,
  mode: 'live',
  elapsedMs: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

async function open(page: import('@playwright/test').Page, result: AnalysisResult) {
  await page.setViewportSize({ width: 1720, height: 1150 });
  const external: string[] = [];
  // Renderer assets must be local even when old history still carries CDN-based HTML.
  await page.route(/https:\/\//, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.route('**/api/analysis-jobs', (route) =>
    route.fulfill({ json: { id: route.request().postDataJSON().id, status: 'succeeded', result } }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: '分析问题' }).fill(result.query);
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.getByRole('region', { name: '分析结果' })).toBeVisible();
  await page.getByRole('tab', { name: '可视化图表' }).click();
  await expect(page.locator('.antv-chart[data-state="ready"] canvas')).toBeVisible({
    timeout: 30_000,
  });
  expect(external).toEqual([]);
  await expect(page.locator('iframe')).toHaveCount(0);
}

test('官方 GPT-Vis 在禁用所有外部脚本时绘制分组图，旧 HTML 不参与渲染', async ({ page }, info) => {
  const result: AnalysisResult = {
    ...base,
    chart: {
      chartType: 'column',
      config: {
        type: 'column',
        title: '品类均价与中位数',
        group: true,
        data: [
          { category: '咖啡', value: 250.5, group: '均价' },
          { category: '咖啡', value: 251.5, group: '中位数' },
          { category: '茶', value: 250.1667, group: '均价' },
          { category: '茶', value: 250.5, group: '中位数' },
        ],
      },
    },
    chartHtml:
      '<script src="https://unpkg.com/@antv/gpt-vis/dist/umd/index.min.js"></script><script>throw new Error("legacy-html-must-not-run")</script>',
  };
  await open(page, result);
  await expect(page.locator('.antv-chart')).toHaveAttribute('data-chart-type', 'column');
  await page
    .getByRole('region', { name: '分析结果' })
    .screenshot({ path: info.outputPath('antv-grouped.png') });
});

test('汇总价格数据不伪造箱线分布，改用官方库绘制均值并保留完整结果表', async ({ page }, info) => {
  await open(page, {
    ...base,
    chart: {
      chartType: 'boxplot',
      config: {
        type: 'boxplot',
        data: aggregates.map((row) => ({ category: row.品类, value: row.平均金额 })),
      },
    },
  });
  await expect(page.getByText('原图表暂不可用，已根据计算结果绘制对比图。')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '图表指标' })).toHaveValue('平均金额');
  await expect(page.locator('.antv-chart')).toHaveAttribute('data-chart-type', 'column');
  await page
    .getByRole('region', { name: '分析结果' })
    .screenshot({ path: info.outputPath('antv-price-comparison.png') });
  await page.getByRole('tab', { name: '计算结果' }).click();
  await expect(page.getByRole('cell', { name: '250.1667', exact: true })).toBeVisible();
});

test('有实际分布数据时直接使用官方箱线图，刷新后仍无需 CDN', async ({ page }) => {
  const values = [12, 14, 16, 20, 25, 28, 32, 35];
  await open(page, {
    ...base,
    data: values.map((value, index) => ({ 品类: index < 4 ? '咖啡' : '茶', 金额: value })),
    chart: {
      chartType: 'boxplot',
      config: {
        type: 'boxplot',
        title: '品类价格分布',
        data: values.map((value, index) => ({ category: index < 4 ? '咖啡' : '茶', value })),
      },
    },
  });
  await expect(page.locator('.antv-chart')).toHaveAttribute('data-chart-type', 'boxplot');
  await page.reload();
  await expect(page.locator('.antv-chart[data-state="ready"] canvas')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('官方图表资源不可用时显示可恢复错误，数据仍可核对', async ({ page }) => {
  await page.route(/\/node_modules\/\.vite\/deps\/@antv_gpt-vis\.js/, (route) => route.abort());
  await page.route('**/api/analysis-jobs', (route) =>
    route.fulfill({
      json: {
        id: route.request().postDataJSON().id,
        status: 'succeeded',
        result: {
          ...base,
          chart: {
            chartType: 'column',
            config: {
              type: 'column',
              data: [
                { category: '咖啡', value: 250.5 },
                { category: '茶', value: 250.1667 },
              ],
            },
          },
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: '分析问题' }).fill(base.query);
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.getByText('图表暂时无法显示，数据和 SQL 仍可查看。')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: '重试绘制' })).toBeVisible();
  await page.getByRole('tab', { name: '计算结果' }).click();
  await expect(page.getByRole('cell', { name: '250.1667', exact: true })).toBeVisible();
});
