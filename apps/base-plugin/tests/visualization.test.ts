import { expect, it } from 'vitest';
import { chartOptions, computedChart } from '../shared/visualization';
import { prepareGPTVisConfig } from '../shared/gpt-vis-config';

const overview = [
  { 类别: '点心', 记录数: 300, 金额合计: 74850, 金额均值: 249.5, 完成状态缺失数: 0 },
  { 类别: '果汁', 记录数: 300, 金额合计: 75750, 金额均值: 252.5, 完成状态缺失数: 0 },
  { 类别: '咖啡', 记录数: 300, 金额合计: 75150, 金额均值: 250.5, 完成状态缺失数: 0 },
  { 类别: '茶', 记录数: 300, 金额合计: 75050, 金额均值: 250.1667, 完成状态缺失数: 0 },
  { 类别: null, 记录数: 2, 金额合计: null, 金额均值: null, 完成状态缺失数: 2 },
];

it('多指标分类概览默认绘制金额合计，切换均值不改变原计算结果，空值不转成零', () => {
  const chart = computedChart(overview, '分析一下')!;
  expect(chart.metric).toBe('金额合计');
  expect(chart.dimension).toBe('类别');
  expect(chart.chart.chartType).toBe('column');
  expect(chart.omitted).toBe(1);
  expect(chart.chart.config.data).toEqual(
    overview.map((row) => ({ category: row.类别 ?? '（空值）', value: row.金额合计 })),
  );
  const average = computedChart(overview, '分析一下', '类别', '金额均值')!;
  expect(prepareGPTVisConfig(average.chart)).toMatchObject({
    data: [{ value: 249.5 }, { value: 252.5 }, { value: 250.5 }, { value: 250.1667 }],
  });
  expect(overview[0].金额合计).toBe(74850);
  expect(computedChart(overview, '比较平均金额')?.metric).toBe('金额均值');
  const counts = computedChart(overview, '分析一下', '类别', '完成状态缺失数')!;
  expect(prepareGPTVisConfig(counts.chart)).toMatchObject({
    data: [{ value: 0 }, { value: 0 }, { value: 0 }, { value: 0 }, { value: 2 }],
  });
});

it('时间趋势排序，负值不使用饼图，数值 ID 不作为度量', () => {
  const trend = computedChart(
    [
      { 月份: '2026-02', 金额: 2, id: 1 },
      { 月份: '2026-01', 金额: 1, id: 2 },
    ],
    '分析一下',
  )!;
  expect(trend.chart.chartType).toBe('line');
  expect(prepareGPTVisConfig(trend.chart)).toMatchObject({
    data: [
      { time: '2026-01', value: 1 },
      { time: '2026-02', value: 2 },
    ],
  });
  expect(trend.options.metrics).toEqual(['金额']);
  expect(
    computedChart(
      [
        { 类别: 'a', 金额: 2 },
        { 类别: 'b', 金额: -1 },
      ],
      '金额占比',
    )?.chart.chartType,
  ).toBe('column');
});

it('明细重复分类、单行数值、空结果或超出展示范围时不猜测聚合', () => {
  expect(
    chartOptions(
      [
        { 类别: 'a', 金额: 1 },
        { 类别: 'a', 金额: 2 },
      ],
      '分析一下',
    ),
  ).toBeNull();
  expect(computedChart([{ 合计: 1 }], '分析一下')).toBeNull();
  expect(computedChart([], '分析一下')).toBeNull();
  expect(
    computedChart(
      Array.from({ length: 51 }, (_, index) => ({ 类别: String(index), 金额: index })),
      '分析一下',
    ),
  ).toBeNull();
});

it('官方图表配置适配旧版时间字段，保留零值与分组，跳过缺失值', () => {
  const chart = {
    chartType: 'line' as const,
    config: {
      type: 'line',
      data: [
        { category: '2026-01', value: null },
        { category: '2026-02', value: 0, group: 'A' },
      ],
    },
  };
  expect(prepareGPTVisConfig(chart)).toMatchObject({
    data: [{ time: '2026-02', value: 0, group: 'A' }],
  });
  expect(chart.config.data).toHaveLength(2);
  expect(
    prepareGPTVisConfig({
      ...chart,
      config: { type: 'line', data: [{ category: 'a', value: true }] },
    }),
  ).toBeNull();
});

it('双轴图严格对齐分类与数值，本地配置不把空值改为零', () => {
  const chart = {
    chartType: 'dual-axes' as const,
    config: {
      type: 'dual-axes',
      categories: ['01月', '02月'],
      series: [
        { type: 'column', axisYTitle: '收入', data: [120, 130] },
        { type: 'line', axisYTitle: '毛利率', data: [30, null] },
      ],
    },
  };
  expect(prepareGPTVisConfig(chart)).toMatchObject({
    categories: ['01月', '02月'],
    series: [{ data: [120, 130] }, { data: [30, null] }],
  });
  expect(
    prepareGPTVisConfig({ ...chart, config: { ...chart.config, categories: ['01月'] } }),
  ).toBeNull();
});

it('每类只有汇总均值的结果不能伪造箱线分布，价格问题可回退到均值对比', () => {
  const rows = [
    { 品类: '咖啡', 平均金额: 250.5, 最低金额: 1.5 },
    { 品类: '茶', 平均金额: 251.5, 最低金额: 0.5 },
  ];
  const chart = {
    chartType: 'boxplot' as const,
    config: {
      type: 'boxplot',
      data: rows.map((row) => ({ category: row.品类, value: row.平均金额 })),
    },
  };
  expect(prepareGPTVisConfig(chart)).toBeNull();
  expect(computedChart(rows, '分析各个品类的价格')?.metric).toBe('平均金额');
  expect(
    prepareGPTVisConfig({
      ...chart,
      config: {
        type: 'boxplot',
        data: [
          { category: '咖啡', value: 1 },
          { category: '咖啡', value: 2 },
          { category: '茶', value: 3 },
          { category: '茶', value: 4 },
        ],
      },
    }),
  ).not.toBeNull();
});
