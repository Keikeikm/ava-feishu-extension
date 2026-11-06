import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { listViews, loadFeishu } from '../lib/feishu';

type Meta = { id: string; name: string };

export function RelatedSource({
  tables,
  current,
  onLoad,
}: {
  tables: Meta[];
  current: Snapshot | null;
  onLoad: (snapshot: Snapshot | null) => void;
}) {
  const [tableId, setTableId] = useState(current?.tableId ?? '');
  const [viewId, setViewId] = useState(current?.viewId ?? '');
  const [views, setViews] = useState<Meta[]>([]);
  const [listing, setListing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    setListing(true);
    setViews([]);
    setError('');
    void listViews(tableId)
      .then((items) => {
        if (cancelled) return;
        setViews(items);
        if (
          current?.tableId === tableId &&
          current.viewId &&
          !items.some((v) => v.id === current.viewId)
        ) {
          setError('上次选择的视图已不可用，请明确选择新的记录范围。');
        }
      })
      .catch(() => {
        if (!cancelled) setError('无法读取关联表的视图，请检查飞书权限。');
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableId, current]);

  async function load() {
    setLoading(true);
    try {
      const snapshot = await loadFeishu(tableId, viewId || undefined, () => {});
      if (!snapshot.rows.length) throw new Error('关联表的当前视图没有记录。');
      if (active.current) onLoad(snapshot);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '无法加载关联表。');
    } finally {
      if (active.current) setLoading(false);
    }
  }

  return (
    <div className="source-form">
      <p>从当前多维表格选择一张关联表。加载后，可选择发送给分析服务的字段和两张表的关联键。</p>
      <label>
        关联表
        <select
          value={tableId}
          disabled={loading}
          onChange={(e) => {
            setTableId(e.target.value);
            setViewId('');
            setError('');
          }}
        >
          <option value="">请选择数据表</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        关联表记录范围
        <select
          value={viewId}
          disabled={!tableId || listing || loading}
          onChange={(e) => {
            setViewId(e.target.value);
            setError('');
          }}
        >
          <option value="">全部记录</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary full-width"
        disabled={
          !tableId || listing || loading || (!!viewId && !views.some((v) => v.id === viewId))
        }
        onClick={() => void load()}
      >
        {loading ? '正在加载关联表…' : '加载并选择关联键'}
      </button>
      {current && (
        <button
          className="button secondary full-width"
          disabled={loading}
          onClick={() => onLoad(null)}
        >
          移除关联表
        </button>
      )}
    </div>
  );
}
