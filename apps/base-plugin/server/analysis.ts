import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeQuestion,
  createAnalysisEngine,
  inspectJoin,
  loadJsonSnapshots,
} from '@ava/analysis-core';
import { createOpenAI } from '@ai-sdk/openai';
import type { AnalysisResult, Snapshot, ChartSpec, RelatedSnapshot } from '../shared/types';
import { demoSnapshot } from '../shared/demo';
import { demoPlan, demoSummary } from './demo-analysis';

export class JoinSelectionError extends Error {}

export type ModelConfig = { apiKey: string; model: string; baseURL?: string };

export async function runAnalysis(
  question: string,
  snapshot: Snapshot,
  mode: 'demo' | 'live',
  model?: ModelConfig,
  related?: RelatedSnapshot,
): Promise<AnalysisResult> {
  const start = performance.now();
  // Demo always uses our own fixture, even if the client submits another snapshot.
  const source = mode === 'demo' ? demoSnapshot : snapshot;
  const plan = mode === 'demo' ? demoPlan(question) : null;
  const deadline = Date.now() + 110_000;
  const languageModel = model
    ? createOpenAI({
        apiKey: model.apiKey,
        baseURL: model.baseURL,
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              ...(init?.signal ? [init.signal] : []),
              AbortSignal.timeout(Math.max(1, Math.min(45_000, deadline - Date.now()))),
            ]),
          }),
      }).chat(model.model)
    : null;
  // Keep DuckDB's allowed directory private to this request, including concurrent analyses.
  const directory = await mkdtemp(join(tmpdir(), 'ava-feishu-'));
  const ava = createAnalysisEngine(
    languageModel
      ? { model: languageModel, maxRetries: 0 }
      : { model: 'demo-no-model', apiKey: 'unused' },
    { queryTimeoutMs: 15_000, maxTempDirectorySize: '0B' },
  );
  try {
    const snapshots = related && mode === 'live' ? [source, related.snapshot] : [source];
    const names = await loadJsonSnapshots(
      ava,
      directory,
      snapshots.map(({ tableName, rows }) => ({
        name: tableName,
        rows,
      })),
    );
    let relationship = '';
    let joinQuality: AnalysisResult['joinQuality'];
    if (related && mode === 'live') {
      const primary = source.fields.find((f) => f.id === related.primaryFieldId);
      const lookup = related.snapshot.fields.find((f) => f.id === related.relatedFieldId);
      if (!primary || !lookup || primary.kind !== lookup.kind) {
        throw new JoinSelectionError('请选择两张表中类型相同、且已勾选的关联字段。');
      }
      const { quality, condition } = await inspectJoin(
        ava,
        { table: names[0], field: primary.name },
        { table: names[1], field: lookup.name },
      );
      if (quality.relatedDuplicateKeys) {
        throw new JoinSelectionError(
          `关联表有 ${quality.relatedDuplicateKeys} 个键值重复。请选择唯一字段或先整理关联表，避免重复统计。`,
        );
      }
      if (!quality.matchedRows) {
        throw new JoinSelectionError('所选关联键没有匹配记录。请检查字段、数据格式和视图范围。');
      }
      joinQuality = quality;
      relationship = `跨表时只使用已选关系。若要保留主表记录，使用 LEFT JOIN。关联条件：${condition}。主表 ${quality.primaryRows} 条，其中 ${quality.matchedRows} 条匹配，${quality.primaryMissingKeys} 条关联键为空。说明未匹配记录对统计口径的影响。\n`;
    }
    let data: Record<string, unknown>[], text: string, sql: string | undefined;
    let chart: ChartSpec | null = null,
      chartHtml: string | undefined,
      chartWarning: string | undefined;
    if (plan) {
      const result = await ava.query(plan.sql);
      data = result.data;
      sql = plan.sql;
      text = demoSummary(data, plan.dimension, plan.metric);
      chart = {
        chartType: plan.chartType,
        config: {
          type: plan.chartType,
          title: `${plan.dimension}${plan.metric}${plan.dimension === '月份' ? '趋势' : '对比'}`,
          data: data.map((d) => ({ category: String(d.category), value: Number(d.value) })),
          axisXTitle: plan.dimension,
          axisYTitle: plan.metric,
        },
      };
    } else {
      const result = await analyzeQuestion(ava, `${relationship}问题：${question}`, {
        maxRows: 1000,
      });
      data = result.data;
      text = result.text;
      sql = result.sql;
      if (result.truncated)
        text += '\n\n注意：计算结果达到返回上限，仅展示部分结果。请缩小问题范围后重新分析。';
      try {
        const visual = await ava.visualize({ query: question, data });
        if (visual) {
          chart = { chartType: visual.chartType, config: visual.config };
          chartHtml = visual.html;
        }
      } catch {
        chartWarning = '图表暂未生成，分析结论和计算结果仍可查看。';
      }
    }
    return {
      id: randomUUID(),
      query: question,
      text,
      sql,
      data,
      chart,
      chartHtml,
      chartWarning,
      rowCount: source.rows.length,
      joinQuality,
      elapsedMs: Math.round(performance.now() - start),
      mode,
      createdAt: new Date().toISOString(),
    };
  } finally {
    try {
      await ava.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
