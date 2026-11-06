# AVA 飞书扩展

飞书多维表格视图插件与聊天机器人共用一个 npm workspaces 仓库。两个应用可以独立构建和部署。

| 目录 | 职责 |
| --- | --- |
| [apps/base-plugin](apps/base-plugin/README.md) | 飞书数据表视图、视图 SDK 读表、浏览器预览和独立分析 API |
| [apps/bot](apps/bot/README.md) | 飞书消息、文件与 Base 读取、会话、训练和回复 |
| [packages/analysis-core](packages/analysis-core/src/index.ts) | AVA 初始化、分析约束、结果和图表类型、具名快照装载及关联键检查 |

插件按请求创建引擎并清理临时快照。机器人在自己的 worker 中保留数据和追问上下文。飞书权限、凭证和读表方式由应用各自管理；共享核心接收已经获准读取的数据。

## 开发

需要 Node.js 22.13+（22.x）和 npm 10+。在仓库根目录运行：

```sh
nvm use
npm ci
npm run check
npm run build
npm test
npm run test:e2e
```

首次运行浏览器测试前，执行 `npm exec -w @ava/base-plugin -- playwright install chromium`。浏览器测试默认使用本机 3001 和 5173 端口；如有占用，可用 `PORT=13001 AVA_PREVIEW_PORT=15173 npm run test:e2e`。要运行机器人的训练测试，在 `apps/bot` 下创建 `.venv` 并安装 `ml/requirements.txt`，或将 `ML_PYTHON` 指向已装依赖的 Python。其他测试不需要飞书或模型密钥。

- **插件预览**：运行 `npm run dev:preview`，打开 [本机预览](http://127.0.0.1:5173)。无模型时可用内置演示数据。
- **飞书视图**：将 `apps/base-plugin/.env.example` 复制为同目录的 `.env`。按[插件指南](apps/base-plugin/README.md)设置 `AVA_*`、绑定 App ID、BlockTypeID 和测试表，随后在根目录运行 `npm run dev:plugin`。
- **机器人**：将 `apps/bot/.env.example` 复制为同目录的 `.env`，填写 `FEISHU_*` 和 `LLM_*`，随后在根目录运行 `npm run dev:bot`。权限和事件配置见[机器人指南](apps/bot/README.md)。

## 独立构建与部署

在仓库根目录执行相应命令：

| 目标 | 构建 | 启动或发布 |
| --- | --- | --- |
| 机器人 | `npm run build:bot` | `npm start -w @ava/bot` |
| 插件分析 API 与独立预览 | `npm run build:plugin` | `npm start -w @ava/base-plugin` |
| 飞书数据表视图包 | `npm run build:plugin` | 产物在 `apps/base-plugin/plugin/dist`；完成飞书绑定后运行 `npm run plugin:upload -w @ava/base-plugin` |

Docker 构建上下文为仓库根目录，两个镜像分别安装所需的 workspace 依赖：

```sh
docker compose -f apps/bot/compose.yaml up -d --build
docker build -f apps/base-plugin/Dockerfile -t ava-base-plugin .
docker run --rm --env-file apps/base-plugin/.env -e HOST=0.0.0.0 -p 3001:3001 ava-base-plugin
```

容器中的插件 API 对外监听时必须配置 `PLUGIN_ACCESS_TOKEN`；飞书托管的视图还需要生产 API 地址和 origin 白名单。上传视图包与部署 API 是独立步骤。

## 迁移来源

- 机器人：[ava-feishu-bot @ 6b65984](https://github.com/Keikeikm/ava-feishu-bot/commit/6b65984bf89a47b28dfe580212642f7bcace691a)
- 插件：[ava-feishu-plugin @ 7415bfb](https://github.com/Keikeikm/ava-feishu-plugin/commit/7415bfb91260053143e93bb73f1c677e04d8fa84)

初始导入使用这两个 GitHub 默认分支的已提交快照，原始提交历史保留在各自仓库。两个应用的环境文件和运行数据不随代码迁移。
