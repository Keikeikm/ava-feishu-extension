import type { AnalysisResult, ChartSpec } from './types';

type Data = AnalysisResult['data'];
const missing = (value: unknown) => value == null || value === '';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const temporal = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}(?:-\d{2}(?:[T ].*)?)?$/.test(value);
const label = (value: unknown) => (missing(value) ? '（空值）' : String(value));

/** Only chart already-computed, uniquely grouped rows. Never re-aggregate or use source rows. */
export function chartOptions(data: Data, query: string) {
  if (data.length < 2 || data.length > 50) return null;
  const keys = [...new Set(data.flatMap((row) => Object.keys(row)))];
  const metrics = keys.filter((key) => {
    if (/^(?:id|.*[_\s]id)$|编号|序号|编码/i.test(key)) return false;
    const values = data.map((row) => row[key]).filter((value) => !missing(value));
    return values.length > 0 && values.every(finite);
  });
  const dimensions = keys.filter((key) => {
    const values = data.map((row) => row[key]);
    if (!values.some((value) => typeof value === 'string' && value !== '')) return false;
    if (!values.every((value) => missing(value) || typeof value === 'string')) return false;
    // Duplicate categories need an explicit aggregation rule, rather than a guessed SUM.
    return new Set(values.map(label)).size === data.length;
  });
  if (!metrics.length || !dimensions.length) return null;
  const dimensionScore = (key: string) =>
    (query.includes(key) ? 100 : 0) +
    (/类别|品类|分类|地区|产品|渠道|category|region/i.test(key) ? 30 : 0) +
    (data.every((row) => missing(row[key]) || temporal(row[key])) &&
    /趋势|按月|按日|时间/.test(query)
      ? 60
      : 0);
  const metricScore = (key: string) =>
    (query.includes(key) ? 100 : 0) +
    (/金额|销售额|revenue/i.test(key) ? 25 : 0) +
    (/合计|总额|总和|sum|total/i.test(key) ? 25 : 0) +
    (/平均|均值|avg|mean/i.test(key)
      ? /平均|均值|价格|price|avg|mean/i.test(query)
        ? 60
        : -10
      : 0) -
    (/去重|缺失|distinct|unique|missing|null/i.test(key) ? 70 : 0);
  const dimension = [...dimensions].sort((a, b) => dimensionScore(b) - dimensionScore(a))[0];
  const metric = [...metrics].sort((a, b) => metricScore(b) - metricScore(a))[0];
  return { dimensions, metrics, dimension, metric };
}

export function computedChart(data: Data, query: string, dimension?: string, metric?: string) {
  const options = chartOptions(data, query);
  if (!options) return null;
  const x = dimension && options.dimensions.includes(dimension) ? dimension : options.dimension;
  const y = metric && options.metrics.includes(metric) ? metric : options.metric;
  const points = data.map((row) => ({
    category: label(row[x]),
    value: finite(row[y]) ? (row[y] as number) : null,
  }));
  const isTime = data.every((row) => missing(row[x]) || temporal(row[x]));
  const isPie =
    /占比|构成|饼图/.test(query) &&
    points.every((point) => point.value !== null && point.value >= 0) &&
    points.some((point) => point.value! > 0);
  const chartType = isPie
    ? 'pie'
    : isTime
      ? 'line'
      : points.length > 8 || points.some((point) => point.category.length > 10)
        ? 'bar'
        : 'column';
  if (isTime) points.sort((a, b) => a.category.localeCompare(b.category));
  const chart: ChartSpec = {
    chartType,
    config: {
      type: chartType,
      title: `${x} · ${y}`,
      axisXTitle: x,
      axisYTitle: y,
      data: points,
    },
  };
  return {
    chart,
    options,
    dimension: x,
    metric: y,
    omitted: points.filter((point) => point.value === null).length,
  };
}

export function chartUnavailableReason(data: Data) {
  if (!data.length) return '本次查询没有返回数据，可调整问题后重试。';
  if (data.length === 1) return '本次只有一行汇总结果，可在「计算结果」中查看具体数值。';
  if (data.length > 50)
    return '结果较多，请按类别或时间汇总后生成图表；完整结果可在「计算结果」查看。';
  return '当前结果缺少可直接绘图的分类与数值组合，可尝试按类别汇总金额或按月份统计趋势。';
}
