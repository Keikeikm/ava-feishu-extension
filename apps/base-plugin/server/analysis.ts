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
import type {
  AnalysisResult,
  Snapshot,
  ChartSpec,
  RelatedSnapshot,
  AnalysisUpdate,
  AnalysisStep,
} from '../shared/types';
import { demoSnapshot } from '../shared/demo';
import { demoPlan, demoSummary } from './demo-analysis';
import { streamSummary } from './stream-summary';
import { computedChart } from '../shared/visualization';
import { prepareGPTVisConfig } from '../shared/gpt-vis-config';

export class JoinSelectionError extends Error {}

export type ModelConfig = { apiKey: string; model: string; baseURL?: string };

export async function runAnalysis(
  question: string,
  snapshot: Snapshot,
  mode: 'demo' | 'live',
  model?: ModelConfig,
  related?: RelatedSnapshot,
  onUpdate?: (update: AnalysisUpdate) => void,
): Promise<AnalysisResult> {
  const start = performance.now();
  const steps: AnalysisStep[] = [];
  const publish = (update: AnalysisUpdate) => {
    onUpdate?.(update);
  };
  const step = (id: string, label: string, status: AnalysisStep['status'], detail?: string) => {
    const value = { id, label, status, detail };
    const index = steps.findIndex((item) => item.id === id);
    if (index < 0) steps.push(value);
    else steps[index] = value;
    publish({ type: 'step', step: value });
  };
  step('source', '读取所选数据快照', 'running');
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
    step(
      'source',
      '读取所选数据快照',
      'done',
      `${snapshots.length} 张表 · ${snapshots.reduce((sum, data) => sum + data.rows.length, 0)} 条记录`,
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
    // Subscribe only after import, so loader paths and intermediate source rows are not exposed.
    ava.on('schemastart', () => step('profile', '检查结构与数据范围', 'running'));
    ava.on('profileend', () => step('profile', '检查结构与数据范围', 'done'));
    ava.on('translatestart', () => step('translate', '将问题转换为查询', 'running'));
    ava.on('translateend', (event: { data?: { error?: unknown } }) =>
      step('translate', '将问题转换为查询', event.data?.error ? 'error' : 'done'),
    );
    ava.on('querystart', () => step('query', '执行只读查询', 'running'));
    ava.on('queryend', (event: { data?: { error?: unknown; data?: unknown[] } }) =>
      step(
        'query',
        '执行只读查询',
        event.data?.error ? 'error' : 'done',
        event.data?.data ? `返回 ${event.data.data.length} 行` : undefined,
      ),
    );
    let data: Record<string, unknown>[], text: string, sql: string | undefined;
    let chart: ChartSpec | null = null,
      chartHtml: string | undefined,
      chartWarning: string | undefined;
    let chartSource: AnalysisResult['chartSource'];
    if (plan) {
      const result = await ava.query(plan.sql);
      data = result.data;
      sql = plan.sql;
      text = demoSummary(data, plan.dimension, plan.metric);
      publish({ type: 'query', sql, data });
      step('summary', '整理分析结论', 'done');
      publish({ type: 'text', delta: text });
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
        ...(onUpdate ? { includeSummary: false } : {}),
      });
      data = result.data;
      text = result.text;
      sql = result.sql;
      publish({ type: 'query', sql: sql || '', data });
      if (onUpdate && languageModel) {
        step('summary', '解读查询结果', 'running');
        try {
          const summary = await streamSummary(
            languageModel,
            question,
            sql || '',
            { data, truncated: result.truncated },
            publish,
          );
          text = summary.text;
          step(
            'summary',
            '解读查询结果',
            'done',
            summary.streamed ? '文本已实时返回' : '模型按整段返回',
          );
        } catch {
          text = `查询已完成，返回 ${data.length} 行。模型未能完成解读，可在「数据」和「SQL」中核对计算结果。`;
          step('summary', '解读查询结果', 'error', '模型解读未完成，已保留计算结果');
        }
      }
      if (result.truncated)
        text += '\n\n注意：计算结果达到返回上限，仅展示部分结果。请缩小问题范围后重新分析。';
      step('chart', '生成可视化图表', 'running');
      try {
        const visual = await ava.visualize({ query: question, data });
        if (visual) {
          chart = { chartType: visual.chartType, config: visual.config };
          // Clients render the typed config with the locally bundled AntV renderer.
          chartSource = 'ava';
        }
      } catch {
        chartWarning = '图表暂未生成，分析结论和计算结果仍可查看。';
      }
    }
    if (!prepareGPTVisConfig(chart)) {
      const fallback = computedChart(data, question);
      if (fallback) {
        chart = fallback.chart;
        chartSource = 'computed';
        chartHtml = undefined;
        chartWarning = undefined;
      }
    }
    step('chart', '生成可视化图表', 'done', chart ? '图表配置已生成' : '结果适合数据表查看');
    publish({ type: 'chart', chart, chartSource, chartHtml });
    return {
      id: randomUUID(),
      query: question,
      text,
      sql,
      data,
      chart,
      chartHtml,
      chartSource,
      chartWarning,
      rowCount: source.rows.length,
      joinQuality,
      steps,
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
