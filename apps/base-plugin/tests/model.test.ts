import request from 'supertest';
import { createApp } from '../server/app';
import type { RelatedSnapshot, Snapshot } from '../shared/types';
import { describe, it, expect } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { runAnalysis } from '../server/analysis';
import { demoSnapshot } from '../shared/demo';

describe('AVA 模型协议集成（本机兼容接口夹具）', () => {
  it('走通单表分析和跨表 HTTP 请求，重复关联键在调用模型前被拦截', async () => {
    const prompts: string[] = [];
    const provider = express();
    provider.use(express.json());
    provider.post('/v1/chat/completions', (req, res) => {
      const prompt = req.body.messages.map((m: { content: string }) => m.content).join('\n');
      prompts.push(prompt);
      let content: string;
      if (prompt.includes('SQL expert')) {
        content = prompt.includes('关联条件')
          ? `SELECT "客户"."地区" AS category, SUM("订单"."金额") AS value
             FROM "订单" JOIN "客户" ON "订单"."客户号" = "客户"."编号"
             GROUP BY "客户"."地区" ORDER BY value DESC`
          : 'SELECT "地区" AS category, SUM("销售额") AS value FROM data GROUP BY "地区" ORDER BY value DESC';
      } else if (prompt.includes('queryExplanation')) {
        content = JSON.stringify({
          queryExplanation: '按地区汇总销售额',
          conclusion: '华东地区销售额最高。',
        });
      } else if (prompt.includes('图表推荐专家')) {
        content = 'bar';
      } else {
        content = JSON.stringify({
          type: 'bar',
          title: '各地区销售额',
          data: [{ category: '华东', value: 1 }],
        });
      }
      res.json({
        id: 'fixture',
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    });
    const server = provider.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const model = {
        model: 'fixture',
        apiKey: 'local-fixture-key',
        baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      };
      const result = await runAnalysis('按地区比较销售额', demoSnapshot, 'live', model);
      expect(result.data).toHaveLength(4);
      expect(result.data[0].category).toBe('华东');
      expect(result.text).toBe('华东地区销售额最高。');
      expect(result.chart?.chartType).toBe('bar');
      expect(result.chartHtml).toContain('GPTVis');
      expect(prompts).toHaveLength(4);
      expect(result.mode).toBe('live');

      const snapshot: Snapshot = {
        ...demoSnapshot,
        source: 'feishu',
        tableId: 'orders',
        tableName: '订单',
        fields: [
          { id: 'customer', name: '客户号', kind: 'text' },
          { id: 'amount', name: '金额', kind: 'number' },
        ],
        rows: [
          { 客户号: '001', 金额: 3 },
          { 客户号: '001', 金额: 7 },
          { 客户号: '1', 金额: 5 },
          { 客户号: null, 金额: 9 },
        ],
      };
      const related: RelatedSnapshot = {
        snapshot: {
          ...snapshot,
          tableId: 'customers',
          tableName: '客户',
          fields: [
            { id: 'id', name: '编号', kind: 'text' },
            { id: 'region', name: '地区', kind: 'text' },
          ],
          rows: [
            { 编号: '001', 地区: '华东' },
            { 编号: '1', 地区: '华北' },
          ],
        },
        primaryFieldId: 'customer',
        relatedFieldId: 'id',
      };
      const app = createApp({ model });
      const body = { mode: 'live', question: '按客户地区汇总订单', snapshot, related };
      const joined = await request(app).post('/api/analyze').send(body);
      expect(joined.status).toBe(200);
      expect(joined.body.data).toEqual([
        { category: '华东', value: 10 },
        { category: '华北', value: 5 },
      ]);
      expect(joined.body.joinQuality).toEqual({
        primaryRows: 4,
        primaryMissingKeys: 1,
        matchedRows: 3,
        relatedMissingKeys: 0,
        relatedDuplicateKeys: 0,
      });

      const beforeInvalid = prompts.length;
      const unselected = await request(app)
        .post('/api/analyze')
        .send({
          ...body,
          related: { ...related, relatedFieldId: 'unselected-field' },
        });
      expect(unselected.status).toBe(400);

      const duplicate = await request(app)
        .post('/api/analyze')
        .send({
          ...body,
          related: {
            ...related,
            snapshot: {
              ...related.snapshot,
              rows: [...related.snapshot.rows, { 编号: '001', 地区: '华南' }],
            },
          },
        });
      expect(duplicate.status).toBe(422);
      expect(duplicate.body.error).toContain('键值重复');
      expect(prompts).toHaveLength(beforeInvalid);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
