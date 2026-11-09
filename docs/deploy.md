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
npx wrangler secret put ALLOWED_EMAIL_DOMAINS   # e.g. example.com, or * for any address; leave it out to let only the first person sign up
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

Open the app's address and sign in. Everyone who signs in gets a personal workspace. To work together, create a workspace from the workspace menu at the top left and invite people under 设置 › 成员, by email or with an invite link; a link that never expires suits a team chat or onboarding doc.

Check that it works end to end:

- `https://artifact.example.com/health` answers with `"status": "ok"`.
- Create a token under 设置 › Agent 接入, connect an agent to `https://mcp.artifact.example.com/mcp` and publish a page; it opens in the viewer.

## Deploy from GitHub

`.github/workflows/deploy.yml` runs the checks, applies the migrations and deploys the three Workers when you click **Actions › Deploy › Run workflow**. It never runs on its own. Once, under **Settings › Environments**, create the environment `production` with:

- the secret `CLOUDFLARE_API_TOKEN`: an API token for your account with Workers Scripts, Workers Routes, D1 and Workers Custom Domains edit permissions;
- the variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `APP_HOST`, `APP_ZONE`, `USERCONTENT_HOST` and, for sign-in mail, `MAIL_FROM`;
- optionally the variable `ALLOWED_EMAIL_DOMAINS` (repository or environment), such as `*` to let anyone sign up. When it is set the deploy writes it into the app's configuration; left unset, the app keeps what it had. If you set it earlier as a Worker secret (step 3), run `npx wrangler secret delete ALLOWED_EMAIL_DOMAINS` in `apps/app` before the first deploy with the variable, since a variable and a secret cannot share a name;
- optionally the variable `ABUSE_REPORT_EMAIL`, the address that receives reports of abusive public pages (see [Abuse](#abuse)). Left unset, reports are only stored.

The same two commands deploy from your own machine: `pnpm deploy:config` with those variables set writes the `wrangler.production.jsonc` files (kept out of git), and `pnpm deploy:production` applies the migrations and deploys. The Workers' secrets from step 3 are set once and kept across deployments.

## Running it

- **Who can sign up.** `ALLOWED_EMAIL_DOMAINS` decides who may create an account; nobody joins a workspace without an invite, so `*` opens sign-up without exposing any team's workspace. Admins can switch public links off for their workspace and take down any artifact in it.
- **Upgrading from a version without personal workspaces.** New accounts no longer join the first workspace on their own. After upgrading, create a never-expiring invite link under 设置 › 成员 and share it with colleagues. Existing members keep their workspace and get a personal one on their next visit.
- **Public links host whatever people publish.** As the operator you are responsible for what is served from your domains; see [Abuse](#abuse). Removed artifacts are purged after 30 days by the daily job (`triggers.crons` in `apps/app/wrangler.jsonc`).
- **Limits.** Each workspace holds at most 1,000 active artifacts and 1 GiB of files and shared data (a removed artifact's count until it is purged, or until someone deletes it forever under 最近删除). A page keeps at most 2,000 shared documents and 5 MB of shared data. Each person may publish at most 300 times in any 24 hours, and create at most 10 workspaces besides their personal one, a deleted workspace counting until it is purged. The numbers are set in `apps/app/src/api/publish-limits.ts` and `apps/app/src/api/workspace-api.ts`. The caps on publishes, workspaces, shared data and report mail are exact, since each is counted in the statement that writes. The workspace's artifact and storage limits are approximate: publishes that run at the same moment each see the usage from before the others, so together they can go a little past them.
- **Visitors who are not signed in.** On a public link that lets anyone write shared data, one sender network may change it 60 times a minute (`SHARED_DATA_WRITE_RATE_LIMITER`). This limiter and the ones on sign-in codes, reports and public-link passwords count every IPv6 address in one /64 as one sender, since a subscriber usually holds a whole /64. Cloudflare counts them at each of its locations, so they slow a sender down rather than stop it.
- **Upgrades.** Pull, run `pnpm install`, apply the migrations (step 5), then deploy the three Workers again (step 6).
- **Rolling back.** Do not roll the Workers back to a version from before migration `0017_personal_workspaces.sql` once anyone has left or deleted a workspace: the older code does not know `left_at` and `deleted_at`, so those people and workspaces would get their access back, and new accounts would join the first workspace again. Fix forward instead.

## Abuse

Anyone who opens a public link, signed in or not, can choose **Report** (举报) in the page's top bar and pick a reason: spam, phishing or malware, illegal content, or other. Reports are stored in the `abuse_reports` table, with the sender's network address kept only as a keyed hash. One sender may send 5 reports a minute (`REPORT_RATE_LIMITER`) and one page takes at most 20 reports a day.

When `ABUSE_REPORT_EMAIL` is set, each report is mailed there through the app's mail service (`MAILER=cloudflare` and `MAIL_FROM`, step 4). The mail opens with the command that takes the page down, then gives the page's link, and quotes what the reporter wrote line by line with `> `, so a report cannot pass off a command of its own. At most 50 reports in any 24 hours are mailed one by one, across every page, so reporting many pages cannot flood your inbox. Reports past that are stored with `mailed_at` left empty, and the daily job mails you one digest saying how many there were. Without `ABUSE_REPORT_EMAIL`, read the reports with `npx wrangler d1 execute open-artifact --remote --config wrangler.production.jsonc --command "SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT 20"` in `apps/app`.

To take a page down, run from a checkout of the deployment, with wrangler signed in to its Cloudflare account and `apps/app/wrangler.production.jsonc` written by `pnpm deploy:config`:

```sh
pnpm takedown https://artifact.example.com/a/bank-login-k7f3q9x2m4ab --dry-run   # prints the SQL only
pnpm takedown https://artifact.example.com/a/bank-login-k7f3q9x2m4ab            # or just the short id, k7f3q9x2m4ab
```

It runs `wrangler d1 execute open-artifact --remote` to remove the artifact as a takedown by the operator and records it in its workspace's admin log. The link stops working at once. Neither the author nor any workspace admin can restore it, and the daily job purges it after 30 days. wrangler prints the rows changed; 0 means no artifact has that short id. To undo a takedown within the 30 days, set `removed_at`, `removed_by` and `removed_as_admin` back to `NULL` for that `short_id` with `wrangler d1 execute`.

