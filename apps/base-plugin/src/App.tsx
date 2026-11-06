import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  Hash,
  Layers3,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  TrendingUp,
  Type,
  X,
} from 'lucide-react';
import { demoSnapshot } from '../shared/demo';
import {
  DEMO_QUESTIONS,
  MAX_ROWS,
  type AnalysisResult,
  type ServerStatus,
  type Snapshot,
} from '../shared/types';
import { connectFeishu, listViews, loadFeishu, readViewConfig, saveViewConfig } from './lib/feishu';
import { download, exportReport, toCsv } from './lib/export';
import { apiOrigin, apiUrl } from './lib/api';
import { DataTable } from './components/DataTable';
import { RelatedSource } from './components/RelatedSource';
const Chart = lazy(() =>
  import('./components/Chart').then((module) => ({ default: module.Chart })),
);

type Meta = { id: string; name: string };
type Dialog = 'source' | 'settings' | 'help' | 'fields' | 'related' | null;
const timeout = <T,>(promise: Promise<T>, ms = 15_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('飞书连接超时，请确认此页面已作为多维表格插件打开后重试。')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const emptySnapshot: Snapshot = {
  tableId: '',
  tableName: '当前数据表',
  source: 'feishu',
  fields: [],
  rows: [],
  loadedAt: new Date().toISOString(),
};

export default function App({ preview = false }: { preview?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(preview ? demoSnapshot : emptySnapshot);
  const [selected, setSelected] = useState<string[]>(
    preview ? demoSnapshot.fields.map((f) => f.id) : [],
  );
  const [related, setRelated] = useState<Snapshot | null>(null);
  const [relatedSelected, setRelatedSelected] = useState<string[]>([]);
  const [primaryKey, setPrimaryKey] = useState('');
  const [relatedKey, setRelatedKey] = useState('');
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [page, setPage] = useState<'analysis' | 'data'>('analysis');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [tab, setTab] = useState<'chart' | 'data' | 'sql'>('chart');
  const [token, setToken] = useState('');
  const [tables, setTables] = useState<Meta[]>([]);
  const [views, setViews] = useState<Meta[]>([]);
  const [tableId, setTableId] = useState('');
  const [viewId, setViewId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const sourceRequest = useRef(0);
  const fields = snapshot.fields.filter((f) => selected.includes(f.id));
  const mode = snapshot.source === 'demo' && !status?.ready ? 'demo' : 'live';
  const lockedFields = mode === 'demo';
  const filteredRows = projectRows(snapshot, fields);
  const relatedFields = related?.fields.filter((f) => relatedSelected.includes(f.id)) ?? [];
  const primaryKeyField = fields.find((f) => f.id === primaryKey);
  const relatedKeyField = relatedFields.find((f) => f.id === relatedKey);

  useEffect(() => {
    fetch(apiUrl('/api/status'))
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setStatus)
      .catch(() =>
        setError(
          (previous) => previous || '分析服务未连接，请检查服务地址、域名白名单和服务器跨域配置。',
        ),
      );
    return () => {
      request.current?.abort();
      sourceRequest.current++;
    };
  }, []);
  useEffect(() => {
    if (preview) return;
    const version = ++sourceRequest.current;
    setConnecting(true);
    void (async () => {
      try {
        const connection = await timeout(connectFeishu());
        const saved = await timeout(readViewConfig()).catch(() => null);
        const id =
          saved && connection.tables.some((t) => t.id === saved.tableId)
            ? saved.tableId
            : connection.tableId;
        if (!id) throw new Error('当前飞书上下文没有可读取的数据表');
        const available = await timeout(listViews(id));
        const sourceView =
          saved?.tableId === id && available.some((v) => v.id === saved.sourceViewId)
            ? saved.sourceViewId
            : undefined;
        if (version !== sourceRequest.current) return;
        setTables(connection.tables);
        setTableId(id);
        setViews(available);
        setViewId(sourceView ?? '');
        const data = await timeout(loadFeishu(id, sourceView, setProgress), 60_000);
        if (version !== sourceRequest.current) return;
        setSnapshot(data);
        setSelected(
          saved?.tableId === id && saved.fieldIds
            ? data.fields.filter((f) => saved.fieldIds!.includes(f.id)).map((f) => f.id)
            : data.fields.map((f) => f.id),
        );
      } catch (e) {
        if (version === sourceRequest.current)
          setError(e instanceof Error ? e.message : '飞书宿主初始化失败，请检查插件权限');
      } finally {
        if (version === sourceRequest.current) setConnecting(false);
      }
    })();
    return () => {
      sourceRequest.current++;
    };
  }, [preview]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = document.querySelector<HTMLElement>('.modal button, .modal input, .modal select');
    first?.focus();
    return () => previous?.focus();
  }, [dialog]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  function resetAnalysis() {
    setHistory([]);
    setResult(null);
    setError('');
    setTab('chart');
  }
  function changeRelated(next: Snapshot | null) {
    setRelated(next);
    setRelatedSelected(next?.fields.map((field) => field.id) ?? []);
    setPrimaryKey('');
    setRelatedKey('');
    resetAnalysis();
    setDialog(next ? 'fields' : null);
  }

  function useDemo() {
    changeRelated(null);
    setSnapshot({ ...demoSnapshot, loadedAt: new Date().toISOString() });
    setSelected(demoSnapshot.fields.map((f) => f.id));
    resetAnalysis();
    setDialog(null);
    setPage('analysis');
  }
  async function connect() {
    setConnecting(true);
    setSourceError('');
    const version = ++sourceRequest.current;
    try {
      const connection = await timeout(connectFeishu());
      if (version !== sourceRequest.current) return;
      if (!connection.tableId) throw new Error('当前多维表格中没有可读取的数据表');
      setTables(connection.tables);
      setTableId(connection.tableId);
      setViewId('');
      const list = await timeout(listViews(connection.tableId));
      if (version === sourceRequest.current) setViews(list);
    } catch (e) {
      if (version === sourceRequest.current)
        setSourceError(e instanceof Error ? e.message : '无法连接飞书，请检查访问权限');
    } finally {
      if (version === sourceRequest.current) setConnecting(false);
    }
  }
  async function changeTable(id: string) {
    setTableId(id);
    setViewId('');
    setViews([]);
    setConnecting(true);
    setSourceError('');
    const version = ++sourceRequest.current;
    try {
      const list = await timeout(listViews(id));
      if (version === sourceRequest.current) setViews(list);
    } catch {
      if (version === sourceRequest.current) setSourceError('无法读取视图，请检查权限后重试。');
    } finally {
      if (version === sourceRequest.current) setConnecting(false);
    }
  }
  async function loadSource(refresh = false) {
    setConnecting(true);
    setSourceError('');
    setProgress(0);
    const version = ++sourceRequest.current;
    try {
      const [next, nextRelated] = await timeout(
        Promise.all([
          loadFeishu(
            refresh ? snapshot.tableId : tableId,
            refresh ? snapshot.viewId : viewId || undefined,
            setProgress,
          ),
          refresh && related
            ? loadFeishu(related.tableId, related.viewId, () => {})
            : Promise.resolve(null),
        ]),
        60_000,
      );
      if (version !== sourceRequest.current) return;
      setSnapshot(next);
      setSelected(next.fields.filter((f) => !refresh || selected.includes(f.id)).map((f) => f.id));
      if (refresh) {
        setRelated(nextRelated);
        setRelatedSelected(
          nextRelated?.fields.filter((f) => relatedSelected.includes(f.id)).map((f) => f.id) ?? [],
        );
      } else {
        changeRelated(null);
      }
      resetAnalysis();
      setDialog(null);
      setToast('数据已加载，分析将使用本次快照');
    } catch (e) {
      if (version === sourceRequest.current) {
        const message = e instanceof Error ? e.message : '数据加载失败，请检查飞书权限';
        if (refresh) setError(message);
        else setSourceError(message);
      }
    } finally {
      if (version === sourceRequest.current) setConnecting(false);
    }
  }
  async function analyze(query: string) {
    if (busy || connecting) return;
    if (!preview && !snapshot.tableId) return;
    if (snapshot.source === 'feishu' && !status?.ready) {
      setError('分析服务尚未就绪，请检查连接设置。');
      return;
    }
    if (!preview && status?.authRequired && !token.trim()) {
      setDialog('settings');
      return;
    }
    if (!query.trim()) {
      textarea.current?.focus();
      return;
    }
    if (!fields.length) {
      setError('请至少选择一个分析字段');
      return;
    }
    if (
      related &&
      (!primaryKeyField || !relatedKeyField || primaryKeyField.kind !== relatedKeyField.kind)
    ) {
      setError('请在「选择字段」中选定两张表的同类型关联键。');
      setDialog('fields');
      return;
    }
    if (related && snapshot.rows.length + related.rows.length > MAX_ROWS) {
      setError('两张表合计不能超过 10,000 条记录，请缩小视图范围。');
      return;
    }
    setBusy(true);
    setError('');
    setPage('analysis');
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 125_000);
    try {
      const response = await fetch(apiUrl('/api/analyze'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: query.trim(),
          mode,
          snapshot: { ...snapshot, fields, rows: filteredRows },
          ...(related && {
            related: {
              snapshot: {
                ...related,
                fields: relatedFields,
                rows: projectRows(related, relatedFields),
              },
              primaryFieldId: primaryKey,
              relatedFieldId: relatedKey,
            },
          }),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '分析请求失败');
      const next = body as AnalysisResult;
      setResult(next);
      setHistory((prev) => [next, ...prev].slice(0, 10));
      setTab(next.chart ? 'chart' : 'data');
      setQuestion('');
    } catch (e) {
      if (controller.signal.aborted) setError('分析已停止或超时，可以缩小数据范围后重试。');
      else setError(e instanceof Error ? e.message : '网络连接失败，请重试');
    } finally {
      clearTimeout(timer);
      setBusy(false);
      request.current = null;
    }
  }
  function toggleField(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
    resetAnalysis();
  }

  return (
    <div className={preview ? 'app-shell' : 'app-shell table-view'}>
      {preview && (
        <aside className="sidebar">
          <a
            href="#"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              setPage('analysis');
            }}
          >
            <span className="brand-symbol">
              A<span />
            </span>
            <span>
              AVA<span className="brand-sub">数据洞察</span>
            </span>
            <span className="beta">BETA</span>
          </a>
          <div className="workspace-label">
            {preview ? 'STANDALONE PREVIEW' : 'FEISHU TABLE VIEW'}
          </div>
          <nav className="main-nav" aria-label="主导航">
            <button
              className={page === 'analysis' ? 'active' : ''}
              onClick={() => setPage('analysis')}
            >
              <Sparkles size={17} />
              分析工作台
              <ChevronRight size={14} />
            </button>
            <button className={page === 'data' ? 'active' : ''} onClick={() => setPage('data')}>
              <Table2 size={17} />
              数据预览<span className="nav-count">{snapshot.rows.length}</span>
            </button>
          </nav>
          <div className="sidebar-section">
            <span>数据上下文</span>
            <button
              aria-label="选择数据源"
              className="icon-button"
              disabled={busy || connecting}
              onClick={() => setDialog('source')}
            >
              <Plus size={15} />
            </button>
          </div>
          <button
            className="source-card"
            disabled={busy || connecting}
            onClick={() => setDialog('source')}
          >
            <span className="source-icon">
              <Database size={18} />
            </span>
            <span>
              <strong>
                {snapshot.tableName}
                {related ? ` + ${related.tableName}` : ''}
              </strong>
              <small>
                {snapshot.source === 'demo' ? '演示数据' : '飞书多维表格'}
                <i className="status-dot" />
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
          <div className="scope-label">
            <Layers3 size={13} />
            <span>{snapshot.viewName || '全部记录'}</span>
            <span>{snapshot.rows.length} 条</span>
          </div>
          <div className="sidebar-section field-heading">
            <span>
              分析字段{' '}
              <b>
                {selected.length}/{snapshot.fields.length}
              </b>
            </span>
            <span className="tiny">{lockedFields ? '演示固定' : '按需选择'}</span>
          </div>
          <div className="fields-list">
            {snapshot.fields.map((field) => (
              <label className="field-item" key={field.id}>
                <span className={`field-type ${field.kind}`}>
                  {field.kind === 'number' ? (
                    <Hash size={14} />
                  ) : field.kind === 'date' ? (
                    <Clock3 size={14} />
                  ) : (
                    <Type size={14} />
                  )}
                </span>
                <span>{field.name}</span>
                <input
                  type="checkbox"
                  checked={selected.includes(field.id)}
                  disabled={busy || lockedFields}
                  onChange={() => toggleField(field.id)}
                />
              </label>
            ))}
          </div>
          <div className="sidebar-section history-heading">
            <span>最近分析</span>
            <span className="tiny">本次会话</span>
          </div>
          <div className="history-list">
            {history.length ? (
              history.map((item) => (
                <button
                  key={item.id}
                  className={result?.id === item.id ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => {
                    setResult(item);
                    setPage('analysis');
                    setTab(item.chart ? 'chart' : 'data');
                  }}
                >
                  <MessageSquareText size={14} />
                  <span>{item.query}</span>
                </button>
              ))
            ) : (
              <p>你的探索，从第一个问题开始</p>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <ShieldCheck size={15} />
              <span>只读分析 · 自主选择字段</span>
            </div>
            <button onClick={() => setDialog('help')}>
              <CircleHelp size={16} />
              使用指南
              <ArrowRight size={14} />
            </button>
            <div className="powered">
              POWERED BY <strong>AntV AVA</strong>
              <span>v0.1</span>
            </div>
          </div>
        </aside>
      )}

      <div className="main-shell">
        <header className="topbar">
          {preview ? (
            <div className="breadcrumb">
              <span>工作空间</span>
              <ChevronRight size={13} />
              <strong>{page === 'data' ? '数据预览' : '数据洞察'}</strong>
            </div>
          ) : (
            <h1 className="table-view-title">
              <Sparkles size={18} /> AVA 数据分析
            </h1>
          )}
          <div className="topbar-actions">
            {preview && (
              <span className="connection-pill demo">
                <i />
                独立页面预览
              </span>
            )}
            <button
              className="icon-button"
              aria-label="连接设置"
              onClick={() => setDialog('settings')}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <main>
          {preview && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span />
                  YOUR DATA, NEW PERSPECTIVES
                </div>
                <h1>{page === 'data' ? '每一份洞察，都有据可循。' : '让数据，开口说话。'}</h1>
                <p>
                  {page === 'data'
                    ? '了解当前数据快照，确认参与分析的字段与记录。'
                    : '用自然语言探索多维表格，从一个问题，发现下一个机会。'}
                </p>
              </div>
              <button
                className="button secondary source-action"
                disabled={busy || connecting}
                onClick={() => setDialog('source')}
              >
                <Link2 size={15} />
                {snapshot.source === 'demo' ? '连接飞书数据' : '切换数据源'}
              </button>
            </div>
          )}
          {!preview && !snapshot.tableId ? (
            <section className="card table-view-connection" aria-live="polite">
              {connecting ? (
                <p>
                  <LoaderCircle size={16} className="spin" /> 正在读取飞书当前数据表…
                </p>
              ) : (
                <>
                  <h2>未能读取当前数据表</h2>
                  <p role="alert">{error || '请确认已在飞书内添加 AVA 数据表视图。'}</p>
                  <button className="button secondary" onClick={() => window.location.reload()}>
                    重新连接
                  </button>
                  {tables.length > 0 && (
                    <button className="button secondary" onClick={() => setDialog('source')}>
                      选择数据范围
                    </button>
                  )}
                </>
              )}
            </section>
          ) : (
            <>
              <div className="context-bar">
                <div>
                  <span className="context-icon">
                    <Table2 size={15} />
                  </span>
                  <strong>
                    {snapshot.tableName}
                    {related ? ` + ${related.tableName}` : ''}
                  </strong>
                  {!preview && snapshot.viewName && <span>{snapshot.viewName}</span>}
                  <span className="context-divider" />
                  <span>{snapshot.rows.length.toLocaleString()} 条记录</span>
                  <span className="context-divider" />
                  <span>{fields.length} 个字段</span>
                </div>
                <button
                  disabled={busy || connecting}
                  onClick={() => (snapshot.source === 'demo' ? useDemo() : loadSource(true))}
                  title="重新加载数据，清空分析历史"
                >
                  <RefreshCw size={14} className={connecting ? 'spin' : ''} />
                  <span>{connecting ? `已读取 ${progress} 条` : '刷新数据'}</span>
                </button>
              </div>
              {!preview && snapshot.tableId && (
                <div className="view-settings-bar">
                  <div className="table-view-actions">
                    <button disabled={busy || connecting} onClick={() => setDialog('source')}>
                      数据范围
                    </button>
                    <button disabled={busy || connecting} onClick={() => setDialog('fields')}>
                      选择字段
                    </button>
                    {tables.some((table) => table.id !== snapshot.tableId) && (
                      <button disabled={busy || connecting} onClick={() => setDialog('related')}>
                        {related ? '更换关联表' : '添加关联表'}
                      </button>
                    )}
                    <button onClick={() => setPage(page === 'data' ? 'analysis' : 'data')}>
                      {page === 'data' ? '返回提问' : '数据预览'}
                    </button>
                  </div>
                  <button
                    disabled={busy || connecting}
                    onClick={() => {
                      void saveViewConfig({
                        tableId: snapshot.tableId,
                        sourceViewId: snapshot.viewId,
                        fieldIds: selected,
                      })
                        .then(() =>
                          setToast(
                            related
                              ? '主表设置已保存；关联表仅用于本次会话'
                              : '视图设置已保存，下次打开将恢复',
                          ),
                        )
                        .catch(() => setError('视图配置保存失败，请检查当前视图的编辑权限'));
                    }}
                  >
                    {related ? '保存主表设置' : '保存视图设置'}
                  </button>
                </div>
              )}
              {snapshot.source === 'demo' && (
                <div className="demo-banner">
                  <Sparkles size={15} />
                  <span>
                    正在使用虚构的销售数据。
                    {status?.ready
                      ? '模型已连接，可以自由提问。'
                      : '点击示例问题，即可体验 AVA 的分析流程。'}
                  </span>
                  <button disabled={busy || connecting} onClick={() => setDialog('source')}>
                    使用我的数据 <ArrowRight size={13} />
                  </button>
                </div>
              )}
              {snapshot.source === 'feishu' && snapshot.tableId && status && !status.ready && (
                <div className="notice">
                  <Settings2 size={16} />
                  数据已连接，配置服务端模型后即可自由提问。
                  <button onClick={() => setDialog('settings')}>查看设置</button>
                </div>
              )}

              {!preview && status?.ready && status.authRequired && !token.trim() && (
                <div className="notice">
                  <Settings2 size={16} />
                  填写服务访问令牌后即可提问。
                  <button onClick={() => setDialog('settings')}>连接设置</button>
                </div>
              )}
              {error && (
                <div className="error-box" role="alert">
                  <span>{error}</span>
                  <button
                    className="icon-button"
                    aria-label="关闭错误"
                    onClick={() => setError('')}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {preview && (
                <div className="mobile-nav">
                  <button
                    className={page === 'analysis' ? 'active' : ''}
                    onClick={() => setPage('analysis')}
                  >
                    <Sparkles size={14} />
                    分析工作台
                  </button>
                  <button
                    className={page === 'data' ? 'active' : ''}
                    onClick={() => setPage('data')}
                  >
                    <Table2 size={14} />
                    数据预览
                  </button>
                  <button disabled={busy} onClick={() => setDialog('fields')}>
                    <Layers3 size={14} />
                    字段 {fields.length}
                  </button>
                </div>
              )}
              {page === 'data' ? (
                <section className="card preview-card">
                  <div className="section-title">
                    <div>
                      <Table2 size={17} />
                      <h2>源数据预览</h2>
                    </div>
                    <span className="muted">
                      {new Date(snapshot.loadedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      加载 · 快照
                    </span>
                  </div>
                  {related && <h3>{snapshot.tableName}</h3>}
                  <DataTable rows={filteredRows} />
                  {related && (
                    <>
                      <h3>
                        {related.tableName} · {related.viewName || '全部记录'}
                      </h3>
                      <DataTable rows={projectRows(related, relatedFields)} />
                    </>
                  )}
                  <p className="table-note">
                    数据变更后点击「刷新数据」重新加载。附件不参与分析，未勾选的字段不会发送给分析服务。
                  </p>
                </section>
              ) : (
                <>
                  <section className="composer-section">
                    <div className="composer-label">
                      <span className="spark-icon">
                        <Sparkles size={17} />
                      </span>
                      <span>{preview ? '今天，想从数据中了解什么？' : '向数据表提问'}</span>
                      {preview && (
                        <span className="mode-label">
                          {mode === 'demo' ? '预设分析' : 'AVA 智能分析'}
                        </span>
                      )}
                    </div>
                    <form
                      className={`composer ${busy ? 'processing' : ''}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void analyze(question);
                      }}
                    >
                      <textarea
                        ref={textarea}
                        aria-label="分析问题"
                        placeholder={
                          mode === 'demo'
                            ? '试试：每个月的销售额趋势如何？'
                            : '例如：找出销售额最高的地区，并比较各月份的变化…'
                        }
                        value={question}
                        maxLength={2000}
                        disabled={busy}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void analyze(question);
                          }
                        }}
                      />
                      <div className="composer-footer">
                        <span>
                          <Database size={13} />
                          基于 {snapshot.tableName}
                          {related ? ` + ${related.tableName}` : ''}
                          <span className="composer-hint">· Enter 发送，Shift + Enter 换行</span>
                        </span>
                        <button
                          className="send-button"
                          type="submit"
                          aria-label="开始分析"
                          disabled={
                            busy ||
                            connecting ||
                            !question.trim() ||
                            !fields.length ||
                            (snapshot.source === 'feishu' && !status?.ready)
                          }
                        >
                          {busy ? (
                            <LoaderCircle size={18} className="spin" />
                          ) : (
                            <ArrowUp size={19} />
                          )}
                        </button>
                      </div>
                    </form>
                    <p className="data-disclosure">
                      <ShieldCheck size={12} />
                      {mode === 'demo'
                        ? '演示查询在服务端使用 AVA 计算，不调用模型。'
                        : '仅在提交问题时发送所选字段数据。模型可能接收字段、统计信息及查询结果。'}
                    </p>
                  </section>

                  {busy && (
                    <section className="card loading-card" role="status">
                      <span className="loading-orbit">
                        <Sparkles size={24} />
                      </span>
                      <div>
                        <h3>正在寻找数据中的答案</h3>
                        <p>AVA 正在计算结果、整理结论并准备图表…</p>
                      </div>
                    </section>
                  )}
                  {result && !busy ? (
                    <section className="card result-card" aria-label="分析结果">
                      <div className="result-heading">
                        <div className="result-brand">
                          <span className="spark-icon">
                            <Sparkles size={19} />
                          </span>
                          <div>
                            <h2>{result.query}</h2>
                            <span>
                              AVA · {result.mode === 'demo' ? '演示分析' : '智能分析'}
                              <i />
                              {(result.elapsedMs / 1000).toFixed(1)} 秒 · {result.rowCount} 条源记录
                            </span>
                          </div>
                        </div>
                        <button
                          className="button text-button"
                          onClick={() => {
                            exportReport(
                              result,
                              related
                                ? `${snapshot.tableName} + ${related.tableName}`
                                : snapshot.tableName,
                            );
                            setToast('分析报告已导出');
                          }}
                        >
                          <ArrowDownToLine size={15} />
                          导出报告
                        </button>
                      </div>
                      <div className="insight-copy">
                        <span className="insight-label">
                          <span />
                          分析发现
                        </span>
                        <ReactMarkdown
                          components={{
                            a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                          }}
                        >
                          {result.text}
                        </ReactMarkdown>
                        {result.joinQuality && (
                          <p className="table-note">
                            关联键匹配：{result.joinQuality.matchedRows.toLocaleString()} /{' '}
                            {result.joinQuality.primaryRows.toLocaleString()} 条主表记录 （
                            {(
                              (100 * result.joinQuality.matchedRows) /
                              result.joinQuality.primaryRows
                            ).toFixed(1)}
                            %）。 主表空键 {result.joinQuality.primaryMissingKeys.toLocaleString()}{' '}
                            条，关联表空键 {result.joinQuality.relatedMissingKeys.toLocaleString()}{' '}
                            条。
                          </p>
                        )}
                      </div>
                      {result.chartWarning && (
                        <p className="chart-warning">{result.chartWarning}</p>
                      )}
                      <div className="result-tabs">
                        <div role="tablist" aria-label="结果视图">
                          <button
                            role="tab"
                            aria-selected={tab === 'chart'}
                            className={tab === 'chart' ? 'active' : ''}
                            onClick={() => setTab('chart')}
                          >
                            <BarChart3 size={15} />
                            可视化图表
                          </button>
                          <button
                            role="tab"
                            aria-selected={tab === 'data'}
                            className={tab === 'data' ? 'active' : ''}
                            onClick={() => setTab('data')}
                          >
                            <Table2 size={15} />
                            计算结果<span>{result.data.length}</span>
                          </button>
                          <button
                            role="tab"
                            aria-selected={tab === 'sql'}
                            className={tab === 'sql' ? 'active' : ''}
                            onClick={() => setTab('sql')}
                          >
                            <FileText size={15} />
                            查询依据
                          </button>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="导出计算结果 CSV"
                          onClick={() =>
                            download(
                              'AVA-计算结果.csv',
                              toCsv(result.data),
                              'text/csv;charset=utf-8',
                            )
                          }
                        >
                          <ArrowDownToLine size={16} />
                        </button>
                      </div>
                      <div className="result-content" role="tabpanel">
                        {tab === 'chart' ? (
                          <>
                            <div className="chart-title">
                              {typeof result.chart?.config.title === 'string'
                                ? result.chart.config.title
                                : '数据可视化'}
                              <span>
                                {result.chart?.config.axisYTitle
                                  ? String(result.chart.config.axisYTitle)
                                  : ''}
                              </span>
                            </div>
                            <Suspense fallback={<div className="empty-table">正在加载图表…</div>}>
                              <Chart result={result} />
                            </Suspense>
                          </>
                        ) : tab === 'data' ? (
                          <DataTable rows={result.data} />
                        ) : (
                          <>
                            <p className="table-note">
                              以下查询由 AVA 执行，结论基于返回结果。可在「计算结果」中交叉核对。
                            </p>
                            <pre className="sql-block">
                              <code>{result.sql || '本次分析未返回 SQL。'}</code>
                            </pre>
                          </>
                        )}
                      </div>
                      <div className="result-footnote">
                        <ShieldCheck size={13} />
                        <span>
                          分析基于当前快照
                          {result.mode === 'live' ? '，请核对重要结论' : ' · 演示数据与预设查询'}。
                        </span>
                        <Check size={13} />
                        已完成
                      </div>
                    </section>
                  ) : (
                    preview &&
                    !busy && (
                      <section className="explore-section">
                        <div className="section-title">
                          <div>
                            <TrendingUp size={17} />
                            <h2>从一个好问题开始</h2>
                          </div>
                          <span>探索数据的不同角度</span>
                        </div>
                        <div className="question-grid">
                          {(snapshot.source === 'demo'
                            ? DEMO_QUESTIONS
                            : makeQuestions({ ...snapshot, fields })
                          ).map((q, i) => (
                            <button
                              className="question-card"
                              key={q}
                              disabled={
                                connecting || (snapshot.source === 'feishu' && !status?.ready)
                              }
                              onClick={() => {
                                setQuestion(q);
                                void analyze(q);
                              }}
                            >
                              <span className={`question-icon tone-${i}`}>
                                {i === 0 ? (
                                  <TrendingUp size={19} />
                                ) : i === 1 ? (
                                  <BarChart3 size={19} />
                                ) : i === 2 ? (
                                  <Layers3 size={19} />
                                ) : (
                                  <Table2 size={19} />
                                )}
                              </span>
                              <strong>{['发现趋势', '比较表现', '探索构成', '深入数据'][i]}</strong>
                              <span>{q}</span>
                              <ArrowRight className="question-arrow" size={16} />
                            </button>
                          ))}
                        </div>
                      </section>
                    )
                  )}
                  {history.length > 0 && !busy && (
                    <div className="followup-row">
                      <span>继续探索</span>
                      {(snapshot.source === 'demo'
                        ? DEMO_QUESTIONS
                        : makeQuestions({ ...snapshot, fields })
                      )
                        .filter((q) => q !== result?.query)
                        .slice(0, 2)
                        .map((q) => (
                          <button
                            key={q}
                            onClick={() => {
                              setQuestion(q);
                              void analyze(q);
                            }}
                          >
                            {q}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                    </div>
                  )}
                  {preview && !result && !busy && (
                    <div className="workflow-note">
                      <span>
                        <b>01</b>连接多维表格
                      </span>
                      <i />
                      <span>
                        <b>02</b>用自然语言提问
                      </span>
                      <i />
                      <span>
                        <b>03</b>发现洞察与图表
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {preview && (
            <footer className="page-footer">
              <span>让每个人，都能看懂数据。</span>
              <span>
                Built with <span className="footer-logo">AntV</span> AVA
              </span>
            </footer>
          )}
        </main>
      </div>

      {dialog && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !connecting) setDialog(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !connecting) setDialog(null);
              if (e.key === 'Tab') {
                const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)',
                );
                const first = focusable[0],
                  last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="modal-header">
              <h2 id="dialog-title">
                {dialog === 'source'
                  ? '连接你的数据'
                  : dialog === 'settings'
                    ? '连接设置'
                    : dialog === 'fields'
                      ? '选择分析字段'
                      : dialog === 'related'
                        ? '关联另一张表'
                        : '开始使用 AVA'}
              </h2>
              <button
                className="icon-button"
                aria-label="关闭对话框"
                disabled={connecting}
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            {dialog === 'source' ? (
              <>
                <p className="modal-intro">读取飞书数据快照，选择分析范围，开始探索。</p>
                {preview && (
                  <>
                    <button
                      className="source-option"
                      disabled={busy || connecting}
                      onClick={useDemo}
                    >
                      <span className="source-icon purple">
                        <Sparkles size={20} />
                      </span>
                      <span>
                        <strong>先试试演示数据</strong>
                        <small>72 条虚构销售记录 · 无需密钥</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  </>
                )}
                <div className="modal-divider">或连接飞书多维表格</div>
                {!tables.length ? (
                  <button
                    className="button primary full-width"
                    disabled={connecting}
                    onClick={connect}
                  >
                    {connecting ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
                    连接当前多维表格
                  </button>
                ) : (
                  <div className="source-form">
                    <label>
                      数据表
                      <select
                        value={tableId}
                        disabled={connecting}
                        onChange={(e) => void changeTable(e.target.value)}
                      >
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      记录范围
                      <select
                        value={viewId}
                        disabled={connecting}
                        onChange={(e) => setViewId(e.target.value)}
                      >
                        <option value="">全部记录</option>
                        {views.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      选择源视图时尊重其记录筛选和隐藏字段；全部记录包含表内所有可读字段，附件除外。
                    </p>
                    <button
                      className="button primary full-width"
                      disabled={connecting || !!sourceError}
                      onClick={() => void loadSource()}
                    >
                      {connecting ? (
                        <>
                          <LoaderCircle className="spin" size={16} />
                          正在读取 {progress} 条记录
                        </>
                      ) : (
                        '加载数据快照'
                      )}
                    </button>
                    {sourceError && (
                      <button className="button secondary full-width" onClick={connect}>
                        重新连接
                      </button>
                    )}
                  </div>
                )}
                {sourceError && (
                  <div className="error-box" role="alert">
                    {sourceError}
                  </div>
                )}
                <p className="modal-note">
                  <ShieldCheck size={14} />
                  插件只读数据，不修改原表。最多 10,000 条记录、80 个字段。
                </p>
              </>
            ) : dialog === 'related' ? (
              <RelatedSource
                tables={tables.filter((table) => table.id !== snapshot.tableId)}
                current={related}
                onLoad={changeRelated}
              />
            ) : dialog === 'fields' ? (
              <>
                <p className="modal-intro">
                  {lockedFields
                    ? '演示模式使用固定字段。连接模型后可按需选择。'
                    : '只发送勾选的字段。修改字段会清空分析历史；点击「保存视图设置」可供下次打开时恢复。'}
                </p>
                {related && <h3>{snapshot.tableName}</h3>}
                <div className="fields-list">
                  {snapshot.fields.map((field) => (
                    <label className="field-item" key={field.id}>
                      <span>{field.name}</span>
                      <input
                        type="checkbox"
                        checked={selected.includes(field.id)}
                        disabled={busy || lockedFields}
                        onChange={() => toggleField(field.id)}
                      />
                    </label>
                  ))}
                </div>
                {related && (
                  <>
                    <h3>{related.tableName}</h3>
                    <div className="fields-list">
                      {related.fields.map((field) => (
                        <label className="field-item" key={field.id}>
                          <span>{field.name}</span>
                          <input
                            type="checkbox"
                            checked={relatedSelected.includes(field.id)}
                            onChange={() => {
                              setRelatedSelected((prev) =>
                                prev.includes(field.id)
                                  ? prev.filter((id) => id !== field.id)
                                  : [...prev, field.id],
                              );
                              resetAnalysis();
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="source-form">
                      <label>
                        主表关联键
                        <select
                          value={primaryKeyField?.id ?? ''}
                          onChange={(e) => {
                            setPrimaryKey(e.target.value);
                            setRelatedKey('');
                            resetAnalysis();
                          }}
                        >
                          <option value="">请选择字段</option>
                          {fields.map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        关联表唯一键
                        <select
                          value={
                            relatedKeyField?.kind === primaryKeyField?.kind
                              ? (relatedKeyField?.id ?? '')
                              : ''
                          }
                          disabled={!primaryKeyField}
                          onChange={(e) => {
                            setRelatedKey(e.target.value);
                            resetAnalysis();
                          }}
                        >
                          <option value="">请选择同类型字段</option>
                          {relatedFields
                            .filter((field) => field.kind === primaryKeyField?.kind)
                            .map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p>关联表键值需唯一。分析前会检查匹配率；关联表与关联键只在本次会话生效。</p>
                    </div>
                  </>
                )}
                <button className="button primary full-width" onClick={() => setDialog(null)}>
                  完成选择
                </button>
              </>
            ) : dialog === 'settings' ? (
              <>
                <p className="modal-intro">
                  分析服务：{apiOrigin || '当前预览页面的同源服务'}
                  。飞书插件由平台托管，须在开放平台配置此服务的域名白名单，并在服务端允许插件的实际
                  origin。
                </p>
                <div className="model-status">
                  <span className={`status-light ${status?.ready ? 'ready' : ''}`} />
                  <div>
                    <strong>
                      {status?.ready ? '模型已配置' : preview ? '预览演示模式' : '尚未配置模型'}
                    </strong>
                    <p>{status?.model || '自由提问需要由维护者配置分析服务'}</p>
                  </div>
                </div>
                <p className="modal-intro">
                  模型密钥由服务端管理。维护者在服务器的 .env 中配置以下变量，并重启服务：
                </p>
                <pre className="sql-block">
                  AVA_API_KEY=你的模型密钥{'\n'}AVA_MODEL=模型名称{'\n'}
                  AVA_BASE_URL=兼容接口地址（可选）
                </pre>
                <label className="token-label">
                  服务访问令牌 {status?.authRequired && <span>此服务需要令牌</span>}
                  <input
                    type="password"
                    value={token}
                    placeholder="由服务维护者提供；仅保存在本次会话"
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <p className="modal-note">
                  所选数据发送至当前分析服务；模型端点可能接收统计信息与查询结果。请按组织的数据管理要求选择字段。
                </p>
                <button
                  className="button primary full-width"
                  onClick={() => {
                    setDialog(null);
                    setToast('连接设置已应用');
                  }}
                >
                  应用设置
                </button>
              </>
            ) : (
              <>
                <p className="modal-intro">把问题交给 AVA，把判断留给你。</p>
                <ol className="help-steps">
                  <li>
                    <strong>连接数据</strong>
                    <p>
                      通过 opdev 上传并发布插件，在飞书数据表的「新建视图 → 更多插件」中添加 AVA
                      数据洞察。
                    </p>
                  </li>
                  <li>
                    <strong>描述你想知道的事</strong>
                    <p>
                      明确指标、维度和时间范围，例如「按月份比较各地区的销售额」。每次提问独立分析，请写完整问题。
                    </p>
                  </li>
                  <li>
                    <strong>查看并核对结果</strong>
                    <p>切换图表、计算结果与查询依据，也可以下载 CSV 或导出分析报告。</p>
                  </li>
                </ol>
                <p className="modal-note">
                  修改源数据后需刷新快照。切换数据源或分析字段会清空本次会话的分析历史。
                </p>
                <div className="help-links">
                  <a
                    href="https://open.feishu.cn/document/base-extensions/base-table-view-extension-development-guide"
                    target="_blank"
                    rel="noreferrer"
                  >
                    飞书扩展开发指南 ↗
                  </a>
                  <a href="https://github.com/antvis/AVA" target="_blank" rel="noreferrer">
                    了解 AntV AVA ↗
                  </a>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}

function projectRows(snapshot: Snapshot, fields: Snapshot['fields']) {
  return snapshot.rows.map((row) =>
    Object.fromEntries(fields.map((field) => [field.name, row[field.name] ?? null])),
  );
}

function makeQuestions(snapshot: Snapshot) {
  const numeric = snapshot.fields.find((f) => f.kind === 'number')?.name;
  const dimension = snapshot.fields.find((f) => f.kind === 'text')?.name;
  return [
    numeric ? `汇总${numeric}，并给出最大值、最小值和平均值` : '当前数据有多少条记录？',
    numeric && dimension ? `按${dimension}比较${numeric}，哪一组最高？` : '哪些字段存在缺失值？',
    dimension ? `统计不同${dimension}的记录数及占比` : '请检查当前数据的完整性',
    numeric ? `列出${numeric}最高的前 10 条记录` : '请概括当前数据的结构',
  ];
}
