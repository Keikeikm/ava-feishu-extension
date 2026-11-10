import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  Database,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Table2,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import type { AnalysisResult, AnalysisStep, PendingAnalysis, Snapshot } from '../../shared/types';
import { DataTable } from './DataTable';
import { download, toCsv } from '../lib/export';
import './analytics.css';
const Chart = lazy(() => import('./Chart').then((module) => ({ default: module.Chart })));
type Tab = 'chart' | 'data' | 'sql';

function Steps({ steps, running }: { steps: AnalysisStep[]; running: boolean }) {
  if (!steps.length) return null;
  return (
    <details className="analysis-trace" open>
      <summary>
        <ChevronDown size={15} />
        <span>分析过程 · {steps.length} 个步骤</span>
        {running && <span className="trace-live">实时更新</span>}
      </summary>
      <ol>
        {steps.map((step) => (
          <li key={step.id} data-status={step.status}>
            {step.status === 'running' ? (
              <LoaderCircle size={15} className="spin" />
            ) : step.status === 'error' ? (
              <span>!</span>
            ) : (
              <Check size={15} />
            )}
            <span>{step.label}</span>
            {step.detail && <small>{step.detail}</small>}
          </li>
        ))}
      </ol>
    </details>
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>
      {text}
    </ReactMarkdown>
  );
}

