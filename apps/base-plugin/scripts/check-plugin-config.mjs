import { readConfig, validateConfig } from './plugin-config.mjs';
const publish = process.argv.includes('--publish');
const errors = validateConfig(await readConfig(), publish);
if (errors.length) {
  console.error(
    [
      publish ? '飞书插件上传前检查未通过' : '飞书插件调试配置检查未通过',
      ...errors.map((e) => `- ${e}`),
      '按 README 修改上面列出的配置后重试。',
    ].join('\n'),
  );
  process.exitCode = 1;
}
