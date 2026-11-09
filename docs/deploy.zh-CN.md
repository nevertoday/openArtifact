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
npx wrangler secret put ALLOWED_EMAIL_DOMAINS   # 例如 example.com，* 表示任意邮箱；不设置则只有第一个人能注册
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

打开 app 的地址并登录。每个登录的人都有一个个人工作区。要一起协作，在首页左上角的工作区菜单里新建工作区，再到 设置 › 成员 里用邮件或邀请链接邀请别人；永不过期的邀请链接适合贴在团队群或入职文档里。

检查是否全部通了：

- `https://artifact.example.com/health` 返回 `"status": "ok"`。
- 在 设置 › Agent 接入 里创建 token，把 agent 连到 `https://mcp.artifact.example.com/mcp`，发布一个页面，在查看页里能打开。

## 从 GitHub 部署

`.github/workflows/deploy.yml` 会跑检查、执行数据库迁移、部署三个 Worker。它只在你点 **Actions › Deploy › Run workflow** 时运行，不会自动触发。只需要设置一次：在 **Settings › Environments** 里建一个名为 `production` 的环境，填入：

- Secret `CLOUDFLARE_API_TOKEN`：你账户的 API token，需要 Workers Scripts、Workers Routes、D1 和 Workers Custom Domains 的编辑权限；
- 变量 `CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`、`APP_HOST`、`APP_ZONE`、`USERCONTENT_HOST`，需要发登录邮件时再加 `MAIL_FROM`；
- 可选的变量 `ALLOWED_EMAIL_DOMAINS`（仓库或环境变量都行），例如 `*` 表示任何人都能注册。设置后，部署会把它写进 app 的配置；不设置时 app 保持原样。如果你在第 3 步把它设成了 Worker 密钥，第一次带这个变量部署前，先在 `apps/app` 里运行 `npx wrangler secret delete ALLOWED_EMAIL_DOMAINS`，因为变量和密钥不能同名；
- 可选的变量 `ABUSE_REPORT_EMAIL`：接收公开页面举报的邮箱（见[滥用](#滥用)）。不设置时，举报只保存不发信。

在自己电脑上部署用同样两条命令：设好这些变量后运行 `pnpm deploy:config`，生成不进 git 的 `wrangler.production.jsonc`；再运行 `pnpm deploy:production`，执行迁移并部署。第 3 步设置的 Worker 密钥只需设置一次，之后每次部署都会保留。

## 运营

- **谁能注册。** `ALLOWED_EMAIL_DOMAINS` 决定谁能建账号；没有邀请，谁都进不了别人的工作区，所以设为 `*` 只是开放注册，不会让外人看到团队的工作区。管理员可以为自己的工作区关闭公开链接，也可以下架其中任何 artifact。
- **从没有个人工作区的版本升级。** 新账号不再自动加入第一个工作区。升级后，在 设置 › 成员 里生成一个永不过期的邀请链接发给同事。已有成员保留原来的工作区，下次访问时会多一个个人工作区。
- **公开链接上是别人发布的内容。** 作为运营者，你要对自己域名上提供的内容负责，见[滥用](#滥用)。被删除的 artifact 30 天后由每日任务彻底清除（`apps/app/wrangler.jsonc` 里的 `triggers.crons`）。
- **上限。** 每个工作区最多 1,000 个未删除的 artifact、1 GiB 文件和共享数据（删除的 artifact 在彻底清除前、或在「最近删除」里被永久删除前仍然算）。每个页面最多 2,000 条共享数据、5 MB。每个人 24 小时内最多发布 300 次，除个人工作区外最多创建 10 个工作区，删除的工作区在彻底清除前仍然算。数字定义在 `apps/app/src/api/publish-limits.ts` 和 `apps/app/src/api/workspace-api.ts`。发布次数、工作区数、共享数据和举报邮件的上限是精确的，因为都在写入的同一条语句里计数；工作区的 artifact 数和存储空间上限是近似的：同一时刻的几次发布各自看到的是彼此写入之前的用量，合起来可能略微超出。
- **没有登录的访客。** 在允许任何人写共享数据的公开链接上，同一个发起方网络每分钟最多改 60 次（`SHARED_DATA_WRITE_RATE_LIMITER`）。这个限制，和登录验证码、举报、公开链接密码的限制一样，把同一个 IPv6 /64 里的地址都算作一个发起方，因为一个用户通常拿到整个 /64。Cloudflare 在每个机房各自计数，所以这些限制只能让发起方慢下来，不能完全挡住。
- **升级。** 拉取代码，执行 `pnpm install`，执行数据库迁移（第 5 步），再重新部署三个 Worker（第 6 步）。
- **回滚。** 一旦有人离开或删除过工作区，就不要把 Worker 回滚到迁移 `0017_personal_workspaces.sql` 之前的版本：旧代码不认识 `left_at` 和 `deleted_at`，离开的人和删除的工作区会重新获得访问权，新账号也会重新加入第一个工作区。出了问题请修复后重新发布，不要回滚。

## 滥用

任何人通过公开链接打开页面，不论是否登录，都能点顶栏的 **举报**（Report），选择原因：垃圾内容或广告、钓鱼或恶意软件、违法内容、其他。举报存在 `abuse_reports` 表里，发起方的网络地址只以带密钥的哈希保存。同一个发起方每分钟最多举报 5 次（`REPORT_RATE_LIMITER`），同一个页面每天最多收 20 条举报。

设置了 `ABUSE_REPORT_EMAIL` 时，每条举报都通过 app 的邮件服务（`MAILER=cloudflare` 和 `MAIL_FROM`，第 4 步）发到这个地址。信的开头是下架这个页面的命令，然后是页面链接，举报人写的内容逐行加上 `> ` 引用，所以举报内容冒充不了命令。所有页面合计，24 小时内最多逐条发 50 封，所以没人能靠举报很多页面给你刷邮件。超出的举报照样保存，`mailed_at` 留空，每日任务会给你发一封汇总，告诉你有几条。没设置 `ABUSE_REPORT_EMAIL` 时，在 `apps/app` 里用 `npx wrangler d1 execute open-artifact --remote --config wrangler.production.jsonc --command "SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT 20"` 查看举报。

要下架一个页面，在这个部署的代码目录里运行（wrangler 已登录对应的 Cloudflare 账户，`apps/app/wrangler.production.jsonc` 已由 `pnpm deploy:config` 生成）：

```sh
pnpm takedown https://artifact.example.com/a/bank-login-k7f3q9x2m4ab --dry-run   # 只打印 SQL
pnpm takedown https://artifact.example.com/a/bank-login-k7f3q9x2m4ab            # 也可以只写短 id：k7f3q9x2m4ab
```

它用 `wrangler d1 execute open-artifact --remote` 以运营方的身份下架这个 artifact，并记进它所在工作区的管理日志。链接立即失效；作者和任何工作区管理员都不能恢复，每日任务会在 30 天后彻底清除它。wrangler 会打印改动的行数，0 表示没有这个短 id 的 artifact。30 天内要撤销下架，用 `wrangler d1 execute` 把这个 `short_id` 的 `removed_at`、`removed_by` 和 `removed_as_admin` 设回 `NULL`。

