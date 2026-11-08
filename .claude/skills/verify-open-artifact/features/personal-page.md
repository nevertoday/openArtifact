# Personal page

Each person who lists an artifact gets a public page at `/@handle`: their name, a line about themselves, the pinned artifact as a cover, and the rest by year. Strangers read it. The owner sees the same page with an owner bar and quiet tools to pin an entry, edit its summary, and edit their bio.

## Sub-features

- `personal-list` shows only artifacts that are public, listed, without a password, and not expired.
- `personal-pin` makes an entry the cover, and unpins it.
- `personal-summary` lets the owner edit an entry's summary in place.
- `personal-bio` lets the owner edit the line about themselves (`PATCH /api/me/profile`).
- `personal-share` gives each row and the page header a way to share on X. See [share-to-x](./share-to-x.md).

## How to get to it (user POV)

- Author: in the share dialog, choose a public link, switch on `#listed`, and save. The dialog then links to the personal page. An agent sends `"listed": true` with a full-scope token.
- Anyone: open `/@<handle>`. The handle comes from the person's name, so `founder@example.com` named `founder` gets `/@founder`.

## Driving it with oa-verify

Preconditions:

- At least two artifacts published with `visibility: public_link` and `listed: true`, for example through MCP as in [agent-access](./agent-access.md) and through the X panel fix as in [share-to-x](./share-to-x.md).

- **Visitor view.** Run `node $V browse /@founder --as anon --wait '.personal-entry, .personal-cover' --eval 'JSON.stringify({entries:document.querySelectorAll("[data-entry]").length,owner:!!document.querySelector(".personal-owner-bar")})' --shot personal-visitor`. `entries` matches the number of listed artifacts, and `owner` is false.
- **Pin.** Run `node $V browse /@founder --wait '.personal-owner-bar' --click '[data-pin=on]' --sleep 1500 --reload --wait '.personal-cover' --eval 'JSON.stringify({cover:document.querySelector(".personal-cover__title").textContent,unpin:!!document.querySelector("[data-pin=off]")})' --shot personal-pinned`. After the reload, the cover is the entry that was pinned and `unpin` is true.
- **Unlisted drops out.** Run `node $V api PUT /api/artifacts/<id>/sharing --body '{"visibility":"workspace"}'` for one listed artifact, then repeat the visitor view. `entries` is one fewer.
- **Proof.** `personal-visitor.png`, `personal-pinned.png`, and the counts before and after.

## Gotchas

- The owner tools are `[data-pin]`, `[data-edit-summary]` and `[data-edit-bio]`. They render only for the owner's session.
- The rows' share and pin controls sit outside the entry link, so click them by selector, not by row.
- `--reload` re-reads server state in the same browser. That is the second view for a UI change here.
- The personal page and listed articles carry a canonical URL and no `noindex`. Every other page is `noindex`.
