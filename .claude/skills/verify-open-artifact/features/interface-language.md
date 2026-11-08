# Interface language

The interface speaks Chinese or English. A signed-in person's account choice wins, then the choice made in this browser (the `oa_locale` cookie), then `Accept-Language`, then the deployment's `DEFAULT_LOCALE`. Visitors switch with buttons in the top bar. Signed-in people switch in the account menu, which also saves the choice to their account.

## Sub-features

- `locale-visitor` switches a signed-out visitor's pages with `form[action="/locale"]`.
- `locale-account` saves a signed-in person's choice to their account, so it follows them to other devices.
- `locale-mail` words mail and notifications in the reader's language.

## How to get to it (user POV)

- Signed out: on `/login` or a public page, click a button in `form[action="/locale"]`, for example `button[value="en"]`.
- Signed in: open the account menu and pick a language (`button[role=menuitemradio][name=locale]`).

## Driving it with oa-verify

Preconditions:

- Baseline run.

- **Visitor switch.** Run `node $V browse /login --as anon --eval 'document.documentElement.lang' --click 'form[action="/locale"] button[value="en"]' --sleep 1200 --eval 'JSON.stringify({lang:document.documentElement.lang,path:location.pathname,pressed:document.querySelector("form[action=\"/locale\"] button[value=en]").getAttribute("aria-pressed")})' --shot locale-en`. The first eval is `zh-CN`. The second is `{"lang":"en","path":"/login","pressed":"true"}`.
- **Account switch.** Run `node $V browse / --eval 'const b=document.querySelector("button[role=menuitemradio][value=en]"); b.form.requestSubmit(b); "sent"' --sleep 1500 --reload --eval 'document.documentElement.lang' --shot locale-account`. The second eval is `en`. A fresh `node $V browse /settings/agents --eval 'document.documentElement.lang'` is also `en`, because the account carries the choice.
- **Restore.** Run the account switch with `value=\"zh-CN\"`. Other recipes match Chinese text in a few places.
- **Proof.** `locale-en.png`, `locale-account.png`, and the `lang` values before and after.

## Gotchas

- The account menu's items stay hidden until the menu opens. Submit the item's form with `requestSubmit(button)` rather than clicking it.
- Each `browse` is a fresh browser with no `oa_locale` cookie, so a visitor's choice does not carry into the next `browse`. Check it inside one call.
- `pnpm check` fails on Chinese outside the dictionaries. Fixtures may hold Chinese, product code may not.
- Gate pages and titles follow the language. Match on ids, not on words.
