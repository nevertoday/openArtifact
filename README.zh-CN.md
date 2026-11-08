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

打开 http://localhost:8787 ，用 `@example.com` 结尾的邮箱登录（本地配置允许这个域名，可以在 `apps/app/.dev.vars` 里改 `ALLOWED_EMAIL_DOMAINS`）。本地不发真实邮件，登录验证码打印在运行 `pnpm dev` 的终端里（找 `[mail]`）。第一个登录的人成为 workspace 管理员，之后登录的人作为成员加入。

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
| `MAILER` | app | `console`：把邮件打印到日志，用于本地开发。`cloudflare`：通过 `EMAIL` 绑定用 Cloudflare Email Service 发信。不设置时，登录邮件会直接报错，而不是把验证码泄露到日志里。其他值，或设成 `cloudflare` 却缺少 `EMAIL` 或 `MAIL_FROM`，每个请求都会报配置错误 |
| `MAIL_FROM` | app | `MAILER=cloudflare` 时的发件人，比如 `Open Artifact <noreply@example.com>`。域名必须已在 Cloudflare Email Service 接入并验证。给任意收件人发信需要 Workers 付费计划，该服务目前是公测 |
| `USERCONTENT_SIGNING_KEY` | app、usercontent | 两边必须相同；用来签名 artifact 文件的网址 |
| `USERCONTENT_ORIGIN`、`MCP_ORIGIN` | app | 另外两个 Worker 的公网地址 |
| `APP_ORIGIN` | usercontent、mcp | app 的公网地址 |
| `GITHUB_CLIENT_ID` / `_SECRET`、`GOOGLE_CLIENT_ID` / `_SECRET` | app | 可选的登录方式；同一个平台的两个值都设置后，登录页才出现对应按钮。见[用 GitHub 或 Google 登录](#用-github-或-google-登录) |
| `OIDC_DISCOVERY_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_DISPLAY_NAME` | app | 可选的公司单点登录 |
| `DEFAULT_LOCALE` | app | 用户和浏览器都没指定语言时的界面语言：`zh-CN`（默认）或 `en` |

除了变量，还需要这些绑定：app 需要 `DB`（D1）、`FILES`（R2）、`UNLOCK_RATE_LIMITER`（公开链接密码的频率限制）、`SIGN_IN_EMAIL_RATE_LIMITER` 和 `SIGN_IN_ADDRESS_RATE_LIMITER`（每个收件地址、每个发起方请求登录验证码的频率限制），`MAILER=cloudflare` 时还需要 `EMAIL`（`send_email`，Cloudflare Email Service）；usercontent 需要指向 app 的 `ARTIFACT_FILES` 服务绑定；MCP 需要指向 app 的 `APP` 服务绑定。

### 用 GitHub 或 Google 登录

每个平台建一个 OAuth 应用，回调地址填 app 自己的地址：

| 平台 | 在哪建 | 回调地址 |
|---|---|---|
| GitHub | Settings › Developer settings › OAuth Apps › New OAuth App | `https://<app>/api/auth/callback/github` |
| Google | Google Cloud Console › APIs & Services › Credentials › Create OAuth client ID（类型选 Web application） | `https://<app>/api/auth/callback/google` |

然后在 `apps/app` 下用 `wrangler secret put GITHUB_CLIENT_ID` 设置密钥，`GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 同理，不用重新部署。本地开发另建一组应用，回调地址是 `http://localhost:8787/api/auth/callback/<平台>`，把值写进 `apps/app/.dev.vars`。Google 应用处于“测试”状态时，只有测试名单里的账号能登录，正式开放前要在 OAuth consent screen 里发布。先用验证码登录过的人，之后用邮箱相同且已验证的 GitHub 或 Google 账号登录，会进入同一个账号。

usercontent Worker 必须和 app 放在不同的站点上（生产环境要用另一个域名，只换端口不够），这样 artifact 页面永远读不到 app 的 cookie。

## 语言

界面支持中文和英文。用户在语言切换里的选择优先，并且跟着账户走，换浏览器、收邮件都一样；没选过时按浏览器的 `Accept-Language`，再按 `DEFAULT_LOCALE`。artifact、评论和人名按原样显示。

文案在 `apps/app/public/static/i18n`，每个区域、每种语言一个文件，Worker 和页面脚本共用。`zh-CN` 是基准：其他语言少 key、多 key 或参数不一致时 `pnpm typecheck` 会失败。词典之外的代码里写了中文，`pnpm check` 也会失败（`scripts/check-no-hardcoded-cjk.mjs`）。新增一种语言：在 `packages/core/src/locale.ts` 的 `LOCALES` 里加上它，按它的代码复制 `en.js` 和 `en/` 目录并翻译，再在 `apps/app/src/i18n/messages.ts` 和 `apps/usercontent/src/i18n` 的 SDK 词典里登记。

## 部署

部署到你自己 Cloudflare 账户的完整步骤：[docs/deploy.zh-CN.md](docs/deploy.zh-CN.md)。

## 安全

发现漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 参与

欢迎提 issue 和建议。目前不接受代码贡献，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE)。`apps/app/public/static/vendor/xxd` 里内置的 UI Kit 使用同一许可证。商业授权：https://ui.xiaoxiaodong.ai/license
