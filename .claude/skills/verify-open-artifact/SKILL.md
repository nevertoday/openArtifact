---
name: verify-open-artifact
description: Launch a disposable Open Artifact stack (app, usercontent, MCP Workers) beside the developer's own `pnpm dev`, sign in, publish, comment, share and drive the web UI in headless Chrome, and capture proof. Use whenever a change to apps/app, apps/usercontent, apps/mcp or packages/* must be shown working in the real app rather than only in vitest.
---

# Verify Open Artifact

Open Artifact is three Cloudflare Workers run locally by `wrangler dev`: **app** (pages, HTTP API, sign-in, D1 + R2), **usercontent** (serves artifact files on a separate origin through signed URLs) and **mcp** (remote MCP server that forwards each tool call to the app). Users touch the web UI (Chinese), agents touch the HTTP API and MCP.

Everything here goes through one helper, run from the repo root:

```sh
V=.claude/skills/verify-open-artifact/scripts/oa-verify.mjs
node $V help
```

Every command prints JSON. A failure exits 1 with `{"error", "hint"}`, and the hint says what to run next.

## Isolation: never drive the developer's stack

The developer usually has `pnpm dev` running on **8787/8788/8789** with their own data in `.wrangler/state`. Do not drive it, kill it, or `pkill -f workerd` (README suggests that for humans, but it kills their session). A verification run uses:

- ports **18787 app, 18788 mcp, 18789 usercontent** and inspector ports 18797–18799 (`--base` moves the whole range)
- its own D1/R2 state in `.verify/runs/<runId>/state`, migrated from empty
- its own wrangler dev registry (`WRANGLER_REGISTRY_PATH`), so service bindings resolve to this run's Workers and not the developer's
- `--var` overrides for `USERCONTENT_ORIGIN`, `MCP_ORIGIN`, `APP_ORIGIN`, `MAILER=console`, `ALLOWED_EMAIL_DOMAINS=example.com`

Secrets (`BETTER_AUTH_SECRET`, `USERCONTENT_SIGNING_KEY`) come from the existing `apps/*/.dev.vars`. One active run at a time. `launch` refuses a second one.

## Launch

```sh
node $V launch            # about 6 s
```

It applies the D1 migrations to a fresh state dir, starts app, then usercontent, then mcp, and waits until each answers `/health`. Then it signs in `founder@example.com` through the real sign-in code flow, which makes that address the workspace admin, and creates a full-scope API token. **Ready** means the output has `"ready": true` with a `tokenPrefix`: the app is usable as a signed-in user and as an agent, not just answering health.

- `--no-seed` skips sign-in and the token, for testing the first-sign-in path yourself.
- If `.dev.vars` is missing, launch says so. Run `pnpm dev:setup` once. It keeps existing secrets, but it also migrates the developer's `.wrangler/state`, which is harmless.

## Doctor

```sh
node $V doctor
```

This is read-only. For each Worker it checks that the pid is alive, `/health` reports the right `service`, and the listening port belongs to this run's process group. It also checks that the session cookie answers `/api/me` with 200, that the app's settings page advertises this run's MCP origin (proof the `--var` overrides took), and that the token lists artifacts. `"healthy": false` exits 1. Run doctor first whenever anything looks off, and read `node $V log app --tail 60`.

## Drive

| Need | Command |
| --- | --- |
| Act as the signed-in user over HTTP | `node $V api <METHOD> <path> --as session [--body '<json>'|@file]` (Origin header added, so CSRF checks pass, and `X-Open-Artifact-Workspace` naming the current workspace, as the pages send it; `--workspace <id>` names another, `--workspace none` names none, to see the 409 `workspace_changed`) |
| Act as an agent over HTTP | `node $V api <METHOD> <path>` (default `--as token`) |
| Publish a page | `node $V publish --file page.html --title "T" [--visibility workspace\|private\|specified\|public_link]` (prints `path`, the canonical `/a/{slug}-{shortId}`) |
| Act as an agent over MCP | `node $V mcp tools/list`, `node $V mcp <tool> --args '<json>'` |
| A second person | `node $V sign-in --email member@example.com` (switches the stored session to them; sign in founder again to switch back) |
| Drive the UI | `node $V browse <path> [--as session\|anon] <steps>` |

