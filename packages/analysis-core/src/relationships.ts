import type { AVA } from '@antv/ava';
import { quoteIdentifier as quote } from './tables.js';

export interface JoinQuality {
  primaryRows: number;
  primaryMissingKeys: number;
  matchedRows: number;
  relatedMissingKeys: number;
  relatedDuplicateKeys: number;
}

type JoinKey = { table: string; field: string };

/** Measure a lookup relationship before using it. NULL and blank keys never match. */
export async function inspectJoin(ava: AVA, primary: JoinKey, related: JoinKey) {
  const key = (field: string) =>
    `CASE WHEN trim(CAST(${quote(field)} AS VARCHAR)) <> '' THEN CAST(${quote(field)} AS VARCHAR) END`;
  const { data } = await ava.query(`
    WITH primary_keys AS (SELECT ${key(primary.field)} AS key FROM ${quote(primary.table)}),
         related_keys AS (SELECT ${key(related.field)} AS key FROM ${quote(related.table)}),
         lookup AS (SELECT key, count(*) AS copies FROM related_keys WHERE key IS NOT NULL GROUP BY key)
    SELECT count(*) AS primary_rows,
           count(*) FILTER (WHERE p.key IS NULL) AS primary_missing_keys,
           count(*) FILTER (WHERE l.key IS NOT NULL) AS matched_rows,
           (SELECT count(*) FROM related_keys WHERE key IS NULL) AS related_missing_keys,
           (SELECT count(*) FROM lookup WHERE copies > 1) AS related_duplicate_keys
    FROM primary_keys p LEFT JOIN lookup l ON p.key = l.key`, { maxRows: 1 });
  const row = data[0]!;
  const quality: JoinQuality = {
    primaryRows: Number(row.primary_rows),
    primaryMissingKeys: Number(row.primary_missing_keys),
    matchedRows: Number(row.matched_rows),
    relatedMissingKeys: Number(row.related_missing_keys),
    relatedDuplicateKeys: Number(row.related_duplicate_keys),
  };
  const primaryField = `${quote(primary.table)}.${quote(primary.field)}`;
  const relatedField = `${quote(related.table)}.${quote(related.field)}`;
  const condition = `trim(CAST(${primaryField} AS VARCHAR)) <> '' AND CAST(${primaryField} AS VARCHAR) = CAST(${relatedField} AS VARCHAR)`;
  return { quality, condition };
}
