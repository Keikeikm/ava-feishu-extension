import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';

const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.FIXTURE_LOG;
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (process.env.FEISHU_APP_SECRET) throw new Error('inherited app secret');
const mode = process.env.FIXTURE_MODE;
const identity = args[args.indexOf('--as') + 1];
const send = (data) => console.log(JSON.stringify({ ok: true, identity, data }));
if (args.includes('config')) {
  console.log(JSON.stringify({ appId: mode === 'mismatch' ? 'cli_other' : 'cli_test', brand: 'feishu', profile: 'fixture' }));
} else if (args.includes('+member-add')) {
  send({});
} else if (args.includes('/open-apis/bot/v3/info')) {
  send({ open_id: 'ou_fixture' });
} else if (args.some((arg) => arg.endsWith('/spaces/get_node'))) {
  send({ node: { obj_type: 'bitable', obj_token: 'baseFixture' } });
} else if (args.some((arg) => arg.endsWith('/tables'))) {
  send({ items: [{ table_id: 'tblFirst' }] });
} else if (args.some((arg) => arg.endsWith('/fields'))) {
  send({ items: [{ field_id: 'fldFixture' }] });
} else if (mode === 'scope' || mode === 'denied' || mode === 'stays-denied' ||
           (mode === 'grant' && !previous.includes('"--yes"'))) {
  console.error(JSON.stringify({
    ok: false, error: { type: 'permission', code: mode === 'scope' ? 99991672 : 91403 },
  }));
  process.exitCode = 4;
} else {
  send({ items: [{ fields: { hidden: 'private record value' } }] });
}
`;

function check(
  mode,
  flags = [],
  url = 'https://tenant.feishu.cn/base/baseFixture?table=tblTarget',
) {
  const dir = mkdtempSync(join(tmpdir(), 'ava-lark-cli-'));
  try {
    const log = join(dir, 'calls');
    writeFileSync(join(dir, 'lark-cli'), fixture, { mode: 0o700 });
    const result = spawnSync(
      process.execPath,
      [new URL('./doctor-bot.mjs', import.meta.url).pathname, '--url', url, ...flags],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: dir + delimiter + process.env.PATH,
          FIXTURE_LOG: log,
          FIXTURE_MODE: mode,
          FEISHU_APP_ID: 'cli_test',
          FEISHU_APP_SECRET: 'do-not-pass-to-child',
        },
      },
    );
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('试读指定数据表，只报告权限结果', () => {
  const { status, stdout, calls } = check('read');
  assert.equal(status, 0);
  assert.match(stdout, /tblTarget/);
  assert.doesNotMatch(stdout, /private record value/);
  assert.equal(calls.length, 3);
  assert.equal(calls[1][0], '--profile=fixture');
  assert.ok(calls[1].includes('/open-apis/bitable/v1/apps/baseFixture/tables/tblTarget/fields'));
  assert.ok(calls[2].includes('/open-apis/bitable/v1/apps/baseFixture/tables/tblTarget/records'));
  assert.ok(calls[2].includes('{"page_size":1}'));
});

test('知识库链接用同一个机器人身份解析并试读首表', () => {
  const { status, stdout, calls } = check('read', [], 'https://tenant.feishu.cn/wiki/wikiFixture');
  assert.equal(status, 0);
  assert.match(stdout, /首张可访问/);
  assert.ok(calls[1].includes('/open-apis/wiki/v2/spaces/get_node'));
  assert.ok(calls[4].includes('/open-apis/bitable/v1/apps/baseFixture/tables/tblFirst/records'));
  for (const call of calls.slice(1)) assert.ok(call.includes('bot'));
});

test('App ID 不符或 API 权限缺失时不触发授权', () => {
  const wrong = check('mismatch', ['--grant', '--apply']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /不匹配/);
  assert.equal(wrong.calls.length, 1);
  const missingScope = check('scope', ['--grant', '--apply']);
  assert.equal(missingScope.status, 1);
  assert.match(missingScope.stderr, /API 权限/);
  assert.equal(missingScope.calls.length, 3);
});

test('预览使用用户身份和 dry-run，无实际写操作', () => {
  const { status, stdout, calls } = check('denied', ['--grant']);
  assert.equal(status, 0);
  assert.match(stdout, /预览完成/);
  const grant = calls.find((call) => call.includes('+member-add'));
  for (const flag of ['user', 'baseFixture', 'ou_fixture', 'view', '--dry-run']) {
    assert.ok(grant.includes(flag));
  }
  assert.ok(!grant.includes('--yes'));
});

test('明确执行授权后用相同机器人身份复查，复查失败仍返回失败', () => {
  const flags = ['--grant', '--apply'];
  const { status, calls } = check('grant', flags);
  assert.equal(status, 0);
  assert.ok(calls.at(-3).includes('--yes'));
  assert.ok(calls.at(-3).includes('user'));
  assert.ok(calls.at(-1).includes('bot'));
  assert.deepEqual(calls.slice(-2), calls.slice(1, 3));

  const denied = check('stays-denied', flags);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /读表复查未通过/);
  assert.equal(denied.calls.filter((call) => call.includes('--yes')).length, 1);
});
