import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AVA } from '@antv/ava';

export const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

export class TableRowTooLargeError extends Error {
  constructor() {
    super('A source row is too large to import');
  }
}

function sqliteType(type: string): 'INTEGER' | 'REAL' | 'TEXT' {
  if (/^(?:U?(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|BOOLEAN)$/i.test(type)) return 'INTEGER';
  if (/^(?:FLOAT|DOUBLE|DECIMAL)/i.test(type)) return 'REAL';
  return 'TEXT';
}

function sqliteValue(value: unknown, type: ReturnType<typeof sqliteType>): SQLInputValue {
  if (value == null) return null;
  if (type === 'INTEGER') {
    if (typeof value === 'boolean') return Number(value);
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  }
  if (type !== 'TEXT' && typeof value === 'number') return value;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

async function copyTable(ava: AVA, db: DatabaseSync, name: string) {
  const model = (await ava.schema()).models[0];
  if (!model?.columns.length) throw new Error('The source table has no supported fields');
  const columns = model.columns.map(column => ({ name: column.name, type: sqliteType(column.type) }));
  db.exec(`CREATE TABLE ${quoteIdentifier(name)} (${columns.map(c => `${quoteIdentifier(c.name)} ${c.type}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO ${quoteIdentifier(name)} VALUES (${columns.map(() => '?').join(', ')})`);
  const pageSize = 1000;
  for (let offset = 0; ; ) {
    // The upstream loader holds an immutable snapshot. Read it in bounded pages.
    const page = await ava.query(`SELECT * FROM data LIMIT ${pageSize} OFFSET ${offset}`, { maxRows: pageSize, maxResultBytes: 4 * 1024 * 1024 });
    for (const row of page.data) insert.run(...columns.map(c => sqliteValue(row[c.name], c.type)));
    if (!page.truncated && page.data.length < pageSize) break;
    if (!page.data.length) throw new TableRowTooLargeError();
    offset += page.data.length;
  }
}

/**
 * Copy named single-table snapshots into one SQLite database, then load them into AVA.
 * The caller owns the private path and its lifetime. Each loader must expose a table called data.
 * Returns the actual SQL table names in source order.
 */
export async function loadSqliteTables(
  ava: AVA,
  path: string,
  sources: readonly { name: string; load: () => Promise<unknown> }[],
): Promise<string[]> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  const names = new Set<string>();
  const tableNames: string[] = [];
  try {
    db.exec('BEGIN');
    for (const [index, source] of sources.entries()) {
      const candidate = source.name.replaceAll('\0', '').trim() || `表 ${index + 1}`;
      const base = /^sqlite_/i.test(candidate) ? `表_${candidate}` : candidate;
      let name = base;
      for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base} (${suffix})`;
      names.add(name.toLowerCase());
      tableNames.push(name);
      await source.load();
      await copyTable(ava, db, name);
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  await ava.source({ type: 'sqlite', options: { path } });
  return tableNames;
}

/** Load rows from a client that already applied its own view and field permissions. */
export async function loadJsonSnapshots(
  ava: AVA,
  directory: string,
  snapshots: readonly { name: string; rows: readonly Record<string, unknown>[] }[],
): Promise<string[]> {
  const sources = snapshots.map(({ name, rows }, i) => ({
    name,
    load: async () => {
      const path = join(directory, `snapshot-${i}.json`);
      await writeFile(path, JSON.stringify(rows), { mode: 0o600 });
      await ava.source({ type: 'json-file', options: { path } });
    },
  }));
  if (sources.length === 1) {
    await sources[0]!.load();
    return ['data'];
  }
  return loadSqliteTables(ava, join(directory, 'snapshots.sqlite'), sources);
}
