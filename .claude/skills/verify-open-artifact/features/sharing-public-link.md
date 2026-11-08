# Sharing and public links

The author chooses who can see an artifact: private, named people, the workspace, or a public link. A public link can carry an expiry and a password, and can be listed on the author's personal page. A stranger who opens a password-protected link sees a password form, and after the right password sees the page.

## Sub-features

- `share-read` reads the current visibility and public-link settings.
- `share-public` switches to `public_link`. A token that opens a link without `publicLinkExpiresAt` gets 7 days, unless it also lists the artifact. A browser session keeps the current expiry.
- `share-listed-refused` refuses `listed: true` on a password-protected link with 400 `not_listable`.
- `share-password` makes an anonymous visitor see the password gate, and the right password unlocks the page.
- `share-wrong-password` keeps the gate up with an error.
- `share-scope` refuses sharing changes from a `publish`-scope token.

## How to get to it (user POV)

- In the viewer, click `[data-open-share]` (分享) and pick visibility, expiry and password in the dialog.
- Agent with a full token: `PUT /api/artifacts/{id}/sharing`.
- Stranger: open `/a/<id>` signed out.

## Driving it with oa-verify

Preconditions:

- An artifact `<id>` published as in [publish-and-view](./publish-and-view.md). The run token is full scope, which is the launch default.

- **Read.** Run `node $V api GET /api/artifacts/<id>/sharing`. `body.visibility` is `workspace`.
- **Make public with password.** Run `node $V api PUT /api/artifacts/<id>/sharing --body '{"visibility":"public_link","publicLinkPassword":"pw-verify-1"}'`. Status 200, with `publicLink.hasPassword: true`, `publicLink.expiresAt` about 7 days ahead, and `share.readiness.kind: "has_password"`. The app log has a `[mail] Subject:` line saying the link expires in 7 days.
- **Listing refused.** Run `node $V api PUT /api/artifacts/<id>/sharing --body '{"listed":true}'`. Status 400, `body.code` is `not_listable`.
- **Gate and unlock.** Run `node $V browse <path> --as anon --wait '#public-link-password' --shot share-gate --fill '#public-link-password::pw-verify-1' --click 'form:has(#public-link-password) [type=submit]' --sleep 2000 --wait '#artifact-frame' --frame-text --shot share-unlocked`. The frame text has the fixture's heading.
- **Wrong password.** Run the same up to the click with `::nope`, then `--sleep 1200 --eval 'location.search + "|" + !!document.querySelector("#public-link-password-error")'`. The eval is `?password=wrong|true`.
- **Scope refusal.** Run `node $V token --scope publish`, then the PUT above. Status 403, and the error says the token may only publish. Run `node $V token` to restore a full token.
- **Proof.** The sharing JSON before and after, `share-gate.png`, and `share-unlocked.png` with frame text.

## Gotchas

- Every page carries a language switch, `form[action="/locale"]`, whose buttons are also `type=submit`. A bare `form [type=submit]` clicks the language button. Scope the selector to the form you mean.
- `<path>` is the `path` that `publish` printed. Match the gate on `#public-link-password`, not the title, which follows the language.
- 10 password attempts per visitor and artifact per minute. Beyond that the form redirects to `?password=wait` with a "too many tries" error, not a 429.
- The share dialog's footer button `[data-share-to-x]` opens the X panel. Its one-click fix removes the password and the expiry, so run it after the password checks. See [share-to-x](./share-to-x.md).
- `browse --as anon` sends no cookie. The default `--as session` would bypass the gate because the founder is the author.
