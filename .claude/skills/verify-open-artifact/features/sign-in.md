# Sign in

A person enters an email on the login page and gets a six-digit code by mail (printed to the app log locally). The form changes to a code step, and typing the sixth digit signs them in. Everyone who signs in gets a personal workspace and is its admin; a person who came through an invite link also joins that workspace. Who may sign up at all follows `ALLOWED_EMAIL_DOMAINS` (`example.com` in a run).

## Sub-features

- `signin-code-send` sends a code to an admitted address and shows the code step.
- `signin-code-enter` enters the code and gets a session.
- `signin-personal` gives every new account its own personal workspace, as admin.
- `signin-refuse` refuses an address outside `ALLOWED_EMAIL_DOMAINS` with an error under the email field.

## How to get to it (user POV)

- Open `/login`, type an email in `#login-email`, and press the send button. `#email-step` hides and `#code-step` shows the address in `[data-sent-to]`. Type the code in `#login-code`. It submits by itself on the sixth digit.
- Any signed-out visit to `/` redirects to `/login?next=...`.

## Driving it with oa-verify

Preconditions:

- For `signin-founder`, launch with `node $V launch --no-seed` so nobody has signed in yet.

- **Send code (UI).** Run `node $V browse /login --as anon --fill '#login-email::member@example.com' --click '#email-step [type=submit]' --sleep 1200 --eval 'JSON.stringify({code:!document.getElementById("code-step").hidden,sent:document.querySelector("[data-sent-to]").textContent})' --shot signin-code-step`. The eval is `{"code":true,"sent":"member@example.com"}`. `node $V log app --tail 20` shows `[mail] To: member@example.com` and a subject that starts with the six-digit code.
- **Enter code.** Run `node $V sign-in --email member@example.com`. It posts a fresh code to `/api/auth/sign-in/email-otp`, the same endpoint the page uses. `node $V api GET /api/me --as session` answers 200 with that email.
- **Personal workspace.** After a sign-in, `node $V api GET /api/me --as session` names the current workspace, and `node $V api GET /api/workspace/members --as session` lists that person alone with the admin role. A second address signed in with `sign-in --email` gets a workspace of its own, not the founder's; to put two people in one workspace, create an invite link as the first (`node $V api POST /api/workspace/invites/link --as session`), then sign the second in and open the link's `url` path as them (`node $V browse <path> --as session`).
- **Refusal (UI).** Run `node $V browse /login --as anon --fill '#login-email::someone@other.test' --click '#email-step [type=submit]' --sleep 1500 --eval 'JSON.stringify({codeHidden:document.getElementById("code-step").hidden,invalid:document.getElementById("login-email").getAttribute("aria-invalid"),error:document.querySelector("#email-step .xxd-error")?.textContent})' --shot signin-refused`. The code step stays hidden, `invalid` is `"true"`, and `error` says the address may not sign in.
- **Refusal (helper).** `node $V sign-in --email someone@other.test` fails with `sign-in code request answered 403` and `EMAIL_NOT_ADMITTED`. No `[mail] To: someone@other.test` line appears in the log.
- **Proof.** `signin-code-step.png`, `signin-refused.png`, the quoted `[mail]` log lines, and the `/api/me` JSON.

## Gotchas

- Each `browse` starts a fresh Chrome, and the code step lives only in the page's script. Send in the UI, then prove the enter step with `sign-in`. Do not try to type the code in a second `browse`.
- The refusal shows on the email field (`#email-step .xxd-error`), not in `#login-error`, which stays empty.
- A code lasts 10 minutes and works once. Ten wrong codes for one address in 24 hours lock code sign-in with 429 `SIGN_IN_LOCKED`.
- 3 code requests per address per minute, counting UI sends, resends and `sign-in`. A fourth answers 429 `rate_limited`.
- A send without a matching `Origin` header answers 403 `INVALID_ORIGIN`. The helper adds it.
- `sign-in` replaces the run's stored session. Sign the founder back in before founder-only steps.
