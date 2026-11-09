import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { bindLarkCli, feishuGet, parseBaseUrl, probeBase, resolveBase } from './lark-cli.mjs';

const usage = 'npm run doctor:bot -- --url <Base 链接> [--profile <名称>] [--grant [--apply]]';

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      profile: { type: 'string' },
      grant: { type: 'boolean' },
      apply: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.url) throw new Error(`用法：${usage}`);
  if (values.apply && !values.grant) throw new Error('--apply 需要与 --grant 一起使用。');
  const target = parseBaseUrl(values.url);
  if (target.brand !== 'feishu') throw new Error('当前机器人使用飞书接口，请提供 feishu.cn 链接。');
  const appId =
    process.env.FEISHU_APP_ID ??
    (await readFile(new URL('../../apps/bot/.env', import.meta.url), 'utf8')
      .then((env) => parseEnv(env).FEISHU_APP_ID)
      .catch((error) => {
        if (error.code !== 'ENOENT') throw new Error('无法读取 apps/bot/.env，请检查文件权限。');
      }));
  const cli = await bindLarkCli(appId, target.brand, values.profile);
  console.log(`✓ CLI 与机器人配置的 App ID 一致（${appId}）`);
  const baseToken = await resolveBase(cli, 'bot', target);
  const probe = async () => {
    const result = await probeBase(cli, 'bot', baseToken, target.tableId);
    console.log(
      `✓ 机器人读表请求成功（${result.tableId}${target.tableId ? '' : '，首张可访问的数据表'}）`,
    );
    if (!result.hasVisibleRecord) {
      console.log('未返回可见记录。表格可能为空，也可能受行权限限制。');
    }
  };
  try {
    await probe();
    return;
  } catch (error) {
    if (!values.grant || !error.resourceDenied) throw error;
    console.log(error.message);
  }

  const botInfo = await feishuGet(cli, 'bot', 'bot/v3/info', '获取当前机器人身份');
  const openId = botInfo.open_id ?? botInfo.bot?.open_id;
  if (!/^ou_[A-Za-z0-9]+$/.test(openId ?? '')) {
    throw new Error(
      'CLI 未返回当前机器人的 open_id，请更新 lark-cli，并核对机器人能力和发布状态。',
    );
  }
  console.log(`授权目标 Base：${baseToken}。协作者：${openId}（${appId}）。权限：view（可阅读）。`);
  const args = [
    'drive',
    '+member-add',
    '--as',
    'user',
    '--type',
    'bitable',
    '--token',
    baseToken,
    '--member-type',
    'openid',
    '--member-id',
    openId,
    '--perm',
    'view',
    '--need-notification=false',
  ];
  if (!values.apply) {
    await cli([...args, '--dry-run'], '预览 Base 协作者授权', {
      preview: true,
    });
    console.log('预览完成。确认后用相同链接和 profile 重新运行，并加上 --grant --apply。');
    return;
  }
  await cli([...args, '--yes'], '添加 Base 协作者');
  console.log('✓ 飞书 CLI 已接受授权请求，正在以机器人身份复查。');
  try {
    await probe();
  } catch (error) {
    throw new Error(
      `授权请求已执行，读表复查未通过。${error.message}请检查高级权限或稍后重跑只读诊断。`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
