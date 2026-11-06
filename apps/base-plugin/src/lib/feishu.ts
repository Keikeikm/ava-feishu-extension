import type { Snapshot } from '../../shared/types';
import { MAX_FIELDS, MAX_ROWS } from '../../shared/types';
import { fieldKind, normalizeCell } from './normalize';

const sdk = () => import('@lark-opdev/block-bitable-api');

export async function connectFeishu() {
  if (window.parent === window)
    throw new Error(
      '请在飞书多维表格的“新建视图 → 更多插件”中打开已安装的数据表视图插件。独立网页无法读取飞书上下文。',
    );
  const { bitable } = await sdk();
  const [tables, selection] = await Promise.all([
    bitable.base.getTableMetaList(),
    bitable.base.getSelection(),
  ]);
  return { tables, tableId: selection.tableId ?? tables[0]?.id };
}

export async function listViews(tableId: string) {
  const { bitable } = await sdk();
  const table = await bitable.base.getTableById(tableId);
  return (await table.getViewMetaList()).filter((view) => view.type !== 100 && view.type !== 3);
}

export type ViewConfig = { tableId: string; sourceViewId?: string; fieldIds?: string[] };
export async function readViewConfig(): Promise<ViewConfig | null> {
  const { bitable } = await sdk();
  const value = await bitable.bridge.getData<unknown>('ava-analysis-config');
  if (
    !value ||
    typeof value !== 'object' ||
    !('tableId' in value) ||
    typeof value.tableId !== 'string'
  )
    return null;
  const config = value as Record<string, unknown>;
  return {
    tableId: value.tableId,
    sourceViewId: typeof config.sourceViewId === 'string' ? config.sourceViewId : undefined,
    fieldIds: Array.isArray(config.fieldIds)
      ? config.fieldIds.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
}
export async function saveViewConfig(config: ViewConfig) {
  const { bitable } = await sdk();
  const saved = await bitable.bridge.setData('ava-analysis-config', config);
  if (!saved) throw new Error('视图配置保存失败');
}

export async function loadFeishu(
  tableId: string,
  viewId: string | undefined,
  onProgress: (count: number) => void,
): Promise<Snapshot> {
  const { bitable } = await sdk();
  const table = await bitable.base.getTableById(tableId);
  const [metadata, tableName, views] = await Promise.all([
    table.getFieldMetaList(),
    table.getName(),
    table.getViewMetaList(),
  ]);
  let visible: Set<string> | undefined;
  if (viewId) {
    const view = await table.getViewById(viewId);
    // Explicit view selection respects hidden columns. No fallback to all fields on permission errors.
    visible = new Set(await view.getVisibleFieldIdList());
  }
  const fields = metadata
    .filter((f) => f.type !== 403 && f.type !== 17 && (!visible || visible.has(f.id)))
    .map((f) => ({ id: f.id, name: f.name, kind: fieldKind(f.type) }));
  if (!fields.length) throw new Error('当前范围没有可读取的字段。附件字段不参与分析。');
  if (fields.length > MAX_FIELDS)
    throw new Error(`字段超过 ${MAX_FIELDS} 个，请创建一个字段更少的源视图后再加载。`);
  if (new Set(fields.map((f) => f.name)).size !== fields.length)
    throw new Error('存在同名字段，请先在飞书中重命名。');
  const rows: Snapshot['rows'] = [];
  const seen = new Set<number>();
  let pageToken: number | undefined;
  do {
    const page = await table.getRecordsByPage({ pageSize: 200, pageToken, viewId });
    if (page.total > MAX_ROWS || rows.length + page.records.length > MAX_ROWS) {
      throw new Error(
        `数据超过 ${MAX_ROWS.toLocaleString()} 条，请在飞书源视图中筛选后再加载。不会对截断数据进行分析。`,
      );
    }
    rows.push(
      ...page.records.map((record) =>
        Object.fromEntries(
          fields.map((field) => [field.name, normalizeCell(record.fields[field.id], field.kind)]),
        ),
      ),
    );
    onProgress(rows.length);
    if (!page.hasMore) break;
    if (page.pageToken === undefined || seen.has(page.pageToken))
      throw new Error('飞书分页返回异常，请刷新重试。');
    seen.add(page.pageToken);
    pageToken = page.pageToken;
  } while (true);
  return {
    tableId,
    tableName,
    viewId,
    viewName: views.find((v) => v.id === viewId)?.name,
    fields,
    rows,
    loadedAt: new Date().toISOString(),
    source: 'feishu',
  };
}
