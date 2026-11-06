import { describe, it, expect } from 'vitest';
import { AVA } from '@antv/ava';
import { runAnalysis } from '../server/analysis';
import { demoSnapshot } from '../shared/demo';
import { DEMO_QUESTIONS } from '../shared/types';

describe('AVA / DuckDB 实际执行', () => {
  it.each(DEMO_QUESTIONS)('演示查询正确汇总：%s', async (question) => {
    const result = await runAnalysis(question, demoSnapshot, 'demo');
    const metric = question === DEMO_QUESTIONS[3] ? '订单量' : '销售额';
    const expected = demoSnapshot.rows.reduce((n, row) => n + Number(row[metric]), 0);
    expect(result.data.reduce((n, row) => n + Number(row.value), 0)).toBe(expected);
    expect(result.text).toContain(expected.toLocaleString('zh-CN'));
    expect(result.chart?.chartType).toBeTruthy();
    expect(result.sql).toContain('SUM');
    expect(result.rowCount).toBe(72);
  });
  it('演示拒绝未支持问题，不调用模型编造答案', async () => {
    await expect(runAnalysis('预测未来', demoSnapshot, 'demo')).rejects.toThrow('演示模式支持');
  });
  it('演示数据不受客户端提交内容污染', async () => {
    const result = await runAnalysis(
      DEMO_QUESTIONS[0],
      { ...demoSnapshot, rows: [{ 销售额: -1 }] },
      'demo',
    );
    expect(result.rowCount).toBe(72);
  });
  it('AVA 阻止写入及读取任意本地文件', async () => {
    const ava = new AVA({ llm: { model: 'unused', apiKey: 'unused' } });
    try {
      await ava.source({ type: 'json', options: { data: [{ value: 1 }] } });
      await expect(ava.query('DROP TABLE data')).rejects.toThrow();
      await expect(ava.query("SELECT * FROM read_csv_auto('/etc/hosts')")).rejects.toThrow();
      expect((await ava.query('SELECT COUNT(*) AS n FROM data')).data).toEqual([{ n: 1 }]);
    } finally {
      await ava.dispose();
    }
  });
});
