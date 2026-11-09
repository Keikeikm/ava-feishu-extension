// The opdev SDK uses blockTypeID as the debug menu label. Keep its registration
// response intact and replace only the current plugin's localized display names.
module.exports = function pluginDisplayName(config) {
  const name = config.projectName?.trim() || 'AVA 数据洞察';
  return function (req, res, next) {
    if (req.method !== 'GET' || req.url.split('?')[0] !== '/api/block') return next();
    const send = res.send.bind(res);
    res.send = function (body) {
      if (body?.code === 0 && Array.isArray(body.data?.blocks)) {
        body = {
          ...body,
          data: {
            ...body.data,
            blocks: body.data.blocks.map((block) =>
              block.blockTypeID === config.blockTypeID
                ? {
                    ...block,
                    name: Object.fromEntries(
                      [
                        ...new Set(['zh-CN', 'en-US', 'ja-JP', ...Object.keys(block.name || {})]),
                      ].map((locale) => [locale, name]),
                    ),
                  }
                : block,
            ),
          },
        };
      }
      return send(body);
    };
    next();
  };
};
