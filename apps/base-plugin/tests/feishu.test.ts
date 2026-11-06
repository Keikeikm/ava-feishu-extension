import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFeishu, listViews, readViewConfig, saveViewConfig } from '../src/lib/feishu';

const table = vi.hoisted(() => ({
  getFieldMetaList: vi.fn(),
  getName: vi.fn(),
  getViewMetaList: vi.fn(),
  getViewById: vi.fn(),
  getRecordsByPage: vi.fn(),
}));
const bridge = vi.hoisted(() => ({ getData: vi.fn(), setData: vi.fn() }));
vi.mock('@lark-opdev/block-bitable-api', () => ({
  bitable: { base: { getTableById: vi.fn(async () => table) }, bridge },
}));

beforeEach(() => {
  vi.resetAllMocks();
  table.getFieldMetaList.mockResolvedValue([
    { id: 'a', name: '金额', type: 99003 },
    { id: 'b', name: '客户', type: 1 },
    { id: 'c', name: '隐藏', type: 1 },
    { id: 'd', name: '附件', type: 17 },
    { id: 'e', name: '无权限', type: 403 },
  ]);
  table.getName.mockResolvedValue('订单');
  table.getViewMetaList.mockResolvedValue([{ id: 'view', name: '本月订单' }]);
  table.getViewById.mockResolvedValue({ getVisibleFieldIdList: async () => ['a', 'b'] });
});

describe('飞书读取', () => {
  it('源视图不包含插件自己及表单，避免递归选择插件视图', async () => {
    table.getViewMetaList.mockResolvedValue([
      { id: 'grid', name: '表格', type: 1 },
      { id: 'self', name: 'AVA', type: 100 },
      { id: 'form', name: '表单', type: 3 },
    ]);
    expect(await listViews('tbl')).toEqual([{ id: 'grid', name: '表格', type: 1 }]);
  });
  it('只持久化视图设置，不保存数据记录或令牌', async () => {
    const config = { tableId: 'tbl', sourceViewId: 'view', fieldIds: ['a'] };
    bridge.getData.mockResolvedValue({ ...config, token: 'must-not-read', rows: ['private'] });
    expect(await readViewConfig()).toEqual(config);
    bridge.setData.mockResolvedValue(true);
    await saveViewConfig(config);
    expect(bridge.setData).toHaveBeenCalledWith('ava-analysis-config', config);
    bridge.setData.mockResolvedValue(false);
    await expect(saveViewConfig(config)).rejects.toThrow('视图配置保存失败');
  });
  it('逐页获取指定视图，尊重隐藏字段并规范化数值', async () => {
    table.getRecordsByPage
      .mockResolvedValueOnce({
        total: 2,
        hasMore: true,
        pageToken: 2,
        records: [{ recordId: 'r1', fields: { a: 0, b: [{ text: '甲' }], c: 'secret' } }],
      })
      .mockResolvedValueOnce({
        total: 2,
        hasMore: false,
        records: [{ recordId: 'r2', fields: { a: 300, b: [{ text: '乙' }] } }],
      });
    const progress = vi.fn();
    const snapshot = await loadFeishu('tbl', 'view', progress);
    expect(snapshot.rows).toEqual([
      { 金额: 0, 客户: '甲' },
      { 金额: 300, 客户: '乙' },
    ]);
    expect(snapshot.fields.map((f) => f.name)).toEqual(['金额', '客户']);
    expect(snapshot.viewName).toBe('本月订单');
    expect(table.getRecordsByPage).toHaveBeenNthCalledWith(2, {
      pageSize: 200,
      pageToken: 2,
      viewId: 'view',
    });
    expect(progress).toHaveBeenLastCalledWith(2);
  });
  it('超量数据直接拒绝，避免静默截断', async () => {
    table.getRecordsByPage.mockResolvedValue({ total: 10001, hasMore: true, records: [] });
    await expect(loadFeishu('tbl', undefined, vi.fn())).rejects.toThrow('不会对截断数据进行分析');
  });
  it('分页 token 不前进时终止', async () => {
    table.getRecordsByPage.mockResolvedValue({
      total: 2,
      hasMore: true,
      pageToken: 1,
      records: [],
    });
    await expect(loadFeishu('tbl', 'view', vi.fn())).rejects.toThrow('分页返回异常');
  });
  it('视图权限失败时不会回退读取全表', async () => {
    table.getViewById.mockRejectedValue(new Error('Denied'));
    await expect(loadFeishu('tbl', 'view', vi.fn())).rejects.toThrow('Denied');
    expect(table.getRecordsByPage).not.toHaveBeenCalled();
  });
});
