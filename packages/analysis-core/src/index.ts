import { AVA, type LLMConfig } from '@antv/ava';

export { loadJsonSnapshots, loadSqliteTables, quoteIdentifier, TableRowTooLargeError } from './tables.js';
export { inspectJoin, type JoinQuality } from './relationships.js';
export type { AnalysisResponse, ChartSpec, ExecutionResult, LLMConfig, VisualizeResponse } from '@antv/ava';

export function createAnalysisEngine(
  llm: LLMConfig,
  limits: { queryTimeoutMs: number; maxTempDirectorySize: string },
): AVA {
  return new AVA({
    llm,
    engine: { type: 'duckdb', memoryLimit: '256MB', threads: 1, ...limits },
  });
}

export function analyzeQuestion(ava: AVA, prompt: string, options: Parameters<AVA['analyze']>[1]) {
  return ava.analyze(
    `请用简体中文回答。数值必须基于查询结果，注明统计口径和缺失值限制，不要编造数据或因果关系。\n${prompt}`,
    options,
  );
}
