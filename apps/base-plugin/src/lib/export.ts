import type { AnalysisResult } from '../../shared/types';

export function csvValue(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    '\uFEFF' +
    [
      columns.map(csvValue).join(','),
      ...rows.map((row) => columns.map((c) => csvValue(row[c])).join(',')),
    ].join('\r\n')
  );
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReport(result: AnalysisResult, tableName: string) {
  download(
    'AVA-分析报告.md',
    `# ${result.query}\n\n数据表：${tableName} · ${result.rowCount} 条记录\n\n${result.text}\n\n## 查询依据\n\n\`\`\`sql\n${result.sql ?? '无 SQL'}\n\`\`\`\n\n分析时间：${result.createdAt}\n模式：${result.mode === 'demo' ? '演示数据 / 预设查询' : 'AVA 模型分析'}\n`,
    'text/markdown;charset=utf-8',
  );
}
