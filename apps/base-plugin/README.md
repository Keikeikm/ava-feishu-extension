# AVA 飞书数据表视图插件（开发版）

这是面向飞书 **数据表视图** 扩展的插件工程，配套独立的 AVA 分析服务。插件从飞书当前数据表读取数据，用户直接提问，查看结论、图表、计算结果及 SQL。

## 打开插件后怎么用

1. 打开飞书多维表格，在顶部视图栏切换到 **AVA 数据表视图**。本地调试时视图名可能显示为 `blk_…`。首次添加见[在飞书内调试](#四在飞书内调试)。看到「AVA 数据分析」、表名和记录数后，就可以确认当前分析的数据范围。
2. 若提示填写令牌，打开右上角「连接设置」，把分析服务 `.env` 中 `PLUGIN_ACCESS_TOKEN=` 后的值填到「服务访问令牌」，点击「应用设置」。令牌只在本次页面会话中有效。模型密钥 `AVA_API_KEY` 由维护者在服务端配置。
3. 点击「数据范围」选择这份多维表格内的一张数据表。在「记录范围」选择「全部记录」或一个源视图，再点击「加载数据快照」。选择源视图时会沿用它的筛选条件和可见字段。用「选择字段」勾选分析所需的列，再用「数据预览」核对。
4. 在「向数据表提问」里输入问题，按 Enter 或点击发送。比如选中「类别」和「金额」后，可以问「按类别汇总金额，从高到低排列，画柱状图」。每次提问独立执行，下一题需要写明要用的字段、时间范围或分组条件。
5. 结果区先给出「分析发现」。用「可视化图表」查看生成的图，用「计算结果」核对数值，用「查询依据」查看 SQL。结果可下载为 CSV，也可通过「导出报告」下载 Markdown。

「保存视图设置」会保存所选表、源视图和字段，方便下次打开。原表更新后，点击「刷新数据」重新读取。刷新会清空当前分析结果，并重新选中当前范围内的全部可分析字段，提问前可再次调整字段。切换数据范围或字段也会清空分析历史。

插件每次分析一张表。切换数据表可以逐张分析；目前一次问题无法同时读取多张表或执行跨表关联。提交时，所选字段的数据会发送到 AVA 分析服务。单次请求上限为 10,000 条记录、80 个字段和 8 MB。

## 插件类型与目录

按用户提供的[飞书数据表视图开发指南](https://open.feishu.cn/document/base-extensions/base-table-view-extension-development-guide)接入：

- 宿主 SDK：`@lark-opdev/block-bitable-api`，用于数据表视图运行时；已移除边栏插件 SDK。
- 构建工具：Webpack + 官方 `@lark-opdev/block-bitable-webpack-utils`。
- 发布工具：`@lark-opdev/cli`，通过 `opdev upload` 上传编译产物。
- 安装入口：飞书数据表的“新建视图 / 更多插件”，完成应用发布后添加该视图。

```text
app.json                    飞书 App ID
plugin/
  block.json                数据表视图 BlockTypeID、项目名、调试表链接
  runtime.config.json       AVA 分析服务 origin，不含任何密钥
  webpack.config.cjs        官方插件构建与调试中间件
  dist/                     官方构建产物：index.html、JS、插件清单
src/plugin.tsx              正式数据表视图入口，启动时读取宿主数据
src/main.tsx                独立页面预览入口，不用于飞书安装
src/lib/feishu.ts           官方视图 SDK、分页读取、视图设置保存
server/                     AVA / DuckDB 分析、鉴权、来源白名单
scripts/                    应用绑定与上传前检查
```

首次打开时默认读取宿主当前数据表，已有视图设置时会尝试恢复。插件通过飞书 SDK 读取记录，分析结果展示在插件视图中。

## 一、创建飞书插件应用

1. 登录飞书开放平台，创建企业自建应用。面向其他企业分发时需按飞书要求创建商店应用。
2. 在“添加应用能力”中选择“多维表格插件 → 数据表视图”。记录真实 **App ID** 和该能力的 **BlockTypeID**。不要选择边栏或记录视图。
3. 按官方指南配置用户身份权限 `bitable:app` / `bitable:app:readonly`，具体权限的生效受租户审核规则约束。
4. 将部署的 AVA 服务域名加入插件的服务器域名白名单。
5. 准备一个用于调试的飞书多维表格链接。

这些信息不能由本地代码替代。仓库没有生成虚构 App ID，也未自动创建、发布任何飞书应用。

## 二、安装依赖与绑定

需要 Node.js ≥ 22.13，建议 Node.js 22。先在 monorepo 根目录安装依赖并编译共享核心，再进入插件目录；以下插件命令均在 `apps/base-plugin` 中执行。

```sh
nvm use
npm ci
npm run build:core
cd apps/base-plugin
test -f .env || cp .env.example .env

npm run plugin:configure -- \
  --app-id cli_你的真实AppID \
  --block-type-id blk_你的真实BlockTypeID \
  --base-url 'https://你的租户.feishu.cn/base/你的表格token' \
  --api-origin 'http://127.0.0.1:3001'
```

绑定脚本写入 `app.json`、`plugin/block.json` 和 `plugin/runtime.config.json`，不需要 App Secret。`--api-origin` 是服务的 origin，不包含 `/api` 或 `/chat/completions`。

## 三、配置 AVA 服务

服务端 `.env`：

```dotenv
HOST=127.0.0.1
PORT=3001
AVA_API_KEY=模型密钥
AVA_MODEL=模型名称
AVA_BASE_URL=https://兼容供应商地址/v1
PLUGIN_ACCESS_TOKEN=自行生成的长随机令牌
PLUGIN_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

模型使用 OpenAI 兼容的 Chat Completions 协议。`AVA_BASE_URL` 可省略，填写时不包含 `/chat/completions`。密钥仅保存在服务器。

**正式插件资源由飞书托管，API 不与插件同源。** 服务地址通过 `plugin/runtime.config.json` 编译进插件；API 采用明确的 origin 白名单并支持带 Authorization 的 CORS 预检。跨域分析必须设置服务访问令牌，在插件右上角“连接设置”输入同一令牌。该令牌仅保存在页面会话中，不编译进插件包。

生产部署时：

- `apiOrigin` 使用可访问的 HTTPS 服务地址，改动后重新构建插件。
- 飞书开放平台配置该分析服务的服务器域名白名单。
- `PLUGIN_ALLOWED_ORIGINS` 填插件运行时实际页面的 origin，可在该插件 frame 的开发者工具中查看 `location.origin`。不要用任意通配来源，也不要把多维表格顶层页面的来源直接当作插件 frame 来源。
- 浏览器会同时校验飞书的域名配置、服务端 CORS 与服务令牌；只有服务端配置齐全不代表真实连通已经验收。

## 四、在飞书内调试

```sh
npx opdev login
# 按 CLI 提示选择 Feishu 并完成登录
npm run dev
```

`npm run dev` 启动分析服务和官方 Webpack 调试服务。配置未绑定时会显示缺少的配置。官方调试工具会打开 `plugin/block.json` 中的测试表，并在链接里加上 `debugPort`。也可以打开 `http://localhost:8080/`，点击「打开飞书调试表」。

如果 `8080` 已被占用，用 `FEISHU_DEBUG_PORT=8081 npm run dev` 启动，并将 `http://localhost:8081` 和 `http://127.0.0.1:8081` 加入 `.env` 的 `PLUGIN_ALLOWED_ORIGINS`。插件的分析服务地址仍使用 `http://127.0.0.1:3001`。

首次添加时，点击测试表顶部视图标签右边的 `＋`，在「更多插件」中选择本地 AVA 数据表视图并添加。调试项可能显示为 `blk_…`，可用 `plugin/block.json` 中的 `blockTypeID` 核对。

已经添加过本地视图时，保留 `debugPort` 并刷新整个飞书页面，然后打开已有视图。看到表名和记录数后，按[打开插件后怎么用](#打开插件后怎么用)连接服务并提问。

能看到表名和记录数、却提示「分析服务未连接」时，检查本地分析服务是否正在运行、端口是否和 `plugin/runtime.config.json` 一致，以及 `PLUGIN_ALLOWED_ORIGINS` 是否包含插件页面的来源。提示「尚未配置模型」时，补齐服务端模型配置后重启服务，并刷新飞书页面。

## 五、构建、上传与发布

如果应用和视图已绑定，上传前只需把本机分析地址改成已部署的 HTTPS 地址。将示例域名替换为你的服务域名。已有的 App ID、BlockTypeID 和测试表链接会保留。

```sh
curl --fail-with-body https://ava.example.com/api/status
npm run plugin:configure -- --api-origin https://ava.example.com
```

`/api/status` 应返回 `ready: true` 和 `authRequired: true`。飞书后台的服务器域名白名单填写分析服务的域名。服务端的 `PLUGIN_ALLOWED_ORIGINS` 填写实际插件页面的来源。继续在飞书内做本机调试时，可以保留 `http://127.0.0.1:3001` 并运行 `npm run dev`。

```sh
npm run build
# 单独构建插件：npm run build:plugin
npm run plugin:upload
```

正式插件包位于 `plugin/dist/`，由官方构建插件生成 `project.config.json`、`index.json`（`blockRenderType: offlineWeb`）、HTML 和 JS。

编译允许空的应用标识，以便 CI 检查工程；**调试和上传会拒绝空标识**。上传还要求 HTTPS 分析服务地址。无真实应用、登录态和对应能力时，构建产物不能直接安装到飞书。

上传后，根据飞书指南在“数据表视图”能力中选择对应插件版本，填写图标、名称和说明，创建应用版本并提交审核。审核通过且处于可用范围内的用户才能安装。项目未执行真实上传或发布。

AVA 服务独立部署：

```sh
npm start
# 默认回环地址；对外监听需 HOST=0.0.0.0 并设置 PLUGIN_ACCESS_TOKEN
```

也提供 `Dockerfile`。容器只运行分析服务及独立预览页面，不能替代上传至飞书的插件包；Docker 文件尚未实际构建验证。HTTPS 反向代理的正文上限需至少 8MB，请求超时至少 125 秒。

## 独立预览（不是安装入口）

```sh
npm run dev:preview
```

打开 [本地预览](http://127.0.0.1:5173)。它使用 72 条虚构销售记录；无模型时仅支持 4 个预设问题，通过 AVA / DuckDB 真实汇总，并用模板输出结论。该入口不生成飞书宿主，不用于证明插件集成成功。

![独立预览界面](docs/workspace.png)

## 分析能力与数据边界

- 自然语言 → AVA 生成 SQL → DuckDB 只读执行 → 中文总结 → AVA 推荐图表。
- 常见单系列图表本地渲染；复杂图表用隔离的 AVA HTML 渲染器，需要访问 `unpkg.com`，须考虑插件运行时网络策略。
- 可查看计算结果与 SQL，导出 CSV 和 Markdown 报告。问题逐条独立执行，不自动传递聊天历史。
- 只读原表，源数据变更后需手动刷新。刷新、切换数据源或字段后清空本次分析历史。
- 所选表合计最多 10,000 条源记录，每表最多 80 个字段，请求最多 8 MB；超过限制直接拒绝，不用截断的源数据分析。计算结果最多返回 1,000 条，达到 AVA 截断限制时提示。
- 服务同时最多 2 个分析；单次 SQL 限时 15 秒、内存 256MB、1 个线程。模型调用共享约 110 秒期限，HTTP 响应限时 120 秒。
- 分析记录使用权限受限的独立临时目录，完成后删除。模型会接收问题、字段结构和查询结果，结果可能包含原始明细。模型供应商的数据保留策略由所选服务决定。
- 日期转为 ISO，保留数值、零、布尔和空值；复杂字段提取可读文字，无法可靠表示的值为空；附件不参与分析。
- 服务令牌适用于内部自托管，多租户运营需要额外实现用户身份、租户隔离与用户级限额。

## 跨表分析

在飞书视图内载入主表后，点击「添加关联表」，选择同一份 Base 中另一张表及它的源视图。随后勾选两张表要分析的字段，选定主表关联键和关联表唯一键。例如用订单的「客户号」连接客户的「编号」，然后提问「按客户地区汇总订单金额」。

两边的关联字段需类型相同。关联表重复键和零匹配会被拒绝；分析结果会显示主表的匹配率和两张表的空键数。空白键不匹配，文本编号 `001` 和 `1` 不会合并。插件只提交所选视图中可见且已勾选的字段。关联表和关联键在本次会话中有效；保存视图设置会保留主表配置。

插件和[机器人](../bot/README.md)通过不同权限读取飞书数据，再用同一个 [分析核心](../../packages/analysis-core/src/index.ts) 创建 AVA 引擎、执行分析和装载多张表。

## 验证与未完成项

```sh
npm run check             # 类型检查、官方插件包、预览构建、数据与服务测试
npx playwright install chromium
npm run test:e2e          # 独立预览流程与正式构建在宿主外的错误状态
npm run format:check
```

测试覆盖真实 AVA / DuckDB 查询、飞书 SDK 的模拟分页及视图配置、服务端 CORS 和鉴权、官方打包清单、本机模型协议夹具，以及浏览器中的图表和导出。真实飞书宿主的 SDK 握手、权限审批、发布安装及真实模型输出仍待联调，不能由这些测试替代。

官方 `opdev` 开发工具链含有旧的传递依赖；以 `npm audit` 当前输出为准。它仅用于本地调试和发布，不作为分析服务运行入口，不应将调试服务器暴露到公网。
