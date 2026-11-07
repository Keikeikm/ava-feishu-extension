[项目首页](../../README.md) / 飞书视图插件

# 在多维表格中分析数据

选择数据范围与字段，用中文提问，查看图表、计算结果和 SQL，并导出 CSV 或 Markdown 报告。

![分析结果：中文结论、趋势图和查询依据](docs/analysis.png)

_独立预览的演示结果；飞书内以数据表视图运行。_

## 1. 配置分析服务

先完成[根目录安装](../../README.md#先体验)。**以下命令均在仓库根目录执行。**

```sh
cp apps/base-plugin/.env.example apps/base-plugin/.env
```

编辑 `apps/base-plugin/.env`：

| 变量                       | 填写内容                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| `AVA_API_KEY`、`AVA_MODEL` | 模型密钥与名称，自由提问必填                                         |
| `AVA_BASE_URL`             | 可选的 OpenAI 兼容接口地址，不含 `/chat/completions`                 |
| `PLUGIN_ACCESS_TOKEN`      | 自行设置的服务令牌，飞书跨域访问和对外监听时必填                     |
| `PLUGIN_ALLOWED_ORIGINS`   | 插件 **frame 的实际 origin**，多个值用逗号分隔；本地默认含 8080 端口 |

模型密钥留在服务端；用户只需在插件右上角「连接设置」填写服务令牌。

## 2. 绑定飞书并调试

在[飞书开放平台](https://open.feishu.cn/app)创建应用，添加「多维表格插件 → 数据表视图」能力，取得 **App ID、BlockTypeID**，并准备测试表链接。权限配置参照[数据表视图开发指南](https://open.feishu.cn/document/base-extensions/base-table-view-extension-development-guide)。

```sh
npm run plugin:configure -w @ava/base-plugin -- \
  --app-id cli_你的AppID \
  --block-type-id blk_你的BlockTypeID \
  --base-url 'https://你的租户.feishu.cn/base/你的表格token' \
  --api-origin http://127.0.0.1:3001

npm exec -w @ava/base-plugin -- opdev login
npm run dev:plugin
```

绑定信息写入本模块的 `app.json`、`plugin/block.json` 和 `plugin/runtime.config.json`。调试服务默认使用 **8080** 端口，分析 API 使用 **3001**。在打开的测试表中，通过「＋ → 更多插件」添加本地 AVA 视图。

## 3. 选择数据并提问

1. **确认范围**：用「数据范围」选择主表及源视图；用「选择字段」勾选要分析的列。
2. **需要跨表时**：点击「添加关联表」，选择另一张表及源视图，再指定两侧关联字段。例如订单的「客户号」关联客户的「编号」。
3. **提问并核对**：如「按客户地区汇总订单金额」。查看图表、结果及 SQL，按需导出。

关联字段需类型相同，关联表的键值需唯一；重复键或零匹配会被拒绝，结果中会显示匹配率。隐藏字段和未勾选字段不会提交给分析服务。

原表更新后点击「刷新数据」。主表配置可保存；关联表与关联键仅用于本次会话。每次提问独立分析，需写明完整问题。

## 4. 部署与发布

**分析 API 与飞书视图包分别部署。** 先准备可访问的 HTTPS API，配置飞书的服务器域名白名单，以及服务端的插件 origin 和令牌。

在服务器上构建并启动分析服务；对外监听时在 `.env` 中设置 `HOST=0.0.0.0` 和服务令牌：

```sh
npm run build:plugin
npm start -w @ava/base-plugin
```

保持服务运行，在本地发布终端将生产 API 地址写入视图包，再上传：

```sh
npm run plugin:configure -w @ava/base-plugin -- --api-origin https://ava.example.com
npm run plugin:upload -w @ava/base-plugin
```

将示例域名替换为真实地址。上传后，在飞书开放平台选择插件版本并完成应用发布。视图包输出到 `apps/base-plugin/plugin/dist/`。

分析服务也可用 Docker 运行：

```sh
docker build -f apps/base-plugin/Dockerfile -t ava-base-plugin .
docker run --rm --env-file apps/base-plugin/.env \
  -e HOST=0.0.0.0 -p 3001:3001 ava-base-plugin
```

**范围限制**：所选表合计最多 10,000 条记录，每表 80 个字段，请求 8 MB；计算结果最多返回 1,000 条。源数据超限会拒绝，结果截断会提示。反向代理应支持至少 8 MB 正文和 125 秒请求时限。
