import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../../shared/types';
import { chartUnavailableReason, computedChart } from '../../shared/visualization';
import { prepareGPTVisConfig } from '../../shared/gpt-vis-config';
import { GPTVisChart } from './GPTVisChart';
const palette = ['#71d6f0', '#f2887c', '#9bacdf', '#83c9b5', '#b4c9d8', '#d4b6da'];

export function Chart({ result }: { result: AnalysisResult }) {
  const [dimension, setDimension] = useState('');
  const [metric, setMetric] = useState('');
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const original = useMemo(() => prepareGPTVisConfig(result.chart), [result.chart]);
  const automatic = result.chartSource === 'computed' || !original || failed;
  const derived = useMemo(
    () => (automatic ? computedChart(result.data, result.query, dimension, metric) : null),
    [automatic, result.data, result.query, dimension, metric],
  );
  const chart = derived?.chart ?? (failed ? null : result.chart);
  const config = useMemo<Record<string, unknown> | null>(() => {
    const prepared = prepareGPTVisConfig(chart);
    if (!prepared) return null;
    const style = prepared.style && typeof prepared.style === 'object' ? prepared.style : {};
    return {
      ...prepared,
      ...(['bar', 'column'].includes(String(prepared.type))
        ? { label: prepared.label ?? false }
        : {}),
      style: { palette, ...style },
    };
  }, [chart]);
  const reset = () => {
    setFailed(false);
    setFallbackFailed(false);
  };
  if (!config || fallbackFailed)
    return (
      <div className="chart-unavailable" role="status">
        <p>
          {failed || fallbackFailed
            ? '图表暂时无法显示，数据和 SQL 仍可查看。'
            : result.chart && result.chart.chartType !== 'table'
              ? '当前图表配置无法绘制，请切换到“数据”核对结果。'
              : chartUnavailableReason(result.data)}
        </p>
        {(failed || fallbackFailed) && <button onClick={reset}>重试绘制</button>}
      </div>
    );
  const fallback =
    (failed || (!original && result.chart && result.chart.chartType !== 'table')) && derived;
  return (
    <div className="chart-container">
      <div className="chart-title">
        {typeof config.title === 'string' ? config.title : '数据可视化'}
        <span>{typeof config.axisYTitle === 'string' ? config.axisYTitle : ''}</span>
      </div>
      {fallback && (
        <p className="chart-render-note" role="status">
          原图表暂不可用，已根据计算结果绘制对比图。
        </p>
      )}
      {derived && (
        <div className="chart-controls">
          <label>
            分类
            <select
              aria-label="图表分类"
              value={derived.dimension}
              onChange={(event) => {
                setDimension(event.target.value);
                setFallbackFailed(false);
              }}
            >
              {derived.options.dimensions.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label>
            指标
            <select
              aria-label="图表指标"
              value={derived.metric}
              onChange={(event) => {
                setMetric(event.target.value);
                setFallbackFailed(false);
              }}
            >
              {derived.options.metrics.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <span>基于计算结果绘制</span>
        </div>
      )}
      <GPTVisChart
        key={failed ? 'fallback' : 'primary'}
        config={config}
        onError={() => (failed ? setFallbackFailed(true) : setFailed(true))}
      />
      {derived && derived.omitted > 0 && (
        <p className="table-note">
          当前指标有 {derived.omitted} 行空值，图中不绘制这些空值，也不将其当作 0。
        </p>
      )}
    </div>
  );
}
