import { readFile, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function main() {
  const deadline = Date.now() + 20_000;
  let api;
  while (Date.now() < deadline) {
    try {
      const ready = JSON.parse(await readFile(process.env.AVA_DEV_READY_FILE, 'utf8'));
      if (ready.runId === process.env.AVA_DEV_RUN_ID) {
        api = ready;
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!api) throw new Error('本次分析 API 未能启动，请查看上方 api 日志。');
  const descriptor = new URL('../.dev/connection.json', import.meta.url);
  const temporary = new URL(
    `../.dev/connection-${process.env.AVA_DEV_RUN_ID}.tmp`,
    import.meta.url,
  );
  await writeFile(
    temporary,
    JSON.stringify({
      pid: Number(process.env.AVA_DEV_PARENT_PID),
      apiOrigin: api.apiOrigin,
      debugOrigin: `http://localhost:${process.env.FEISHU_DEBUG_PORT}`,
    }),
    { mode: 0o600 },
  );
  await rename(temporary, descriptor);
  console.log(`本次分析 API 已就绪：${api.apiOrigin}；正在启动飞书视图。`);
  const child = spawn('npm', ['--prefix', 'plugin', 'start'], {
    stdio: 'inherit',
    env: { ...process.env, AVA_DEV_API_ORIGIN: api.apiOrigin },
  });
  child.on('error', () => {
    console.error('无法启动插件构建进程。');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
