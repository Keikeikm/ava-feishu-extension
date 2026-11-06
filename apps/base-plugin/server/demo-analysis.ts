import { DEMO_QUESTIONS } from '../shared/types';

export function demoPlan(question: string) {
  const index = DEMO_QUESTIONS.indexOf(question as (typeof DEMO_QUESTIONS)[number]);
  const dimensions = ['月份', '地区', '产品', '渠道'];
  if (index < 0) throw new Error('演示模式支持下方 4 个示例问题。配置模型后即可自由提问。');
  const dimension = dimensions[index];
  const metric = index === 3 ? '订单量' : '销售额';
  return {
    sql: `SELECT "${dimension}" AS category, SUM("${metric}") AS value FROM data GROUP BY "${dimension}" ORDER BY ${index === 0 ? 'category ASC' : 'value DESC'}`,
    chartType: (['line', 'bar', 'pie', 'column'] as const)[index],
    dimension,
    metric,
  };
}

export function demoSummary(data: Record<string, unknown>[], dimension: string, metric: string) {
  const total = data.reduce((sum, row) => sum + Number(row.value), 0);
  const top = [...data].sort((a, b) => Number(b.value) - Number(a.value))[0];
  const format = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  let text = `按${dimension}汇总，${metric}合计 **${format(total)}${metric === '销售额' ? ' 元' : ' 笔'}**。`;
  if (top)
    text += `其中 **${String(top.category)}** 最高，为 **${format(Number(top.value))}**，占总量的 **${((Number(top.value) / total) * 100).toFixed(1)}%**。`;
  if (dimension === '月份' && data.length > 1) {
    const first = Number(data[0].value),
      last = Number(data.at(-1)!.value);
    text += `\n\n从 ${data[0].category} 到 ${data.at(-1)!.category}，销售额${last >= first ? '增长' : '下降'} **${Math.abs(((last - first) / first) * 100).toFixed(1)}%**。这是首尾月份的对比。`;
  }
  return text + '\n\n演示结论由预设 SQL 的实际计算结果生成；自由提问需要连接模型。';
}
