import type { Snapshot, Row } from './types';

// Deterministic, synthetic dataset. Never mixed with a user's Feishu data.
const regions = ['华东', '华南', '华北', '西南'];
const products = ['智能办公', '协作套件', '数据服务'];
const channels = ['官网', '合作伙伴', '线下活动'];
const rows: Row[] = [];
for (let month = 1; month <= 6; month++) {
  regions.forEach((region, r) =>
    products.forEach((product, p) => {
      const orders = 18 + month * 4 + (3 - r) * 7 + p * 3;
      rows.push({
        月份: `2026-${String(month).padStart(2, '0')}`,
        地区: region,
        产品: product,
        渠道: channels[(month + r + p) % 3],
        销售额: orders * (580 + p * 260) + month * 1270 + r * 830,
        订单量: orders,
      });
    }),
  );
}

export const demoSnapshot: Snapshot = {
  tableId: 'demo-sales',
  tableName: '销售经营数据',
  viewName: '2026 年上半年',
  fields: [
    { id: 'month', name: '月份', kind: 'text' },
    { id: 'region', name: '地区', kind: 'text' },
    { id: 'product', name: '产品', kind: 'text' },
    { id: 'channel', name: '渠道', kind: 'text' },
    { id: 'sales', name: '销售额', kind: 'number' },
    { id: 'orders', name: '订单量', kind: 'number' },
  ],
  rows,
  loadedAt: new Date().toISOString(),
  source: 'demo',
};
