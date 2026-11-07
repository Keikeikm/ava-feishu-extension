import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = new URL('../', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
export async function readConfig() {
  return {
    app: await read('app.json'),
    block: await read('plugin/block.json'),
    runtime: await read('plugin/runtime.config.json'),
  };
}
export function validateConfig({ app, block, runtime }, publish = false) {
  const errors = [];
  if (!/^cli_[a-zA-Z0-9]+$/.test(app.appId)) errors.push('缺少真实 App ID（cli_...）');
  if (!/^blk_[a-zA-Z0-9]+$/.test(block.blockTypeID))
    errors.push('缺少数据表视图能力的 BlockTypeID（blk_...）');
  try {
    const url = new URL(block.url);
    if (
      url.protocol !== 'https:' ||
      !/\.(feishu\.cn|larksuite\.com)$/.test(url.hostname) ||
      !/\/(base|wiki)\//.test(url.pathname)
    )
      throw new Error();
  } catch {
    errors.push('缺少有效的飞书多维表格调试链接');
  }
  try {
    const url = new URL(runtime.apiOrigin);
    if (
      url.origin !== runtime.apiOrigin ||
      url.username ||
      url.password ||
      (publish && url.protocol !== 'https:') ||
      (!publish && !['https:', 'http:'].includes(url.protocol))
    )
      throw new Error();
  } catch {
    errors.push(
      publish
        ? '上传需要已部署的 HTTPS 分析服务地址（不带 /api、路径或密钥）。仅更新地址可在仓库根目录运行 npm run plugin:configure -w @ava/base-plugin -- --api-origin https://ava.example.com，并替换成你的真实地址。'
        : '分析服务地址须为 HTTP(S) origin（不带 /api、路径或密钥）',
    );
  }
  return errors;
}
export async function configureConfig(args) {
  const config = await readConfig();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!value) throw new Error(`缺少 ${key} 的值`);
    if (key === '--app-id') config.app.appId = value;
    else if (key === '--block-type-id') config.block.blockTypeID = value;
    else if (key === '--base-url') config.block.url = value;
    else if (key === '--api-origin') config.runtime.apiOrigin = value.replace(/\/$/, '');
    else throw new Error(`未知参数：${key}`);
  }
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join('\n'));
  await Promise.all(
    [
      ['app.json', config.app],
      ['plugin/block.json', config.block],
      ['plugin/runtime.config.json', config.runtime],
    ].map(([name, value]) => writeFile(new URL(name, root), JSON.stringify(value, null, 2) + '\n')),
  );
  console.log(
    '已写入插件绑定配置。下一步在仓库根目录运行 npm exec -w @ava/base-plugin -- opdev login，然后运行 npm run dev:plugin。',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  configureConfig(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
