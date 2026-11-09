import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function parseBaseUrl(input) {
  const url = URL.parse(input ?? '');
  const match = url?.pathname.match(/^\/(base|wiki)\/([A-Za-z0-9]+)\/?$/);
  if (
    !match ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/^(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com)$/i.test(url.hostname)
  ) {
    throw new Error('请提供飞书多维表格的原始 /base/ 或 /wiki/ 链接。');
  }
  const tableId = url.searchParams.get('table');
  if (tableId !== null && !/^tbl[A-Za-z0-9]+$/.test(tableId)) {
    throw new Error('链接中的 table 参数无效。');
  }
  const brand = url.hostname.endsWith('larksuite.com') ? 'lark' : 'feishu';
  return { url, kind: match[1], token: match[2], tableId, brand };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function cliFailure(body, operation) {
  const detail = body?.error ?? body;
  const code = typeof detail?.code === 'number' ? detail.code : undefined;
  const subtype = detail?.subtype;
  let hint = '请核对 CLI 配置、网络和飞书应用权限。';
  if (['not_configured', 'profile_not_found'].includes(subtype)) {
    hint = '请先用 lark-cli config init 配置对应的现有应用。';
  } else if (detail?.type === 'authentication') {
    hint = '请核对应用凭据。以用户身份操作时，先用对应 profile 完成 OAuth 登录。';
  } else if (code === 99991672 || ['missing_scope', 'app_scope_not_applied'].includes(subtype)) {
    hint = '请在飞书开放平台核对该身份的 API 权限和发布状态；用户身份还需完成 OAuth 授权。';
  } else if ([91403, 1254302].includes(code)) {
    hint = '请核对目标 Base、知识库或数据表对调用身份的访问权限。';
  } else if ([91402, 1254040, 1254041, 93004].includes(code)) {
    hint = '请确认链接有效、目标存在，并对调用身份开放。';
  }
  return Object.assign(
    new Error(`${operation}失败${code ? `（飞书错误码 ${code}）` : ''}。${hint}`),
    {
      resourceDenied: [91403, 1254302].includes(code),
    },
  );
}

async function run(args, operation, { preview = false } = {}) {
  let stdout;
  try {
    const env = { ...process.env };
    for (const key of ['FEISHU_APP_SECRET', 'LLM_API_KEY', 'AVA_API_KEY', 'PLUGIN_ACCESS_TOKEN']) {
      delete env[key];
    }
    ({ stdout } = await exec('lark-cli', args, {
      env: {
        ...env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    }));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('未找到 lark-cli。请先安装官方飞书 CLI，并确认它在 PATH 中。');
    }
    if (error.killed) throw new Error(`${operation}超时。请检查网络后重新运行只读诊断。`);
    throw cliFailure(parseJson(error.stderr) ?? parseJson(error.stdout), operation);
  }
  const body = parseJson(stdout);
  if (body?.ok === false || (typeof body?.code === 'number' && body.code !== 0)) {
    throw cliFailure(body, operation);
  }
  if (!preview && (!body || typeof body !== 'object')) {
    throw new Error(`${operation}未返回有效 JSON，请检查 lark-cli 版本。`);
  }
  return body;
}

export async function bindLarkCli(expectedAppId, brand, profile) {
  if (!/^cli_[A-Za-z0-9]+$/.test(expectedAppId ?? '')) {
    throw new Error('请先在项目中配置目标飞书应用的 App ID。');
  }
  const prefix = profile ? [`--profile=${profile}`] : [];
  const config = await run([...prefix, 'config', 'show'], '读取飞书 CLI 配置');
  if (config.appId !== expectedAppId || config.brand !== brand) {
    throw new Error(
      `CLI 的应用或平台与项目配置不匹配。请选择 App ID 为 ${expectedAppId} 的 ${brand} profile。`,
    );
  }
  if (typeof config.profile !== 'string' || !config.profile) {
    throw new Error('CLI 未返回可固定的 profile，请更新 lark-cli。');
  }
  return (args, operation, options) =>
    run([`--profile=${config.profile}`, ...args], operation, options);
}

export async function feishuGet(cli, identity, path, operation, params) {
  const result = await cli(
    [
      'api',
      'GET',
      `/open-apis/${path}`,
      '--as',
      identity,
      '--format',
      'json',
      ...(params ? ['--params', JSON.stringify(params)] : []),
    ],
    operation,
  );
  if (result.ok !== true || result.identity !== identity || !result.data) {
    throw new Error(`${operation}返回的身份或数据不符合预期，请检查 lark-cli 版本。`);
  }
  return result.data;
}

export async function resolveBase(cli, identity, target) {
  if (target.kind === 'base') return target.token;
  const { node } = await feishuGet(cli, identity, 'wiki/v2/spaces/get_node', '解析知识库节点', {
    token: target.token,
    obj_type: 'wiki',
  });
  if (node?.obj_type !== 'bitable' || !/^[A-Za-z0-9]+$/.test(node.obj_token ?? '')) {
    throw new Error('这个知识库链接没有指向多维表格。');
  }
  return node.obj_token;
}

export async function probeBase(cli, identity, baseToken, tableId) {
  const tablesPath = `bitable/v1/apps/${baseToken}/tables`;
  if (!tableId) {
    const { items } = await feishuGet(cli, identity, tablesPath, '列出可访问的数据表', {
      page_size: 1,
    });
    tableId = items?.[0]?.table_id;
    if (!/^tbl[A-Za-z0-9]+$/.test(tableId ?? '')) {
      throw new Error('没有返回可试读的数据表。请核对 Base 权限，或提供带 table 参数的链接。');
    }
  }
  await feishuGet(cli, identity, `${tablesPath}/${tableId}/fields`, '试读数据表字段', {
    page_size: 1,
  });
  const { items } = await feishuGet(
    cli,
    identity,
    `${tablesPath}/${tableId}/records`,
    '试读数据表记录',
    {
      page_size: 1,
    },
  );
  return {
    tableId,
    hasVisibleRecord: Array.isArray(items) && items.length > 0,
  };
}