`browse` opens a fresh headless Chrome (system Chrome, or `OA_CHROME`) with the stored session cookie. Its steps run in order: `--wait <css>`, `--click <css>`, `--fill '<css>::<text>'`, `--press <Key>`, `--sleep <ms>`, `--eval '<js>'`, `--frame-text`, `--shot <name>`, `--dom <name>`, `--viewport <W>x<H>` (below 700 px it also emulates a touch phone), `--scheme light|dark`, `--reload`. Each browse is a new browser, so state lives in the server, not in the tab.

Stable handles in this UI are ids and `data-*` attributes. Use them, not text or position:

- viewer: `#artifact-frame`, `[data-artifact-title]`, `[data-version-label]`, `[data-comment-mode]`, `button.xxd-btn[data-open-share]` (the bare attribute also matches the visibility badge), `[data-comment-count-button]`, `[data-comment-count]`, `[data-version-button]`, `[data-composer]`
- comment drawer: `[data-comment-filters] [data-value=all]`, `.comment-thread__resolve`, `.comment-thread__more`, `.comment-pin[data-state]`
- share to X: `[data-share-to-x]` (share dialog footer), `[data-open-share-x]` (author's byline), `.viewer-byline__share` (visitor's byline), `#share-x-dialog`, `[data-share-x-readiness]`, `[data-share-x-count]`, `[data-share-x-open]`
- home: `a.artifact-card[href$="-<shortId>"]`, `#artifact-search`
- personal page: `[data-entry]`, `.personal-cover`, `.personal-share`, `[data-pin]`, `[data-edit-summary]`, `[data-edit-bio]`
- login: `#email-step`, `#login-email`, `#code-step`, `#login-code`, `[data-sent-to]`
- language: `form[action="/locale"] button[value=en]`; the kit's confirm dialog: `dialog[role=alertdialog] button[value=confirm]`
- settings › agents (`/settings/agents`): `#create-token-form`, `#token-name`, `#token-scope-publish`, `#token-scope-full`, `#connect-token-value`
- password gate: `#public-link-password`, `form:has(#public-link-password) [type=submit]`

The artifact page runs in `#artifact-frame`, which is sandboxed and served from :18789. The top page can't read it. `--frame-text` reads the frame's own document through its DevTools target, which proves what the user actually sees inside the frame.

Feature recipes are in [features/README.md](features/README.md). Pick the feature you changed and run its journey.

## Evidence

Everything lands in `.verify/evidence/<runId>/`:

- `log.jsonl`: every command this run issued, with status codes
- `<name>.png`: `--shot`, `<name>.txt`: `--dom`
- the JSON each command printed. Paste the relevant parts into your report.

Proof standards:

- Go through the real user path. That means the UI for user-facing changes, and the HTTP API or MCP for agent-facing ones. Never write to D1 directly or call test-only helpers.
- Capture the action and the resulting state. A publish proof shows the publish response and the viewer's `--frame-text` or screenshot. A mutation proof re-reads the stored value from a second view, such as `api GET` after a UI action, or `browse` after an API action.
- Check side effects: version numbers bump, comments appear in `list_my_comments`, `sharing` reflects the change, and the anonymous view changes accordingly.
- Mail is never sent. `MAILER=console` writes it to `logs/app.log`. Treat the log line as the side effect and quote it.

## Cleanup

```sh
node $V stop
```

It kills only the process groups this run spawned (pnpm, wrangler, workerd) and any leftover headless Chrome, then deletes `.verify/runs/<runId>/`, which holds state, logs and the registry. It keeps `.verify/evidence/<runId>/` and prints the files in it. It never kills by process name. After a failed launch, still run `stop` so half-started Workers don't hold the ports. `.verify/` is gitignored.

## Gotchas

- A sign-in code works once and lives 10 minutes. `sign-in` requests a fresh code, reads it from the app log and enters it, so run it again rather than reusing an old code.
- Every page has a language switch, `form[action="/locale"]`, whose buttons are `type=submit`. A bare `form [type=submit]` clicks a language button. Scope submit selectors to their form.
- Only `@example.com` addresses are admitted in a run. The first address ever to sign in becomes admin.
- Session writes without a matching `Origin` header answer 403 `cross_site_request`. `api --as session` adds the header. A hand-rolled curl must add it too.
- Token scopes: `publish` cannot change sharing (403 "this token may only publish"). The seeded token is `full`, so to test the refusal, create one with `node $V token --scope publish`. That replaces the run's token.
- Sign-in has rate limits: 3 code requests per address per minute, 20 per sender per minute. UI sends count too. Looping `sign-in` hits them.
- Each `browse` starts a fresh Chrome in about 1 s. Batch steps into one call instead of many calls.
