# Open Artifact

[English](README.md)

任何 AI agent 都能把 HTML 页面（artifact）发布上来，整个团队打开、评论、使用，不需要 Claude 账户。所有服务都跑在你自己的 Cloudflare 账户里。

- **任何 agent 都能发布。** Claude Code、Codex、Cursor 或其他 agent，通过 MCP 或普通的 HTTP API。
- **直接在页面上评论。** 评论可以钉在页面的某个位置或选中的一段文字上，未处理的评论一键复制给 agent。
- **版本、分享和公开链接。** 私有、指定的人、整个 workspace，或者带有效期和可选密码的公开链接。
- **个人主页。** 作者可以把公开的 artifact 列在 `/@名字` 上；只有这些页面带分享卡片、允许搜索引擎收录。

界面目前只有中文。

> **许可证。** Open Artifact 以 [PolyForm Noncommercial License 1.0.0](LICENSE) 公开源码，非商业用途免费。商业用途需要另外取得授权，包括公司部署给自己的员工使用：https://ui.xiaoxiaodong.ai/license

## 在本地运行

需要 Node 22 和 pnpm 9。

```sh
pnpm install
pnpm dev:setup   # 把本地密钥写进 .dev.vars，并执行 D1 数据库迁移
pnpm dev         # usercontent :8789，app :8787，MCP :8788
```

打开 http://localhost:8787 ，用 `@example.com` 结尾的邮箱登录（本地配置允许这个域名，可以在 `apps/app/.dev.vars` 里改 `ALLOWED_EMAIL_DOMAINS`）。本地不发真实邮件，登录链接打印在运行 `pnpm dev` 的终端里（找 `[mail]`）。第一个登录的人成为 workspace 管理员，之后登录的人作为成员加入。

按 Ctrl-C 停止。如果之后端口仍被占用，运行 `pkill -f workerd`。

## 接入 agent

1. 在应用里打开 设置 › Agent 接入，创建一个个人 API token。
2. 按页面上的提示添加 MCP 服务器，例如 Claude Code：

   ```sh
   claude mcp add --transport http open-artifact http://localhost:8788/mcp --header "Authorization: Bearer oa_pat_…"
   ```

3. 让 agent 发布点什么。不支持 MCP 的 agent 可以用 http://localhost:8787/llms.txt 里说明的 HTTP API。

## 检查

```sh
pnpm run check   # 存储边界检查、类型检查、全部测试（Workers 运行时，本地 D1 和 R2）
```

## 目录

| 路径 | 内容 |
|---|---|
| `packages/core` | 领域类型、仓储接口、访问规则（`ArtifactAccess`）、token 和签名 |
| `packages/storage-cloudflare` | D1 和 R2 的仓储实现与数据库迁移；只有这里的代码能碰 D1 和 R2 |
| `apps/app` | 网页、HTTP API、登录（Better Auth）、查看页的 postMessage 代理 |
| `apps/usercontent` | 在独立的域名上用签名网址提供 artifact 文件，并注入页面 SDK；通过 app 的 `ArtifactFileReader` RPC 入口读文件，自身没有存储绑定 |
| `apps/mcp` | 远程 MCP 服务器；每个工具都是用 agent 的 token 调用一次 app 的 HTTP API |

## 配置

| 变量 | Worker | 用途 |
|---|---|---|
| `BETTER_AUTH_SECRET` | app | 登录会话签名 |
| `ALLOWED_EMAIL_DOMAINS` | app | 允许注册的邮箱域名，用逗号分隔。不设置时只有第一个人（创建者）能注册 |
| `MAILER` | app | `console`：把邮件打印到日志，用于本地开发。`cloudflare`：通过 `EMAIL` 绑定用 Cloudflare Email Service 发信。不设置时，登录邮件会直接报错，而不是把链接泄露到日志里。其他值，或设成 `cloudflare` 却缺少 `EMAIL` 或 `MAIL_FROM`，每个请求都会报配置错误 |
| `MAIL_FROM` | app | `MAILER=cloudflare` 时的发件人，比如 `Open Artifact <noreply@example.com>`。域名必须已在 Cloudflare Email Service 接入并验证。给任意收件人发信需要 Workers 付费计划，该服务目前是公测 |
| `USERCONTENT_SIGNING_KEY` | app、usercontent | 两边必须相同；用来签名 artifact 文件的网址 |
| `USERCONTENT_ORIGIN`、`MCP_ORIGIN` | app | 另外两个 Worker 的公网地址 |
| `APP_ORIGIN` | usercontent、mcp | app 的公网地址 |
| `GITHUB_CLIENT_ID` / `_SECRET`、`GOOGLE_CLIENT_ID` / `_SECRET` | app | 可选的登录方式 |
| `OIDC_DISCOVERY_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_DISPLAY_NAME` | app | 可选的公司单点登录 |

除了变量，还需要这些绑定：app 需要 `DB`（D1）、`FILES`（R2）、`UNLOCK_RATE_LIMITER`（公开链接密码的频率限制），`MAILER=cloudflare` 时还需要 `EMAIL`（`send_email`，Cloudflare Email Service）；usercontent 需要指向 app 的 `ARTIFACT_FILES` 服务绑定；MCP 需要指向 app 的 `APP` 服务绑定。

usercontent Worker 必须和 app 放在不同的站点上（生产环境要用另一个域名，只换端口不够），这样 artifact 页面永远读不到 app 的 cookie。

## 部署

部署到你自己 Cloudflare 账户的完整步骤：[docs/deploy.zh-CN.md](docs/deploy.zh-CN.md)。

## 安全

发现漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 参与

欢迎提 issue 和建议。目前不接受代码贡献，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE)。`apps/app/public/static/vendor/xxd` 里内置的 UI Kit 使用同一许可证。商业授权：https://ui.xiaoxiaodong.ai/license
