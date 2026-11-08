import { z } from 'zod';
import { MAX_FIELDS, MAX_ROWS } from '../shared/types';

const cell = z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null()]);
const snapshot = z
  .object({
    tableId: z.string().max(200),
    tableName: z.string().max(200),
    viewId: z.string().max(200).optional(),
    viewName: z.string().max(200).optional(),
    source: z.enum(['demo', 'feishu']),
    loadedAt: z.string().datetime(),
    fields: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().min(1).max(200),
          kind: z.enum(['number', 'text', 'date', 'boolean']),
        }),
      )
      .min(1)
      .max(MAX_FIELDS),
    rows: z.array(z.record(z.string(), cell)).min(1, '当前数据范围没有记录').max(MAX_ROWS),
  })
  .superRefine((snapshot, ctx) => {
    const names = snapshot.fields.map((f) => f.name);
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length)
      ctx.addIssue({ code: 'custom', message: '字段名称不能重复' });
    if (
      names.some((n) => n.includes('\0') || ['__proto__', 'constructor', 'prototype'].includes(n))
    ) {
      ctx.addIssue({ code: 'custom', message: '字段名称包含保留名称，请先重命名' });
    }
    if (new Set(snapshot.fields.map((field) => field.id)).size !== snapshot.fields.length) {
      ctx.addIssue({ code: 'custom', message: '字段 ID 不能重复' });
    }
    const allowed = new Set(names);
    if (snapshot.rows.some((row) => Object.keys(row).some((key) => !allowed.has(key)))) {
      ctx.addIssue({ code: 'custom', message: '记录包含未选择的字段' });
    }
  });

export const analysisRequest = z
  .object({
    question: z.string().trim().min(1, '请输入问题').max(2000, '问题不能超过 2000 字'),
    mode: z.enum(['demo', 'live']),
    snapshot,
    related: z
      .object({
        snapshot,
        primaryFieldId: z.string().min(1).max(200),
        relatedFieldId: z.string().min(1).max(200),
      })
      .optional(),
  })
  .superRefine(({ mode, snapshot, related }, ctx) => {
    if (!related) return;
    const other = related.snapshot;
    const add = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      mode !== 'live' ||
      snapshot.source !== 'feishu' ||
      other.source !== 'feishu' ||
      !snapshot.tableId ||
      !other.tableId ||
      snapshot.tableId === other.tableId
    ) {
      add('跨表分析需要两张不同的飞书数据表');
    }
    if (snapshot.rows.length + other.rows.length > MAX_ROWS) {
      add('两张表合计不能超过 10,000 条记录，请缩小视图范围');
    }
    const primary = snapshot.fields.find((f) => f.id === related.primaryFieldId);
    const lookup = other.fields.find((f) => f.id === related.relatedFieldId);
    if (!primary || !lookup || primary.kind !== lookup.kind) {
      add('请选择两张表中类型相同、且已勾选的关联字段');
    }
  });

export const analysisJobRequest = z.object({
  id: z.uuid(),
  key: z.uuid(),
  payload: analysisRequest,
});
