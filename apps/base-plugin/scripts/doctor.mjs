import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  bindLarkCli,
  parseBaseUrl,
  probeBase,
  resolveBase,
} from '../../../scripts/feishu/lark-cli.mjs';
import { readConfig } from './plugin-config.mjs';

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      profile: { type: 'string' },
      model: { type: 'boolean' },
      stream: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'npm run doctor:plugin -- [--url <Base 链接>] [--profile <名称>] [--model | --stream]',
    );
    return;
  }
  console.log(`检查配置：${fileURLToPath(new URL('../.env', import.meta.url))}`);
  const missing = ['AVA_API_KEY', 'AVA_MODEL'].filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new Error(`模型配置缺少 ${missing.join('、')}，请填写后重启 npm run dev:plugin。`);
  console.log('✓ 模型配置已填写（不输出密钥）');
  let connection;
  try {
    connection = JSON.parse(
      await readFile(new URL('../.dev/connection.json', import.meta.url), 'utf8'),
    );
    process.kill(connection.pid, 0);
  } catch {
    throw new Error('没有正在运行的本地调试会话，请先运行 npm run dev:plugin。');
  }
  const config = await readConfig();
  const target = parseBaseUrl(values.url ?? config.block.url);
  const hostOrigin = target.url.origin;
  if (values.url) {
    target.url.searchParams.set('debugPort', new URL(connection.debugOrigin).port);
    console.log(`目标表格调试链接：${target.url}`);
  }
  const hostRequest = async (path) => {
    const response = await fetch(new URL(path, connection.debugOrigin), {
      headers: { Origin: hostOrigin },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => ({}));
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
    if (!response.ok || body.code !== 0 || !['*', hostOrigin].includes(allowOrigin)) {
      throw new Error(
        `飞书插件注册接口 ${path} 异常（HTTP ${response.status}）。请重启本地调试服务；此项失败时飞书无法识别视图插件。`,
      );
    }
    return body.data;
  };
  const blocks = await hostRequest('/api/block');
  if (
    !blocks.blocks?.some(
      (block) => block.blockTypeID === config.block.blockTypeID && block.appID === config.app.appId,
    )
  ) {
    throw new Error('本地注册返回的 App ID / BlockTypeID 与绑定配置不一致。');
  }
  const registration = blocks.blocks.find(
    (block) => block.blockTypeID === config.block.blockTypeID,
  );
  const expectedName = config.block.projectName?.trim() || 'AVA 数据洞察';
  if (registration.name?.['zh-CN'] !== expectedName) {
    throw new Error('本地插件显示名称未更新，请重启 npm run dev:plugin，并刷新整个飞书页面。');
  }
  console.log(`✓ 本地插件名称：${expectedName}`);
  const meta = await hostRequest('/api/meta');
  const app = meta.app_metas?.find((app) => app.app_base_info?.app_id === config.app.appId);
  const extension = app?.extension_metas?.find(
    (extension) => extension.extension_id === config.block.blockTypeID,
  );
  if (!extension) throw new Error('飞书调试元数据缺少当前视图的 BlockTypeID。');
  const fallback = JSON.parse(extension.ext_config || '{}').fallback_path_list?.[0];
  if (!fallback || new URL(fallback).origin !== connection.debugOrigin) {
    throw new Error('视图入口未指向本次调试服务，请重新启动本地调试。');
  }
  const entry = await fetch(fallback, { signal: AbortSignal.timeout(8000) });
  if (!entry.ok || !(entry.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('插件已注册，但视图 HTML 入口不可用。');
  }
  console.log('✓ 飞书宿主来源 → 插件注册 / 元数据 → 视图入口正常');
  const endpoint = new URL('/api/connection', connection.debugOrigin);
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Origin: connection.debugOrigin },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`无法连接 ${connection.debugOrigin}，请确认调试服务已编译完成。`);
  }
  const status = await response.json().catch(() => ({}));
  if (!response.ok || !status.ready) {
    throw new Error(
      '本地连接或认证未通过，请重启 npm run dev:plugin，并使用终端打印的新调试链接。',
    );
  }
  console.log('✓ 调试视图 → 自动认证代理 → 分析 API 连接正常');
  if (values.profile) {
    const cli = await bindLarkCli(config.app.appId, target.brand, values.profile);
    const baseToken = await resolveBase(cli, 'user', target);
    const { tableId, hasVisibleRecord } = await probeBase(cli, 'user', baseToken, target.tableId);
    console.log(
      `✓ CLI 登录用户通过 OpenAPI 试读成功（${tableId}${hasVisibleRecord ? '' : '，未返回可见记录'}）`,
    );
    console.log('请在目标表格内打开 AVA，确认飞书宿主 SDK 能读取数据。');
  }
  if (values.model || values.stream) {
    console.log('正在用三条内置测试数据验证真实模型、SQL 计算和图表流程…');
    const { runAnalysis } = await import('../server/analysis.ts');
    try {
      let textChunks = 0;
      let firstTextAt = 0;
      const startedAt = Date.now();
      const result = await runAnalysis(
        '计算 amount 字段总和，返回一行合计结果',
        {
          tableId: 'connection-check',
          tableName: '连接检查',
          source: 'feishu',
          fields: [{ id: 'amount', name: 'amount', kind: 'number' }],
          rows: [{ amount: 1 }, { amount: 2 }, { amount: 3 }],
          loadedAt: new Date().toISOString(),
        },
        'live',
        {
          apiKey: process.env.AVA_API_KEY.trim(),
          model: process.env.AVA_MODEL.trim(),
          baseURL: process.env.AVA_BASE_URL?.trim() || undefined,
        },
        undefined,
        values.stream
          ? (update) => {
              if (update.type === 'text') {
                textChunks++;
                firstTextAt ||= Date.now();
              }
            }
          : undefined,
      );
      if (!result.data.some((row) => Object.values(row).some((value) => Number(value) === 6))) {
        throw new Error('unexpected result');
      }
      if (values.stream) {
        const native =
          result.steps?.find((step) => step.id === 'summary')?.detail === '文本已实时返回';
        console.log(
          native
            ? `✓ 模型原生流式返回：${textChunks} 个片段，首段 ${((firstTextAt - startedAt) / 1000).toFixed(1)} 秒`
            : '✓ 当前模型按整段返回，实时阶段和任务恢复仍可使用',
        );
      }
    } catch {
      throw new Error(
        '模型端到端检查未通过：请核对 AVA_API_KEY、AVA_MODEL、AVA_BASE_URL 和网络连接。',
      );
    }
    console.log('✓ 真实模型调用、SQL 执行与结果校验通过');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
