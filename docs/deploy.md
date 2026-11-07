# Deploy to Cloudflare

[中文](deploy.zh-CN.md)

Open Artifact is three Workers on your own Cloudflare account: **app** (pages, API, sign-in, D1 and R2), **usercontent** (serves artifact files) and **mcp** (the MCP server for agents). This guide puts them on three addresses, for example:

| Worker | Example address |
|---|---|
| app | `https://artifact.example.com` |
| usercontent | `https://example-usercontent.com` |
| mcp | `https://mcp.artifact.example.com` |

**usercontent must be on a different site from the app**: another registrable domain, not a subdomain of the app's domain. Artifact pages are untrusted HTML; on a separate site they can never read the app's cookies.

## What you need

- A Cloudflare account with your domains on it. Sending sign-in mail to anyone needs the Workers Paid plan.
- Node 22, pnpm 9, and `npx wrangler login` done once.
- `pnpm install` run in the repository.

## 1. Create the database and the file bucket

```sh
cd apps/app
npx wrangler d1 create open-artifact
npx wrangler r2 bucket create open-artifact-files
```

Copy the `database_id` printed by the first command into `apps/app/wrangler.jsonc` (`d1_databases[0].database_id`).

## 2. Set the addresses

In `apps/app/wrangler.jsonc` set `vars`:

```jsonc
"vars": { "USERCONTENT_ORIGIN": "https://example-usercontent.com", "MCP_ORIGIN": "https://mcp.artifact.example.com" }
```

In `apps/usercontent/wrangler.jsonc` and `apps/mcp/wrangler.jsonc` set `"APP_ORIGIN": "https://artifact.example.com"`.

Give each Worker its address with a custom domain, either in the dashboard (Workers › your Worker › Settings › Domains & Routes) or in its `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "artifact.example.com", "custom_domain": true }]
```

## 3. Set the secrets

Generate two random secrets (for example `openssl rand -base64 32`). The signing key must be the same in app and usercontent.

```sh
cd apps/app
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put USERCONTENT_SIGNING_KEY
npx wrangler secret put ALLOWED_EMAIL_DOMAINS   # e.g. example.com; leave it out to let only the first person sign up
npx wrangler secret put MAILER                  # cloudflare
npx wrangler secret put MAIL_FROM               # Open Artifact <noreply@artifact.example.com>

cd ../usercontent
npx wrangler secret put USERCONTENT_SIGNING_KEY  # the same value as the app's
```

Optional sign-in providers, all on the app: `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and company SSO with `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISPLAY_NAME`. Their callback addresses are `https://artifact.example.com/api/auth/callback/github`, `…/callback/google` and `…/api/auth/oauth2/callback/company-sso`.

## 4. Set up sign-in mail

Sign-in uses emailed links. Onboard the sending domain in **Cloudflare Email Service** and verify it; the domain of `MAIL_FROM` must be that domain. The `EMAIL` binding is already declared in `apps/app/wrangler.jsonc`. Email Service is in public beta.

## 5. Create the tables

```sh
cd apps/app
npx wrangler d1 migrations apply open-artifact --remote
```

Run this again after every upgrade; it applies only the migrations not yet applied.

## 6. Deploy

The app first, since the other two reach it through service bindings:

```sh
cd apps/app && npx wrangler deploy
cd ../usercontent && npx wrangler deploy
cd ../mcp && npx wrangler deploy
```

## 7. First sign-in

Open the app's address and sign in. The first person becomes the admin of the workspace; people from `ALLOWED_EMAIL_DOMAINS` join as members, and an admin can invite others by email under 设置.

Check that it works end to end:

- `https://artifact.example.com/health` answers with `"status": "ok"`.
- Create a token under 设置 › Agent 接入, connect an agent to `https://mcp.artifact.example.com/mcp` and publish a page; it opens in the viewer.

## Running it

- **Who can sign up.** Keep `ALLOWED_EMAIL_DOMAINS` to your own domains. Admins can switch public links off for the whole workspace and take down any artifact.
- **Public links host whatever people publish.** As the operator you are responsible for what is served from your domains. Take down abuse from the artifact's page; removed artifacts are purged after 30 days by the daily job (`triggers.crons` in `apps/app/wrangler.jsonc`).
- **Upgrades.** Pull, run `pnpm install`, apply the migrations (step 5), then deploy the three Workers again (step 6).
