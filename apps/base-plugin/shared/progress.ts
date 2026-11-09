import type { AnalysisProgress, AnalysisUpdate } from './types';

export const emptyProgress = (): AnalysisProgress => ({ steps: [], text: '' });

export function applyAnalysisUpdate(
  previous: AnalysisProgress | undefined,
  update: AnalysisUpdate,
): AnalysisProgress {
  const next = previous ?? emptyProgress();
  if (update.type === 'text') return { ...next, text: (next.text + update.delta).slice(0, 32_000) };
  if (update.type === 'query') return { ...next, sql: update.sql, data: update.data };
  if (update.type === 'chart')
    return {
      ...next,
      chart: update.chart,
      chartSource: update.chartSource,
      chartHtml: update.chartHtml,
    };
  const steps = [...next.steps];
  const index = steps.findIndex((step) => step.id === update.step.id);
  if (index < 0) steps.push(update.step);
  else steps[index] = update.step;
  return { ...next, steps: steps.slice(-30) };
}
