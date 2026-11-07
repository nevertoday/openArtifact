# 部署到 Cloudflare

[English](deploy.md)

Open Artifact 由你自己 Cloudflare 账户里的三个 Worker 组成：**app**（网页、API、登录、D1 和 R2）、**usercontent**（提供 artifact 文件）和 **mcp**（给 agent 用的 MCP 服务器）。本指南把它们放在三个地址上，例如：

| Worker | 示例地址 |
|---|---|
| app | `https://artifact.example.com` |
| usercontent | `https://example-usercontent.com` |
| mcp | `https://mcp.artifact.example.com` |

**usercontent 必须和 app 在不同的站点上**：要用另一个可注册域名，不能是 app 域名下的子域名。artifact 页面是不受信任的 HTML，放在另一个站点上，它们永远读不到 app 的 cookie。

## 准备

- 一个 Cloudflare 账户，你的域名已接入。要给任意收件人发登录邮件，需要 Workers 付费计划。
- Node 22、pnpm 9，并执行过一次 `npx wrangler login`。
- 在仓库里执行过 `pnpm install`。

## 1. 创建数据库和文件存储

```sh
cd apps/app
npx wrangler d1 create open-artifact
npx wrangler r2 bucket create open-artifact-files
```

把第一条命令打印出的 `database_id` 填进 `apps/app/wrangler.jsonc`（`d1_databases[0].database_id`）。

## 2. 设置地址

在 `apps/app/wrangler.jsonc` 里设置 `vars`：

```jsonc
"vars": { "USERCONTENT_ORIGIN": "https://example-usercontent.com", "MCP_ORIGIN": "https://mcp.artifact.example.com" }
```

在 `apps/usercontent/wrangler.jsonc` 和 `apps/mcp/wrangler.jsonc` 里设置 `"APP_ORIGIN": "https://artifact.example.com"`。

给每个 Worker 绑定自定义域名，可以在控制台（Workers › 你的 Worker › Settings › Domains & Routes）里设置，也可以写在各自的 `wrangler.jsonc` 里：

```jsonc
"routes": [{ "pattern": "artifact.example.com", "custom_domain": true }]
```

## 3. 设置密钥

生成两个随机密钥（例如 `openssl rand -base64 32`）。签名密钥在 app 和 usercontent 里必须相同。

```sh
cd apps/app
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put USERCONTENT_SIGNING_KEY
npx wrangler secret put ALLOWED_EMAIL_DOMAINS   # 例如 example.com；不设置则只有第一个人能注册
npx wrangler secret put MAILER                  # cloudflare
npx wrangler secret put MAIL_FROM               # Open Artifact <noreply@artifact.example.com>

cd ../usercontent
npx wrangler secret put USERCONTENT_SIGNING_KEY  # 和 app 的值相同
```

可选的登录方式，都设在 app 上：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，以及公司单点登录 `OIDC_DISCOVERY_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_DISPLAY_NAME`。它们的回调地址分别是 `https://artifact.example.com/api/auth/callback/github`、`…/callback/google` 和 `…/api/auth/oauth2/callback/company-sso`。

## 4. 设置登录邮件

登录靠邮件里的链接。在 **Cloudflare Email Service** 里接入并验证发信域名，`MAIL_FROM` 的域名必须是这个域名。`EMAIL` 绑定已经写在 `apps/app/wrangler.jsonc` 里。Email Service 目前是公测。

## 5. 建表

```sh
cd apps/app
npx wrangler d1 migrations apply open-artifact --remote
```

每次升级后再执行一次；它只执行还没执行过的迁移。

## 6. 部署

先部署 app，因为另外两个通过服务绑定连到它：

```sh
cd apps/app && npx wrangler deploy
cd ../usercontent && npx wrangler deploy
cd ../mcp && npx wrangler deploy
```

## 7. 第一次登录

打开 app 的地址并登录。第一个人成为 workspace 管理员；`ALLOWED_EMAIL_DOMAINS` 里的域名的人作为成员加入，管理员也可以在 设置 里用邮件邀请别人。

检查是否全部通了：

- `https://artifact.example.com/health` 返回 `"status": "ok"`。
- 在 设置 › Agent 接入 里创建 token，把 agent 连到 `https://mcp.artifact.example.com/mcp`，发布一个页面，在查看页里能打开。

## 运营

- **谁能注册。** `ALLOWED_EMAIL_DOMAINS` 只放你自己的域名。管理员可以为整个 workspace 关闭公开链接，也可以下架任何 artifact。
- **公开链接上是别人发布的内容。** 作为运营者，你要对自己域名上提供的内容负责。遇到滥用，在 artifact 页面上下架；被删除的 artifact 30 天后由每日任务彻底清除（`apps/app/wrangler.jsonc` 里的 `triggers.crons`）。
- **升级。** 拉取代码，执行 `pnpm install`，执行数据库迁移（第 5 步），再重新部署三个 Worker（第 6 步）。
