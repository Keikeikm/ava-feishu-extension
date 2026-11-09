# 用飞书 CLI 诊断读表权限

从仓库根目录执行命令。先安装最新版[官方 lark-cli](https://github.com/larksuite/cli)，运行 `lark-cli config init`，选择配置现有应用并输入对应凭据。使用独立命名配置时，传 `--profile <名称>`。脚本会核对 CLI 的 App ID 和项目配置。

## 机器人

```sh
npm run doctor:bot -- --url '<Base 链接>' --profile ava-bot
```

将 `ava-bot` 替换为实际的 profile，或省略 `--profile` 使用当前配置。机器人 App ID 取自 `FEISHU_APP_ID` 或 `apps/bot/.env`。命令以应用身份试读最多一条记录，仅显示诊断结果。链接带 `table=tbl…` 时试读指定表，否则试读首张可访问的表。用带 `table` 的链接分别检查有高级权限限制的子表。

缺少 API 权限时，按[机器人配置](../../apps/bot/README.md#3-在聊天中使用)开通相应应用权限并发布。遇到资源权限拒绝时，可以预览给同一个机器人添加 Base 可阅读权限：

```sh
npm run doctor:bot -- --url '<Base 链接>' --profile ava-bot --grant
```

确认输出中的 Base 和机器人身份后，由有管理权限的人用该 profile 完成用户 OAuth 登录，再执行授权。授权用户需拥有添加协作者所需的 API 和文档权限。

```sh
npm run doctor:bot -- --url '<Base 链接>' --profile ava-bot --grant --apply
```

脚本通过 [`drive +member-add`](https://github.com/larksuite/cli/blob/main/skills/lark-drive/references/lark-drive-member-add.md) 添加可阅读权限，并切回机器人身份复查。高级权限可能还需在飞书中配置到目标数据表。遇到知识库节点权限问题，先开通节点访问，或使用原始 `/base/` 链接诊断。

## 多维表格插件

启动 `npm run dev:plugin` 后检查任意目标表格：

```sh
npm run doctor:plugin -- --url '<Base 链接>'
npm run doctor:plugin -- --url '<Base 链接>' --profile ava-plugin
```

第一条打印调试链接并检查本地插件注册。第二条额外用已完成 OAuth 的 CLI 用户测试 OpenAPI 读权限。使用插件 App ID 对应的 profile，并以同一飞书账号登录浏览器和 CLI。插件宿主内的最终权限，以在目标表格中打开 AVA 并读取数据为准。
