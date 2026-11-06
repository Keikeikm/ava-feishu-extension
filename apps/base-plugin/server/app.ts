import express from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analysisRequest } from './validation';
import { JoinSelectionError, runAnalysis, type ModelConfig } from './analysis';

export function createApp(
  options: {
    model?: ModelConfig;
    token?: string;
    allowedOrigins?: string[];
    analyze?: typeof runAnalysis;
  } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const sameOrigin = origin === `${req.protocol}://${req.headers.host}`;
    const crossOrigin = !!origin && !sameOrigin;
    if (crossOrigin && !options.allowedOrigins?.includes(origin)) {
      res.status(403).json({ error: '插件来源不在服务白名单内，请配置 PLUGIN_ALLOWED_ORIGINS' });
      return;
    }
    if (crossOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      if (req.path !== '/status' && !options.token) {
        res
          .status(503)
          .json({ error: '飞书插件访问独立分析服务时，必须在服务端设置 PLUGIN_ACCESS_TOKEN' });
        return;
      }
    }
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/api/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ready: !!options.model,
      model: options.model?.model ?? null,
      authRequired: !!options.token,
    });
  });
  app.use('/api', (req, res, next) => {
    // Official table-view assets are hosted by Feishu. Only explicit origins may call the API.
    if (
      req.headers['sec-fetch-site'] === 'cross-site' &&
      !options.allowedOrigins?.includes(req.headers.origin ?? '')
    ) {
      res.status(403).json({ error: '请从插件页面发起请求' });
      return;
    }
    if (options.token) {
      const provided = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
      const expected = Buffer.from(options.token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.status(401).json({ error: '请在连接设置中填写正确的服务访问令牌' });
        return;
      }
    }
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 15,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: '请求较频繁，请稍后再试' },
    }),
  );
  app.use(express.json({ limit: '8mb' }));
  let active = 0;
  app.post('/api/analyze', async (req, res) => {
    const parsed = analysisRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? '请求格式无效' });
      return;
    }
    const { question, snapshot, mode, related } = parsed.data;
    if (mode === 'live' && !options.model) {
      res
        .status(503)
        .json({ error: '尚未配置模型，请在服务端设置 AVA_API_KEY 和 AVA_MODEL 后重启' });
      return;
    }
    if (mode === 'demo' && snapshot.source !== 'demo') {
      res.status(400).json({ error: '飞书数据需要使用模型分析模式' });
      return;
    }
    if (active >= 2) {
      res.status(429).json({ error: '分析服务正在忙，请稍后重试' });
      return;
    }
    active++;
    res.setHeader('Cache-Control', 'no-store');
    const timer = setTimeout(() => {
      if (!res.headersSent && !res.destroyed)
        res.status(504).json({ error: '分析超时，请缩小数据范围或简化问题后重试' });
    }, 120_000);
    try {
      const result = await (options.analyze ?? runAnalysis)(
        question,
        snapshot,
        mode,
        options.model,
        related,
      );
      if (!res.headersSent && !res.destroyed) res.json(result);
    } catch (error) {
      // Provider errors can contain credentials or raw table values. Do not expose or log them.
      const message =
        error instanceof JoinSelectionError ||
        (error instanceof Error && error.message.startsWith('演示模式支持'))
          ? error.message
          : '分析未完成，请检查模型配置与网络连接，或换一种提问方式。';
      if (!res.headersSent && !res.destroyed) res.status(422).json({ error: message });
    } finally {
      clearTimeout(timer);
      active--;
    }
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use(
    (
      error: { type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({
        error:
          error.type === 'entity.too.large' ? '数据超过 8MB，请减少字段或记录范围' : '请求格式无效',
      });
    },
  );
  return app;
}
