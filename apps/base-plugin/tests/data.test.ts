import { describe, it, expect } from 'vitest';
import { normalizeCell, fieldKind } from '../src/lib/normalize';
import { csvValue, toCsv } from '../src/lib/export';
import { analysisRequest } from '../server/validation';
import { demoSnapshot } from '../shared/demo';

describe('飞书数据规范化', () => {
  it('保留数值、零、布尔和空值的语义', () => {
    expect(normalizeCell(0, 'number')).toBe(0);
    expect(normalizeCell(false, 'boolean')).toBe(false);
    expect(normalizeCell('', 'number')).toBeNull();
    expect(normalizeCell('12.5', 'number')).toBe(12.5);
    expect(normalizeCell('12%', 'number')).toBe('12%');
    expect(normalizeCell(Infinity, 'number')).toBeNull();
  });
  it('拼接富文本，提取选项名称，不发送标识符或附件 token', () => {
    expect(normalizeCell([{ text: 'hello ' }, { text: 'AVA' }], 'text')).toBe('hello AVA');
    expect(normalizeCell([{ id: 'private', name: '甲' }, { name: '乙' }], 'text')).toBe('甲、乙');
    expect(normalizeCell({ recordIds: ['recSecret'], token: 'secret' }, 'text')).toBeNull();
    expect(normalizeCell({ value: 0 }, 'number')).toBe(0);
  });
  it('将日期毫秒转为 ISO，不把货币当文本', () => {
    expect(fieldKind(99003)).toBe('number');
    expect(normalizeCell(Date.UTC(2026, 0, 1), 'date')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('请求数据边界', () => {
  const valid = { question: '趋势', mode: 'demo', snapshot: demoSnapshot };
  it('接受有效快照，拒绝空问题、超量记录和未知字段', () => {
    expect(analysisRequest.safeParse(valid).success).toBe(true);
    expect(analysisRequest.safeParse({ ...valid, question: ' ' }).success).toBe(false);
    expect(
      analysisRequest.safeParse({
        ...valid,
        snapshot: { ...demoSnapshot, rows: Array(10001).fill({}) },
      }).success,
    ).toBe(false);
    expect(
      analysisRequest.safeParse({
        ...valid,
        snapshot: { ...demoSnapshot, rows: [{ secret: 'x' }] },
      }).success,
    ).toBe(false);
  });
  it('拒绝同名字段和保留名称', () => {
    expect(
      analysisRequest.safeParse({
        ...valid,
        snapshot: { ...demoSnapshot, fields: [demoSnapshot.fields[0], demoSnapshot.fields[0]] },
      }).success,
    ).toBe(false);
    expect(
      analysisRequest.safeParse({
        ...valid,
        snapshot: { ...demoSnapshot, fields: [{ id: 'x', name: 'constructor', kind: 'text' }] },
      }).success,
    ).toBe(false);
  });
});

describe('CSV 导出', () => {
  it('处理公式注入、逗号、换行和双引号', () => {
    expect(csvValue('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvValue(' \t+1')).toBe('"\' \t+1"');
    expect(toCsv([{ name: 'a,b\nc', value: 12 }])).toContain('"a,b\nc","12"');
    expect(toCsv([{ a: 1 }, { b: 2 }])).toContain('"a","b"');
  });
});
