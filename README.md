# Open Artifact

[中文](README.zh-CN.md)

Any AI agent publishes HTML pages ("artifacts"); the whole team opens, comments on and uses them, without a Claude account. Everything runs on your own Cloudflare account.

- **Publish from any agent.** Claude Code, Codex, Cursor or anything else, through MCP or a plain HTTP API.
- **Comment on the page itself.** Pin a comment to a spot or a selected passage, and hand open comments to an agent with one copy. Each comment has its own link that opens the page at it.
- **Versions, sharing and public links.** Private, named people, the whole workspace, or a public link with an expiry and an optional password.
- **A personal page.** Authors list public artifacts at `/@name`, with share cards and search-engine indexing for those pages only.
- **Workspaces.** Everyone gets a personal workspace; create more, invite people, and belong to several. See [Workspaces](#workspaces).

The interface speaks Chinese and English; see [Languages](#languages).

> **License.** Open Artifact is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is free for noncommercial use. Commercial use, including a company running it for its own staff, needs a separate license: https://ui.xiaoxiaodong.ai/license

## Run it locally

Requires Node 22 and pnpm 9.

```sh
pnpm install
pnpm dev:setup   # writes .dev.vars with local secrets, applies the D1 migrations
pnpm dev         # usercontent :8789, app :8787, MCP :8788
```

Open http://localhost:8787 and sign in with an `@example.com` address (local setup allows that domain; change `ALLOWED_EMAIL_DOMAINS` in `apps/app/.dev.vars`). Locally the sign-in code is printed in the terminal running `pnpm dev` (look for `[mail]`). Everyone who signs in gets a personal workspace and is its admin; invite others from 设置 › 成员, or create a shared workspace from the workspace menu at the top left of the home page.

Stop the servers with Ctrl-C. If a port is still taken afterwards, `pkill -f workerd`.

## Workspaces

Artifacts live in workspaces. A workspace can hold one person or many, and a person can belong to several and switch between them from the workspace menu. Sharing, tokens and the admin log all work per workspace; an agent's token publishes into the workspace it was created in.

- **Personal workspace.** Created at a person's first sign-in, named after them, with them as admin. It can be renamed and others invited in, but it cannot be left or deleted, so everyone always has somewhere to land.
- **Joining.** People join a workspace only through an invite: an email invite (valid 7 days) or an invite link that lasts 7 days, 30 days or never. Someone who signs up through an invite gets their personal workspace and the invited one, and lands in the invited one. There is no automatic joining by email domain.
- **Leaving and deleting.** Members and all but the last admin can leave; any later invite brings them back. Someone an admin removed comes back only through an email invite addressed to them. Admins can delete a workspace: every member, page, public link and token loses access at once (tokens answer `workspace_deleted`), admins can restore it for 30 days from 最近删除 in the workspace menu, and the daily job then deletes it with its artifacts and files.
- **分享给我的** lists every artifact shared with a person one by one, from any workspace, labeled with the workspace it comes from.

**Upgrading a self-hosted deployment.** Earlier versions put every new account into the deployment's first workspace. That no longer happens: new colleagues land in their personal workspace. After upgrading, have an admin create a never-expiring invite link under 设置 › 成员 and post it where colleagues find it, such as the team chat or onboarding doc. Existing members keep their workspace and get a personal one on their next visit.

## Connect an agent

1. In the app, open 设置 › Agent 接入 and create a personal API token.
2. Add the MCP server shown there, for example for Claude Code:

   ```sh
   claude mcp add --transport http open-artifact http://localhost:8788/mcp --header "Authorization: Bearer oa_pat_…"
   ```

3. Ask the agent to publish something. Agents without MCP can use the HTTP API described at http://localhost:8787/llms.txt.

## Checks

```sh
pnpm run check   # storage boundary, type checks, all tests (Workers runtime, local D1 and R2)
```

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | Domain types, repository interfaces, access rules (`ArtifactAccess`), token and signature secrets |
| `packages/storage-cloudflare` | D1 and R2 repositories and the migrations; the only code that touches D1 or R2 |
| `apps/app` | Web pages, HTTP API, sign-in (Better Auth), the viewer's postMessage proxy |
| `apps/usercontent` | Serves artifact files on their own origin through signed URLs, and injects the page SDK; reads files through the app's `ArtifactFileReader` RPC entrypoint and has no storage binding |
| `apps/mcp` | Remote MCP server; each tool is one call to the app's HTTP API with the agent's token |

## Configuration

| Variable | Worker | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | app | Session signing |
| `ALLOWED_EMAIL_DOMAINS` | app | Who may create an account: `*` for any address, or comma-separated domains such as `example.com, example.cn`. Unset: only the first person (the founder). People with an invite may always sign up. Every new account gets a personal workspace; it joins other workspaces only through invites. When deploying from GitHub, set the repository variable of the same name (see [docs/deploy.md](docs/deploy.md#deploy-from-github)) |
| `MAILER` | app | `console` prints mail to the log for local development. `cloudflare` sends through Cloudflare Email Service with the `EMAIL` binding. Unset: sign-in mail fails loudly instead of leaking codes into logs. Any other value, or `cloudflare` without `EMAIL` or `MAIL_FROM`, fails every request with a configuration error |
| `MAIL_FROM` | app | Sender for `MAILER=cloudflare`, such as `Open Artifact <noreply@example.com>` or `noreply@example.com`. Its domain must be onboarded and verified in Cloudflare Email Service. Sending to any recipient needs the Workers Paid plan, and the service is in public beta |
| `USERCONTENT_SIGNING_KEY` | app, usercontent | Must be the same in both; signs artifact file URLs |
| `USERCONTENT_ORIGIN`, `MCP_ORIGIN` | app | Public addresses of the other two Workers |
| `APP_ORIGIN` | usercontent, mcp | Public address of the app |
| `GITHUB_CLIENT_ID` / `_SECRET`, `GOOGLE_CLIENT_ID` / `_SECRET` | app | Optional sign-in providers; each button appears once both of its values are set. See [Sign in with GitHub or Google](#sign-in-with-github-or-google) |
| `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISPLAY_NAME` | app | Optional company SSO |
| `DEFAULT_LOCALE` | app | Interface language when neither the person nor their browser picks one: `zh-CN` (default) or `en` |

Bindings besides variables: the app needs `DB` (D1), `FILES` (R2) and `UNLOCK_RATE_LIMITER` (rate limit for public-link passwords), `SIGN_IN_EMAIL_RATE_LIMITER` and `SIGN_IN_ADDRESS_RATE_LIMITER` (sign-in codes per address and per sender), plus the `EMAIL` `send_email` binding (Cloudflare Email Service) when `MAILER=cloudflare`; usercontent needs the `ARTIFACT_FILES` service binding to the app; MCP needs the `APP` service binding.

### Sign in with GitHub or Google

Create one OAuth app per provider, with the callback URL on the app's own address:

| Provider | Where | Callback URL |
|---|---|---|
| GitHub | Settings › Developer settings › OAuth Apps › New OAuth App | `https://<app>/api/auth/callback/github` |
| Google | Google Cloud Console › APIs & Services › Credentials › Create OAuth client ID (Web application) | `https://<app>/api/auth/callback/google` |

Then set the secrets from `apps/app` with `wrangler secret put GITHUB_CLIENT_ID` and likewise `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. No deploy is needed. For local development, make a second app with `http://localhost:8787/api/auth/callback/<provider>` and put its values in `apps/app/.dev.vars`. A Google app in Testing status admits only its test users until you publish it on the OAuth consent screen. Someone who first signed in with a code and later uses GitHub or Google with the same verified email lands in the same account.

The usercontent Worker must run on a different site from the app (another domain, not only another port in production), so artifact pages can never read the app's cookies.

## Languages

The interface speaks Chinese and English. A person's choice in the language switch wins and follows their account to every browser and into their mail; otherwise the browser's `Accept-Language` decides, then `DEFAULT_LOCALE`. Artifacts, comments and names are shown as written.

The words live in `apps/app/public/static/i18n`, one file per area and language, shared by the Worker and the page scripts. `zh-CN` is the reference: `pnpm typecheck` fails when another language misses a key, adds one or takes different parameters. `pnpm check` also fails on Chinese written anywhere outside the dictionaries (`scripts/check-no-hardcoded-cjk.mjs`). To add a language, add it to `LOCALES` in `packages/core/src/locale.ts`, copy `en.js` and the `en/` folder under its code, translate, and register it in `apps/app/src/i18n/messages.ts` and the SDK dictionary in `apps/usercontent/src/i18n`.

## Deploy

Step-by-step deployment to your own Cloudflare account: [docs/deploy.md](docs/deploy.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Issues and suggestions are welcome. Code contributions are not accepted yet; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE). The bundled UI kit in `apps/app/public/static/vendor/xxd` is under the same license. Commercial licenses: https://ui.xiaoxiaodong.ai/license