export function AnalyticsWorkspace({
  snapshot,
  relatedName,
  mode,
  pending,
  result,
  history,
  question,
  onQuestion,
  onAnalyze,
  onSelect,
  tab,
  onTab,
  inputRef,
  disabled,
  questions,
  onExport,
}: {
  snapshot: Snapshot;
  relatedName?: string;
  mode: 'demo' | 'live';
  pending: PendingAnalysis | null;
  result: AnalysisResult | null;
  history: AnalysisResult[];
  question: string;
  onQuestion: (value: string) => void;
  onAnalyze: (question: string, consumeDraft?: boolean) => void;
  onSelect: (result: AnalysisResult) => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  questions: string[];
  onExport: (result: AnalysisResult) => void;
}) {
  const busy = !!pending;
  const progress = pending?.progress;
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const activeText = busy ? progress?.text || '' : result?.text || '';
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [activeText, progress?.steps, pending?.id]);
  const artifact: AnalysisResult | null = pending
    ? progress?.data || progress?.text
      ? {
          id: pending.id,
          query: pending.query,
          text: progress.text,
          data: progress.data || [],
          sql: progress.sql,
          chart: progress.chart || null,
          chartHtml: progress.chartHtml,
          chartSource: progress.chartSource,
          elapsedMs: 0,
          mode,
          rowCount: snapshot.rows.length,
          createdAt: pending.createdAt,
        }
      : null
    : result;
  const steps = busy ? progress?.steps || [] : result?.steps || [];
  const summary = activeText
    .split(/\n\s*\n/)[0]
    .replace(/^#+\s*/, '')
    .slice(0, 280);
  const submit = (value: string, consumeDraft = false) => {
    if (busy || disabled) return;
    follow.current = true;
    onAnalyze(value, consumeDraft);
  };
  return (
    <section className="analytics-workspace" aria-label="AVA 分析工作台">
      <div className="conversation-pane">
        <div
          className="conversation-scroll"
          ref={scroll}
          onScroll={(event) => {
            const node = event.currentTarget;
            follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }}
        >
          <div className="dataset-chip">
            <Table2 size={14} />
            <span>
              {snapshot.tableName}
              {relatedName ? ` + ${relatedName}` : ''}
            </span>
            <small>{snapshot.rows.length.toLocaleString()} 条记录</small>
          </div>
          {history
            .filter((item) => item.id !== result?.id || busy)
            .slice()
            .reverse()
            .map((item) => (
              <button
                className="previous-answer"
                key={item.id}
                onClick={() => onSelect(item)}
                disabled={busy}
              >
                <span>{item.query}</span>
                <small>{item.text.slice(0, 90)}</small>
                <span>查看分析 ↗</span>
              </button>
            ))}
          {pending || result ? (
            <>
              <div className="user-question">
                <span>{pending?.query || result?.query}</span>
              </div>
              <div className="assistant-identity">
                <span>
                  <Sparkles size={17} />
                </span>
                <strong>AVA</strong>
                <small>{busy ? '正在分析' : '分析完成'}</small>
              </div>
              <Steps steps={steps} running={busy} />
              <div
                className={`conversation-answer ${busy ? 'streaming-answer' : ''}`}
                aria-live="polite"
                aria-busy={busy}
              >
                {activeText ? (
                  <Markdown text={activeText} />
                ) : (
                  <div className="answer-waiting" role="status">
                    <LoaderCircle size={16} className="spin" />
                    <span>正在寻找数据中的答案</span>
                    <p>从所选数据出发，执行查询并整理结论。切换页面后任务仍会继续。</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="conversation-welcome">
              <span className="welcome-mark">
                <Sparkles size={30} />
              </span>
              <h2>让每个问题，都有数据作答。</h2>
              <p>描述你想了解的指标、维度或变化，AVA 会展示分析过程与结果。</p>
            </div>
          )}
          {!busy && (
            <div className="analytics-suggestions">
              {questions
                .filter((value) => value !== result?.query)
                .slice(0, result ? 2 : 4)
                .map((value, index) => (
                  <button
                    key={value}
                    disabled={disabled}
                    onClick={() => submit(value)}
                  >
                    <span>{['发现趋势', '比较表现', '探索构成', '深入数据'][index]}</span>
                    {value}
                    <TrendingUp size={14} />
                  </button>
                ))}
            </div>
          )}
        </div>
        <form
          className="analytics-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit(question, true);
          }}
        >
          <textarea
            ref={inputRef}
            aria-label="分析问题"
            placeholder={busy ? '分析中，可以先写下一个问题…' : '说说你想分析什么…'}
            value={question}
            maxLength={2000}
            onChange={(event) => onQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(question, true);
              }
            }}
          />
          <div>
            <span>
              <Database size={13} />
              {mode === 'demo' ? '演示数据 · 只读分析' : '所选字段 · 只读分析'}
            </span>
            <button
              className="analytics-send"
              aria-label="开始分析"
              type="submit"
              disabled={busy || disabled || !question.trim()}
            >
              {busy ? <LoaderCircle className="spin" size={19} /> : <ArrowUp size={20} />}
            </button>
          </div>
        </form>
        <p className="analytics-disclosure">
          <ShieldCheck size={11} />
          {mode === 'demo'
            ? '演示查询由 AVA 计算，不调用模型。'
            : '仅在提问时发送所选字段，模型接收统计信息与查询结果。'}
        </p>
      </div>
      {artifact ? (
        <section className="artifact-pane" aria-label="分析结果" aria-busy={busy}>
          <div className="artifact-heading">
            <span>分析摘要</span>
            {!busy && (
              <button onClick={() => onExport(artifact)} aria-label="导出报告">
                <ArrowDownToLine size={14} />
                导出报告
              </button>
            )}
          </div>
          <div className="artifact-summary">
            <Markdown text={summary || '查询已完成，正在整理分析结论…'} />
          </div>
          <div className="artifact-tabs" role="tablist" aria-label="结果视图">
            <button
              role="tab"
              aria-label="计算结果"
              aria-selected={tab === 'data'}
              onClick={() => onTab('data')}
            >
              <Table2 size={14} />
              数据<span>{artifact.data.length}</span>
            </button>
            <button
              role="tab"
              aria-label="查询依据"
              aria-selected={tab === 'sql'}
              onClick={() => onTab('sql')}
            >
              <FileText size={14} />
              SQL
            </button>
            <button
              role="tab"
              aria-label="可视化图表"
              aria-selected={tab === 'chart'}
              onClick={() => onTab('chart')}
            >
              <BarChart3 size={14} />
              图表
            </button>
          </div>
          <div className="artifact-content" role="tabpanel">
            {tab === 'data' ? (
              <DataTable rows={artifact.data} />
            ) : tab === 'sql' ? (
              <pre className="sql-block">
                <code>{artifact.sql || '正在准备只读查询…'}</code>
              </pre>
            ) : artifact.data.length || artifact.chart ? (
              <Suspense fallback={<div className="artifact-placeholder">正在加载图表…</div>}>
                <Chart key={artifact.id} result={artifact} />
              </Suspense>
            ) : (
              <div className="artifact-placeholder">
                <LoaderCircle size={25} className="spin" />
                正在等待查询结果
              </div>
            )}
          </div>
          {artifact.chartWarning && <p className="chart-warning">{artifact.chartWarning}</p>}
          {artifact.joinQuality && (
            <p className="table-note">
              关联键匹配：{artifact.joinQuality.matchedRows} / {artifact.joinQuality.primaryRows}{' '}
              条主表记录；主表空键 {artifact.joinQuality.primaryMissingKeys} 条，关联表空键{' '}
              {artifact.joinQuality.relatedMissingKeys} 条。
            </p>
          )}
          <div className="artifact-footnote">
            <span>
              <ShieldCheck size={13} />
              {busy ? '实时分析中，结论尚未完整' : '基于提交时的数据快照，请核对重要结论。'}
            </span>
            <button
              aria-label="导出计算结果 CSV"
              disabled={!artifact.data.length}
              onClick={() =>
                download('AVA-计算结果.csv', toCsv(artifact.data), 'text/csv;charset=utf-8')
              }
            >
              <ArrowDownToLine size={14} />
              CSV
            </button>
          </div>
        </section>
      ) : (
        <aside className="artifact-pane artifact-empty" aria-label="分析预览">
          <span className="artifact-eyebrow">从数据，到洞察</span>
          <div className="empty-chart-illustration">
            <i />
            <i />
            <i />
            <i />
            <i />
            <svg viewBox="0 0 240 100" aria-hidden="true">
              <path d="M6 80 L60 45 L114 60 L168 20 L232 8" />
            </svg>
          </div>
          <h3>{busy ? '正在分析你的数据' : '在这里查看分析结果'}</h3>
          <p>摘要、数据、SQL 与图表会随着分析逐步呈现。</p>
          {busy && <LoaderCircle size={22} className="spin" />}
        </aside>
      )}
    </section>
  );
}
