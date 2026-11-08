# Publish and view

An agent publishes an HTML page and gets a readable link, `/a/{slug}-{shortId}`. A person opens the link and sees the page in the viewer: a top bar with title, version and actions, and the page itself in a sandboxed frame served from the usercontent origin. Updating publishes a new version at the same link.

## Sub-features

- `publish-create` creates an artifact at version 1 from `files` with an `index.html`, and answers with `url`, `slug`, `shortId` and a `share` object.
- `publish-view` renders the page in `#artifact-frame` from the usercontent origin through a signed URL.
- `publish-canonical` redirects an old address (`/a/<uuid>`, or a stale slug with the right short id) to the canonical one with 301.
- `publish-update` publishes version 2 with `baseVersion`, and the viewer shows v2.
- `publish-conflict` answers 409 `version_conflict` on a stale `baseVersion`.
- `publish-home` lists the artifact on the home page.

## How to get to it (user POV)

- Agent: MCP `publish` / `update`, or `POST /api/artifacts` / `PUT /api/artifacts/{id}`.
- Person: open the link from the answer's `url`, or click its card on `/`.

## Driving it with oa-verify

Preconditions:

- Baseline run. Write a fixture: `printf '<!doctype html><html><head><meta charset="utf-8"><title>Verify fixture</title></head><body><h1>Hello from oa-verify</h1></body></html>' > .verify/fixture.html`.

- **Publish.** Run `node $V publish --file .verify/fixture.html --title "Verify fixture"`. The output has `artifactId`, `version: 1`, `shortId`, and `url`/`path` in the form `/a/verify-fixture-<shortId>`.
- **View and redirect.** Run `node $V browse /a/<artifactId> --wait '#artifact-frame' --frame-text --eval 'JSON.stringify({path:location.pathname,title:document.querySelector("[data-artifact-title]").textContent,version:document.querySelector("[data-version-label]").textContent})' --shot publish-view`. `path` is the canonical `/a/verify-fixture-<shortId>`, `title` is `Verify fixture`, `version` is `v1`, `frame-text.frameUrl` starts with `http://localhost:18789/s/`, and `text` contains `Hello from oa-verify`.
- **Update.** Run `node $V api PUT /api/artifacts/<artifactId> --body '{"baseVersion":1,"note":"v2","files":[{"path":"index.html","content":"<h1>Second version</h1>"}]}'`. Status 200 with `version: 2` and the same `url`.
- **Conflict.** Repeat the PUT with `"baseVersion":1`. Status 409, and `body.code` is `version_conflict`.
- **Home.** Run `node $V browse / --wait 'a.artifact-card[href$="-<shortId>"]' --shot publish-home`. The card exists.
- **Proof.** The publish JSON, `publish-view.png`, and the frame text before and after the update.

## Gotchas

- Card links and every address the app hands out are `/a/{slug}-{shortId}`. Match on the short id (`[href$="-<shortId>"]`), because the slug comes from the title. A Chinese title gets no slug locally (the translator is production only), so its path is `/a/<shortId>`.
- A 403 inside the frame means the app and usercontent signing keys differ. Fix `.dev.vars` with `pnpm dev:setup`.
- The top page can't read the frame. Asserting on `document.body` of the viewer only sees the top bar.
- `[data-open-share]` matches both the visibility badge and the Share button. Use `button.xxd-btn[data-open-share]` for the button.
- `files` must include `index.html`. Other files resolve by relative path.
