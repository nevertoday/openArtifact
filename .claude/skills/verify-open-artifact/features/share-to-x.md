# Share to X

An artifact listed on its author's personal page can go out on X as a large image card with the title drawn in the picture. Strangers get a share button under the article. The author gets a panel that says whether the link is ready, fixes it in one click, composes text within X's 280 weighted characters, and previews the real card. Agents get the same post in every publish and update answer.

## Sub-features

- `x-meta` serves `twitter:card=summary_large_image` and an `og:image` at `/a/{segment}/card.png?v={version}.{template}` on listed articles and on `/@handle`.
- `x-card` draws a 1200×630 PNG on first request, keeps it in R2, and answers `Cache-Control: public, max-age=31536000, immutable` when `?v=` names the current drawing.
- `x-card-private` answers a card request for anything not on a personal page with the same 404 as a missing artifact.
- `x-byline` gives a visitor a link button in the article byline that opens `x.com/intent/post` in a new tab.
- `x-panel` opens the author's panel from the share dialog footer or the byline, with readiness, styles, counter and card preview.
- `x-fix` turns a not-ready link (unlisted, password, expiry, not public) into a public, listed, never-expiring link after a confirm.
- `x-personal` shows an X link and a copy-link button on each personal page row, and an X link for the whole page.

## How to get to it (user POV)

- Author: in the viewer, click `button.xxd-btn[data-open-share]`, then `[data-share-to-x]` in the dialog footer. The panel is `#share-x-dialog`. On a listed article the byline button `[data-open-share-x]` opens it too.
- Stranger: open a listed article. The byline has `.viewer-byline__share`, a link to X. On `/@handle`, each row has `.personal-share` with an X link and a `[data-copy]` button.
- X: fetch the page as `Twitterbot/1.0` and follow `og:image`.
- Agent: the `share` object in `POST /api/artifacts`, `PUT /api/artifacts/{id}`, `GET`/`PUT /api/artifacts/{id}/sharing`, and MCP `publish`/`update`.

## Driving it with oa-verify

Preconditions:

- An artifact published as in [publish-and-view](./publish-and-view.md), made public with a password as in [sharing-public-link](./sharing-public-link.md), so the panel has something to fix. Note its `<id>` and `<path>`.
- Write captures to a scratch directory `$S`.

- **Panel and fix.** Run `node $V browse <path> --click 'button.xxd-btn[data-open-share]' --wait '[data-share-to-x]' --click '[data-share-to-x]' --wait '[data-share-x-readiness]' --eval 'document.querySelector("[data-share-x-readiness]").dataset.shareXReadiness' --shot x-before --click '[data-share-x-readiness] .xxd-banner__actions button' --wait 'dialog[role=alertdialog] button[value=confirm]' --click 'dialog[role=alertdialog] button[value=confirm]' --sleep 1500 --wait '[data-share-x-readiness="ready"]' --eval 'JSON.stringify({count:document.querySelector("[data-share-x-count]").textContent,open:document.querySelector("[data-share-x-open]").getAttribute("href").slice(0,30),card:document.querySelector("[data-share-x-card]").naturalWidth})' --shot x-ready`. The first eval is `has_password`. The second has a count like `107 / 280`, an `https://x.com/intent/post?text` link, and `card: 1200`.
- **Second view.** Run `node $V api GET /api/artifacts/<id>/sharing`. `visibility` is `public_link`, `publicLink` has `hasPassword: false`, `expiresAt: null`, `listed: true`, and `share.readiness.kind` is `ready`.
- **Meta.** Run `curl -s -A Twitterbot/1.0 http://localhost:18787<path> | grep -o -E '<meta (name|property)="(twitter:card|og:image)"[^>]*>'`. It shows `summary_large_image` and an `og:image` ending in `/card.png?v=<version>.1`.
- **Card.** Fetch that `og:image` URL with `curl -s -o $S/card.png -D $S/card.h`. `file $S/card.png` says `PNG image data, 1200 x 630`, and the headers have the immutable cache line. Read the PNG and check that the title is drawn and the bottom-left corner is empty.
- **Private card.** Publish a second, workspace-only page. `curl` its `<path>/card.png` and `/a/nope-zzzzzzzzzzzz/card.png` into two files. Both answer 404, and `cmp` finds the bodies identical.
- **Visitor byline.** Run `node $V browse <path> --as anon --wait '.viewer-byline__share' --eval 'JSON.stringify({tag:document.querySelector(".viewer-byline__share").tagName,target:document.querySelector(".viewer-byline__share").target})' --shot x-byline`. The eval is `{"tag":"A","target":"_blank"}`.
- **Personal page.** Take `publicLink.personalPageUrl` from the sharing JSON. Run `node $V browse /@<handle> --as anon --wait '.personal-share__action' --eval 'document.querySelector(".personal-share [data-copy]").dataset.copy' --shot x-personal --viewport 500x900 --shot x-personal-touch`. The eval is the article's canonical URL. The profile page's `og:image` is `/@<handle>/card.png?v=…` and is also a 1200×630 PNG.
- **Proof.** `x-before.png`, `x-ready.png`, the sharing JSON, the meta lines, `card.png` with its headers, the two 404 bodies, `x-byline.png`, and `x-personal*.png`.

## Gotchas

- The first card for a version takes about a second locally, because the renderer fetches subset fonts from Google Fonts (and Twemoji from jsDelivr for emoji). Without network the card answers 503 with `no-store`, and the next request tries again. Nothing is stored on failure.
- The panel's fix removes the password and the expiry. Run password scenarios before it, or on another artifact.
- The kit's confirm dialog has no `data-*` handle. Its confirm button is `dialog[role=alertdialog] button[value=confirm]`.
- The byline renders only for a listed article, so a workspace-only artifact has no `[data-open-share-x]`. Use the share dialog footer there.
- X's own composer preview cannot be checked locally, because X cannot reach `localhost`.
