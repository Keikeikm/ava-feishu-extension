import { loadSqliteTables, TableRowTooLargeError } from '@ava/analysis-core';
import { join } from 'node:path';
import type { AVA, DataSourceConfig } from '@antv/ava';
import { UserError } from './errors.js';
import { bitableUrl } from './sources.js';
import type { DatasetSource } from './types.js';

type BitableSource = Extract<DatasetSource, { kind: 'bitable' }>;
const origin = 'https://open.feishu.cn/open-apis';

async function feishu<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { code: number; msg?: string; data?: T };
  if (body.code !== 0) throw new Error(`Feishu Error ${body.code}: ${body.msg}`);
  return (body.data ?? body) as T;
}

async function listTables(source: BitableSource, url: URL) {
  const token = await feishu<{ tenant_access_token: string }>('/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: source.appId, app_secret: source.appSecret }),
  });
  const headers = { Authorization: `Bearer ${token.tenant_access_token}` };
  const [, kind, linkToken] = url.pathname.split('/');
  let appToken = linkToken!;
  if (kind === 'wiki') {
    const { node } = await feishu<{ node: { obj_type: string; obj_token: string } }>(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(appToken)}&obj_type=wiki`, { headers });
    if (node?.obj_type !== 'bitable' || !node.obj_token) {
      throw new UserError('这个知识库链接没有指向多维表格。', 'BITABLE_WIKI_TYPE', 'source');
    }
    appToken = node.obj_token;
  }

  const tables = new Map<string, string>();
  const seenPages = new Set<string>();
  let cursor = '';
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('page_token', cursor);
    const page = await feishu<{ items?: { table_id: string; name: string }[]; has_more?: boolean; page_token?: string }>(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?${params}`, { headers },
    );
    for (const table of page.items ?? []) tables.set(table.table_id, table.name);
    if (!page.has_more) break;
    if (!page.page_token || seenPages.has(page.page_token)) throw new Error('Feishu tables pagination returned an invalid page token');
    cursor = page.page_token;
    seenPages.add(cursor);
  } while (cursor);
  if (!tables.size) throw new UserError('飞书没有返回机器人可读取的数据表。请核对应用对该多维表格的读取权限。', 'BITABLE_NO_TABLES', 'source');
  return { appToken, tables };
}

/** Compose the Base from AVA's native single-table loader and its existing SQLite source. */
export async function loadBitable(ava: AVA, source: BitableSource, directory?: string): Promise<number> {
  const url = new URL(bitableUrl(source.url));
  const credentials = { appId: source.appId, appSecret: source.appSecret };
  if (url.searchParams.has('table')) {
    await ava.source({ type: 'feishu-bitable', options: { ...credentials, url: url.toString() } });
    return 1;
  }

  const { appToken, tables } = await listTables(source, url);
  const tableSource = (tableId: string): DataSourceConfig => ({ type: 'feishu-bitable', options: { ...credentials, appToken, tableId } });
  if (tables.size === 1) {
    await ava.source(tableSource(tables.keys().next().value!));
    return 1;
  }

  if (!directory) throw new Error('A session directory is required to load multiple Bitable tables');
  try {
    await loadSqliteTables(ava, join(directory, 'bitable.sqlite'), [...tables].map(([id, title]) => ({
      name: title.trim().replaceAll('\0', '') || id,
      load: () => ava.source(tableSource(id)),
    })));
  } catch (error) {
    if (error instanceof TableRowTooLargeError) {
      throw new UserError('多维表格中有单行数据过大，无法完整导入。', 'BITABLE_ROW_TOO_LARGE', 'source');
    }
    throw error;
  }
  return tables.size;
}
