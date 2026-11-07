// Credentials stay in this Node process; the browser only calls the local debug origin.
module.exports = function developmentProxy(target, token, port) {
  // opdev owns /api/block and /api/meta. They must remain reachable by the Feishu host.
  const analysisPaths = new Set(['/api/status', '/api/connection', '/api/analyze']);
  const isAnalysisRequest = (path) => analysisPaths.has(path.split('?')[0]);
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return {
    guard(req, res, next) {
      if (!isAnalysisRequest(req.url)) return next();
      const origin = req.headers.origin;
      const crossSite = req.headers['sec-fetch-site'] === 'cross-site';
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (
        !hosts.has(req.headers.host) ||
        crossSite ||
        (origin && !origins.has(origin)) ||
        (unsafe && !origin)
      ) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '请从本次启动的本地飞书调试视图访问分析服务。' }));
        return;
      }
      next();
    },
    proxy: {
      context: isAnalysisRequest,
      target,
      changeOrigin: false,
      onProxyReq(proxyReq) {
        proxyReq.setHeader('Authorization', `Bearer ${token}`);
      },
      onError(_error, _req, res) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '本地分析服务未就绪，请查看启动终端。' }));
      },
    },
  };
};
