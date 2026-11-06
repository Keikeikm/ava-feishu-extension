import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('官方数据表视图工程', () => {
  it('配置校验区分本地调试与正式上传，空绑定不会被当作已安装', async () => {
    const { validateConfig } = await import('../scripts/plugin-config.mjs');
    const config = {
      app: { appId: 'cli_test123' },
      block: { blockTypeID: 'blk_test123', url: 'https://example.feishu.cn/base/test123' },
      runtime: { apiOrigin: 'http://127.0.0.1:3001' },
    };
    expect(validateConfig(config)).toEqual([]);
    expect(validateConfig(config, true)).toHaveLength(1);
    expect(validateConfig({ ...config, app: { appId: '' } })).toHaveLength(1);
    expect(
      validateConfig({ ...config, runtime: { apiOrigin: 'https://service.test/api' } }),
    ).toHaveLength(1);
    expect(
      validateConfig({ ...config, runtime: { apiOrigin: 'https://service.test' } }, true),
    ).toEqual([]);
  });

  it('生成官方 offlineWeb 包及 manifest，所有入口资源实际存在', async () => {
    const config = JSON.parse(
      await readFile(new URL('../plugin/dist/project.config.json', import.meta.url), 'utf8'),
    );
    const index = JSON.parse(
      await readFile(new URL('../plugin/dist/index.json', import.meta.url), 'utf8'),
    );
    const block = JSON.parse(
      await readFile(new URL('../plugin/block.json', import.meta.url), 'utf8'),
    );
    const html = await readFile(new URL('../plugin/dist/index.html', import.meta.url), 'utf8');
    expect(config.blocks).toEqual(['index']);
    expect(index.blockRenderType).toBe('offlineWeb');
    expect(index.blockTypeID).toBe(block.blockTypeID);
    const scripts = [...html.matchAll(/src=["\']?([^"\'\s>]+\.js)/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts)
      expect(
        (await readFile(new URL('../plugin/dist/' + script, import.meta.url))).byteLength,
      ).toBeGreaterThan(0);
    expect(html).not.toContain('/@vite/client');
  });
});
