# Open Artifact verification map

This directory is the maintained source for verifying the user-facing behavior of Open Artifact. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `V=.claude/skills/verify-open-artifact/scripts/oa-verify.mjs`, run from the repo root.
- A run started with `node $V launch`, with `node $V doctor` reporting `"healthy": true`.
- App at `http://localhost:18787`, usercontent at `http://localhost:18789`, MCP at `http://localhost:18788/mcp`.
- The founder `founder@example.com` is signed in (workspace admin), and the run holds a full-scope token.
- Never drive ports 8787–8789. Those belong to the developer's own `pnpm dev`.

## Driving conventions

- Start each recipe from the baseline. Create what it needs, such as a fixture page, with `node $V publish`.
- Address UI elements by id or `data-*` attribute. The UI text follows the language and may change.
- Use the `path` that `publish` prints. Addresses are `/a/{slug}-{shortId}`.
- Read what the user sees inside an artifact with `--frame-text`. The top page cannot read the sandboxed frame.
- Use `--as session` for the person, the default token for the agent, and `--as anon` for a stranger with a public link.

## Proof and skip reporting

- Capture the action and the resulting state: the command's JSON plus a screenshot or frame text.
- Re-read a mutation from a second view (UI after API, API after UI).
- Name the feature ID and the entry point with every artifact.
- If an entry point can't be reached, report the command you tried and the precondition that was missing. Don't report it as verified through a different path.

## Feature entry contract

Each feature file has an H1, one paragraph, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with oa-verify`, `Gotchas`.

## Features

- [Sign in](./sign-in.md): six-digit code sign-in, first person becomes admin, domain admission.
- [Publish and view](./publish-and-view.md): publish by API, readable addresses and redirects, the viewer, new versions.
- [Comments for the agent](./comments-for-agent.md): pin a comment for the agent, the agent finds it, replies and resolves.
- [Sharing and public links](./sharing-public-link.md): visibility, public link with a password, anonymous unlock, listing rules.
- [Agent access (tokens and MCP)](./agent-access.md): create a token in settings, MCP tools and the share answer, scope refusal.
- [Personal page](./personal-page.md): the public `/@handle` page, pinning, what is listed.
- [Share to X](./share-to-x.md): the large card, its access rule, the visitor button, the author's panel and its fix.
- [Interface language](./interface-language.md): the Chinese and English switch for visitors and accounts.
