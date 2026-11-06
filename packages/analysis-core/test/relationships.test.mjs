import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAnalysisEngine, inspectJoin, loadJsonSnapshots, quoteIdentifier } from '../dist/index.js';

test('combines snapshots without losing exact text keys or inflating the coverage count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-core-test-'));
  const ava = createAnalysisEngine(
    { model: 'unused', apiKey: 'unused' },
    { maxTempDirectorySize: '0B', queryTimeoutMs: 15_000 },
  );
  try {
    const field = '客户"ID';
    const [primary, related] = await loadJsonSnapshots(ava, directory, [
      {
        name: '订单',
        rows: ['001', '001', '1', '不存在', '', null].map((id) => ({ [field]: id, 金额: 1 })),
      },
      {
        name: '订单',
        rows: ['001', '1', '1', ' ', null].map((id) => ({ [field]: id })),
      },
    ]);
    assert.deepEqual([primary, related], ['订单', '订单 (2)']);
    const { quality, condition } = await inspectJoin(
      ava, { table: primary, field }, { table: related, field },
    );
    assert.deepEqual(quality, {
      primaryRows: 6, primaryMissingKeys: 2, matchedRows: 3,
      relatedMissingKeys: 2, relatedDuplicateKeys: 1,
    });
    const result = await ava.query(`
      SELECT count(*) AS matches FROM ${quoteIdentifier(primary)}
      JOIN ${quoteIdentifier(related)} ON ${condition}
      WHERE ${quoteIdentifier(primary)}.${quoteIdentifier(field)} = '001'
    `);
    assert.equal(Number(result.data[0].matches), 2);
  } finally {
    try { await ava.dispose(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});
