import type { AnalysisResponse, ChartSpec, JoinQuality } from '@ava/analysis-core';

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Field = { id: string; name: string; kind: 'number' | 'text' | 'date' | 'boolean' };

export interface Snapshot {
  tableId: string;
  tableName: string;
  viewId?: string;
  viewName?: string;
  fields: Field[];
  rows: Row[];
  loadedAt: string;
  source: 'demo' | 'feishu';
}

export interface RelatedSnapshot {
  snapshot: Snapshot;
  primaryFieldId: string;
  relatedFieldId: string;
}

export type { ChartSpec };

export interface AnalysisResult extends Pick<AnalysisResponse, 'query' | 'text' | 'sql' | 'data'> {
  id: string;
  chart: ChartSpec | null;
  chartHtml?: string;
  chartWarning?: string;
  rowCount: number;
  joinQuality?: JoinQuality;
  elapsedMs: number;
  mode: 'demo' | 'live';
  createdAt: string;
}

export interface ServerStatus {
  ready: boolean;
  model: string | null;
  authRequired: boolean;
}
export const MAX_ROWS = 10_000;
export const MAX_FIELDS = 80;
export const DEMO_QUESTIONS = [
  '每个月的销售额趋势如何？',
  '哪个地区的销售额最高？',
  '不同产品的销售额占比是多少？',
  '各渠道的订单量对比如何？',
] as const;
