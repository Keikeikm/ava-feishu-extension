import type { Cell, Field } from '../../shared/types';

export function normalizeCell(value: unknown, kind: Field['kind']): Cell {
  if (value === null || value === undefined || value === '') return null;
  if (kind === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    // Never turn formatted percentages or currency text into ambiguous numbers.
    if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))
      return Number(value);
  }
  if (kind === 'date' && typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value.map((v) => normalizeCell(v, 'text')).filter((v) => v !== null);
    // Rich text is an ordered run of segments; other arrays are lists.
    return (
      items.join(value.every((v) => v && typeof v === 'object' && 'text' in v) ? '' : '、') || null
    );
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'name', 'value']) {
      if (record[key] !== undefined) return normalizeCell(record[key], kind);
    }
    // IDs, attachment tokens, person IDs and nested metadata are never serialized to the model.
    return null;
  }
  return null;
}

export function fieldKind(type: number): Field['kind'] {
  if ([2, 99002, 99003, 99004].includes(type)) return 'number';
  if ([5, 1001, 1002].includes(type)) return 'date';
  if (type === 7) return 'boolean';
  return 'text';
}
