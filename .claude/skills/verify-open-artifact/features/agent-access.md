# Agent access (tokens and MCP)

A person creates a personal API token under 设置 › Agent 接入, copies it into their agent's MCP config, and the agent can then publish, read, update and answer comments as that person. Tokens have a scope (`publish` or `full`) and an optional expiry, and can be revoked.

## Sub-features

- `agent-token-ui` creates a token from `/settings/agents` and shows the plaintext once.
- `agent-mcp-tools` makes MCP `tools/list` return publish, update, read, list, list_my_comments, list_comments, reply_comment and get_guide.
- `agent-mcp-publish` publishes through MCP with optional `slug`, `summary`, `listed` and `shareText`. The result carries the canonical `url` and a `share` object, and the artifact shows `publishedVia` as the client name.
- `agent-scope-refusal` refuses a `publish`-scope token that tries to list an artifact or change sharing, with 403 `outside_token_scope`.
- `agent-token-revoke` makes a revoked token answer 401 on the API and MCP.

## How to get to it (user POV)

- Open `/settings/agents`, fill `#token-name`, pick an expiry in `#token-expiry` (90 days by default), pick `#token-scope-publish` or `#token-scope-full`, and submit `#create-token-form`. The token appears in `#connect-token-value` and `#connect-setup` shows.
- Agent: MCP at `http://localhost:18788/mcp` with `Authorization: Bearer oa_pat_…`.

## Driving it with oa-verify

Preconditions:

- Baseline run.

- **Create in UI.** Run `node $V browse /settings/agents --fill '#token-name::ui-check' --click '#token-scope-publish' --click '#create-token-form [type=submit]' --sleep 1500 --eval '[document.getElementById("connect-token-value")?.textContent.slice(0,7), document.getElementById("connect-setup").hidden, document.getElementById("token-expiry").value].join("|")' --shot agent-token`. The eval is `oa_pat_|false|90`.
- **Listed.** Run `node $V api GET /api/tokens --as session`. The tokens include `name: "ui-check"`, `scope: "publish"` and a non-null `expiresAt`.
- **Tools.** Run `node $V mcp tools/list`. Eight tools are listed.
- **Publish through MCP.** Run `node $V mcp publish --args '{"title":"Via MCP","slug":"via-mcp-check","summary":"Checks MCP publish.","shareText":"Look at this","visibility":"public_link","listed":true,"files":[{"path":"index.html","content":"<h1>mcp</h1>"}]}'`. The text starts with `Published. Share the url with the person:`, and the JSON in it has a `url` containing `via-mcp-check` and `share.readiness.kind: "ready"` with `share.x.intentUrl`. Then `node $V api GET /api/artifacts` shows it with `publishedVia: "Claude Code"`, because the helper's MCP client name is `claude-code-verify`.
- **Scope refusal.** Run `node $V token --scope publish`, then the same publish with another title. `result.isError` is true and the text has `Open Artifact answered 403` and `this token may only publish; to list it on your personal page`. Run `node $V token` to restore a full token.
- **Revoke.** Take the `tokenId` of `ui-check` from `/api/tokens`, run `node $V api DELETE /api/tokens/<tokenId> --as session` (204), then confirm the list shows `revokedAt` set.
- **Proof.** `agent-token.png`, the tokens list, the `tools/list` names, and the MCP publish result.

## Gotchas

- Token endpoints accept only a browser session (`--as session`). A token can't mint tokens.
- The plaintext token is shown once. Afterwards only its hash exists.
- `node $V token` replaces the run's stored token. The seeded one is `full`.
- A second DELETE on a revoked token removes it from the list instead of answering 404.
