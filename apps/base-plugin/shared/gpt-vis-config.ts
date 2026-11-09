import type { ChartSpec } from './types';

const supported = new Set([
  'line',
  'area',
  'bar',
  'column',
  'pie',
  'scatter',
  'dual-axes',
  'histogram',
  'boxplot',
  'violin',
  'radar',
  'funnel',
  'waterfall',
  'liquid',
  'word-cloud',
  'venn',
  'treemap',
  'sankey',
]);
const number = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const category = (value: unknown) => (value == null || value === '' ? '（空值）' : String(value));

/** Adapt legacy chart points to the official GPT-Vis schema without inventing values. */
export function prepareGPTVisConfig(chart: ChartSpec | null): Record<string, unknown> | null {
  if (!chart || !supported.has(chart.chartType)) return null;
  const config: Record<string, unknown> = { ...chart.config, type: chart.chartType };
  const type = chart.chartType;
  if (
    ['line', 'area', 'bar', 'column', 'pie', 'boxplot', 'violin', 'funnel', 'waterfall'].includes(
      type,
    )
  ) {
    if (!Array.isArray(config.data) || !config.data.length) return null;
    const points: Record<string, unknown>[] = [];
    for (const row of config.data) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      // A missing measure stays missing, rather than becoming a zero-valued observation.
      if (type === 'waterfall' && row.isTotal === true && row.value == null) {
        points.push({ ...row, category: category(row.category) });
        continue;
      }
      if (row.value == null || row.value === '') continue;
      const value = number(row.value);
      if (value === null) return null;
      const dimension = row.time ?? row.category;
      points.push({
        ...row,
        value,
        ...(['line', 'area'].includes(type)
          ? { time: category(dimension) }
          : { category: category(dimension) }),
      });
    }
    if (!points.length) return null;
    if (type === 'boxplot' || type === 'violin') {
      const counts = new Map<string, number>();
      for (const point of points) {
        const key = JSON.stringify([point.category, point.group]);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      // A single average per category cannot describe a price distribution.
      if ([...counts.values()].some((count) => count < 2)) return null;
    }
    if (
      type === 'pie' &&
      (points.some((point) => Number(point.value) < 0) ||
        !points.some((point) => Number(point.value) > 0))
    )
      return null;
    return { ...config, data: points };
  }
  if (type === 'dual-axes') {
    const { categories, series } = config;
    if (
      !Array.isArray(categories) ||
      !categories.length ||
      !categories.every((value) => typeof value === 'string' || typeof value === 'number') ||
      !Array.isArray(series) ||
      series.length < 2
    )
      return null;
    const normalized = [];
    for (const item of series) {
      if (
        !item ||
        !['line', 'column'].includes(item.type) ||
        !Array.isArray(item.data) ||
        item.data.length !== categories.length
      )
        return null;
      if (item.data.some((value: unknown) => value != null && number(value) === null)) return null;
      normalized.push({
        ...item,
        data: item.data.map((value: unknown) => (value == null ? null : number(value))),
      });
    }
    return { ...config, categories: categories.map(String), series: normalized };
  }
  if (type === 'scatter') {
    if (
      !Array.isArray(config.data) ||
      !config.data.length ||
      config.data.some((row) => !row || number(row.x) === null || number(row.y) === null)
    )
      return null;
    return {
      ...config,
      data: config.data.map((row) => ({ ...row, x: number(row.x), y: number(row.y) })),
    };
  }
  if (type === 'histogram') {
    if (
      !Array.isArray(config.data) ||
      !config.data.length ||
      config.data.some((value) => number(value) === null)
    )
      return null;
    return { ...config, data: config.data.map(number) };
  }
  if (type === 'liquid') {
    const percent = number(config.percent);
    return percent !== null && percent >= 0 && percent <= 1 ? { ...config, percent } : null;
  }
  if (!Array.isArray(config.data) || !config.data.length) return null;
  if (
    type === 'radar' &&
    config.data.some((row) => !row || typeof row.name !== 'string' || number(row.value) === null)
  )
    return null;
  if (
    type === 'word-cloud' &&
    config.data.some((row) => !row || typeof row.text !== 'string' || number(row.value) === null)
  )
    return null;
  if (
    type === 'venn' &&
    config.data.some(
      (row) => !row || !Array.isArray(row.sets) || !row.sets.length || number(row.value) === null,
    )
  )
    return null;
  if (
    type === 'sankey' &&
    config.data.some(
      (row) =>
        !row ||
        typeof row.source !== 'string' ||
        typeof row.target !== 'string' ||
        number(row.value) === null,
    )
  )
    return null;
  return config;
}
