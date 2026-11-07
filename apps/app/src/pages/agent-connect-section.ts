import type { Messages } from '../i18n/messages.ts'
import type { GuideFile, GuidePackFormat } from '../guide/agent-guide.ts'
import { html, SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

/** Where a new token goes in a snippet; settings.js fills every slot once the token exists. */
const TOKEN_SLOT = Symbol('token slot')
type SnippetPart = string | typeof TOKEN_SLOT

type ClientId = keyof Messages['settings']['agents']['setup']['placements']

/** How one agent client connects: where the snippet goes, and the snippet with a slot for the token. */
interface ClientSetup {
  /** Stable id for element ids and the tab the person picked. */
  clientId: ClientId
  name: string
  /** One line above the snippet: where to run or paste it. */
  placement: string
  snippet: SnippetPart[]
}

export interface AgentConnectModel {
  m: Messages
  mcpUrl: string
  appOrigin: string
  guideFiles: GuideFile<GuidePackFormat>[]
}

/**
 * Settings › Agent access as three steps: name a token, paste the setup with the token already in it, and see the
 * agent's first page arrive. The token exists only in the browser, so steps 2 and 3 wait for settings.js.
 */
export class AgentConnectSection {
  static render(model: AgentConnectModel): SafeHtml {
    const { m } = model
    return html`<div class="xxd-settings agent-connect">
${AgentConnectSection.#namingStep(m)}
${AgentConnectSection.#setupStep(model)}
${AgentConnectSection.#checkStep(m)}
<section class="xxd-stack" aria-labelledby="tokens-title">
  <h2 class="xxd-text" data-variant="heading3" id="tokens-title">${m.settings.agents.existingTokens}</h2>
  <div id="token-table"></div>
</section>
${AgentConnectSection.#guidePack(m, model.guideFiles)}
</div>`
  }

  static #namingStep(m: Messages): SafeHtml {
    const { naming } = m.settings.agents
    return html`<section class="xxd-stack" aria-labelledby="connect-name-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="connect-name-title">${naming.title}</h2>
    <p class="xxd-text" data-variant="secondary">${naming.description}</p>
  </div>
  <form class="token-form" id="create-token-form" data-xxd-validate>
    <div class="xxd-field token-form__name">
      <label class="xxd-label" for="token-name">${naming.nameLabel}</label>
      <input class="xxd-input" id="token-name" name="name" required maxlength="80" placeholder="${naming.namePlaceholder}" data-error-required="${naming.nameRequired}">
    </div>
    <div class="xxd-field">
      <label class="xxd-label" for="token-expiry">${naming.expiryLabel}</label>
      <label class="xxd-select"><select id="token-expiry" name="expiresInDays"><option value="90">${naming.expiry[90]}</option><option value="30">${naming.expiry[30]}</option><option value="365">${naming.expiry[365]}</option><option value="never">${naming.expiry.never}</option></select></label>
    </div>
    <fieldset class="xxd-choices token-form__scope">
      <legend class="xxd-label">${naming.scopeLabel}</legend>
      <label class="xxd-choice" for="token-scope-publish"><input type="radio" class="xxd-radio" name="scope" id="token-scope-publish" value="publish" checked><span>${naming.scopes.publish.label}<small>${naming.scopes.publish.description}</small></span></label>
      <label class="xxd-choice" for="token-scope-full"><input type="radio" class="xxd-radio" name="scope" id="token-scope-full" value="full"><span>${naming.scopes.full.label}<small>${naming.scopes.full.description}</small></span></label>
    </fieldset>
    <button type="submit" class="xxd-btn" data-variant="primary">${naming.create}</button>
  </form>
</section>`
  }

  static #setupStep(model: AgentConnectModel): SafeHtml {
    const clientSetups = AgentConnectSection.#clientSetups(model)
    const { setup } = model.m.settings.agents
    return html`<section class="xxd-stack" id="connect-setup" aria-labelledby="connect-setup-title" hidden>
  <h2 class="xxd-text" data-variant="heading3" id="connect-setup-title">${setup.title}</h2>
  <div class="xxd-banner" data-tone="warning" role="status">${PageShell.icon('TriangleAlert')}<div><p class="xxd-banner__title">${setup.tokenOnce}</p></div></div>
  <div class="xxd-field">
    <span class="xxd-label" id="connect-token-label">${setup.tokenOf(html`<span data-token-name></span>`)}</span>
    <div class="xxd-clipboard" aria-labelledby="connect-token-label"><code id="connect-token-value"><span data-token-slot></span></code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="${setup.copyToken}" data-copy-target="#connect-token-value" data-copy-done="${setup.tokenCopied}">${PageShell.icon('Copy', 14)}</button></div>
  </div>
  <p class="xxd-text" data-variant="secondary">${setup.pickClient}</p>
  <div class="xxd-tabs" data-xxd-tabs aria-label="agent">
    ${clientSetups.map((clientSetup, index) => html`<button type="button" role="tab" id="connect-tab-${clientSetup.clientId}" aria-controls="connect-panel-${clientSetup.clientId}" aria-selected="${index === 0 ? 'true' : 'false'}">${clientSetup.name}</button>`)}
  </div>
  ${clientSetups.map((clientSetup, index) => html`<div class="xxd-tabpanel xxd-stack connect-panel" id="connect-panel-${clientSetup.clientId}" ${index === 0 ? '' : new SafeHtml('hidden')}>
    ${clientSetup.clientId === 'http' ? AgentConnectSection.#httpNote(model.m, model.appOrigin) : ''}
    <p class="xxd-text">${clientSetup.placement}</p>
    ${AgentConnectSection.#codeBlock(model.m, clientSetup)}
  </div>`)}
</section>`
  }

  static #httpNote(m: Messages, appOrigin: string): SafeHtml {
    const { setup } = m.settings.agents
    const llmsTxtUrl = `${appOrigin}/llms.txt`
    return html`<p class="xxd-text" data-variant="secondary">${setup.httpNote(html`<code class="xxd-code-inline">X-Open-Artifact-Client</code>`)}</p>
<div class="xxd-clipboard"><code>${llmsTxtUrl}</code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="${setup.copyLlmsTxt}" data-copy="${llmsTxtUrl}">${PageShell.icon('Copy', 14)}</button></div>`
  }

  // One copy button in the corner; the tab above already names the client.
  static #codeBlock(m: Messages, clientSetup: ClientSetup): SafeHtml {
    const { setup } = m.settings.agents
    const snippetHtml = clientSetup.snippet.map(part => (part === TOKEN_SLOT ? html`<span data-token-slot></span>` : part))
    return html`<div class="xxd-code-block connect-snippet">
  <pre class="xxd-code" tabindex="0"><code id="connect-snippet-${clientSetup.clientId}">${snippetHtml}</code></pre>
  <button type="button" class="xxd-btn connect-snippet__copy" data-variant="ghost" data-icon-only data-size="xs" aria-label="${setup.copySnippet(clientSetup.name)}" data-copy-target="#connect-snippet-${clientSetup.clientId}" data-copy-done="${setup.copied}">${PageShell.icon('Copy', 14)}</button>
</div>`
  }

  static #checkStep(m: Messages): SafeHtml {
    const { check } = m.settings.agents
    return html`<section class="xxd-stack" id="connect-check" aria-labelledby="connect-check-title" hidden>
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="connect-check-title">${check.title}</h2>
    <p class="xxd-text" data-variant="secondary">${check.description}</p>
  </div>
  <div class="xxd-clipboard"><code>${check.prompt}</code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="${check.copyPrompt}" data-copy="${check.prompt}">${PageShell.icon('Copy', 14)}</button></div>
  <div id="connect-status" role="status"></div>
</section>`
  }

  static #guidePack(m: Messages, guideFiles: GuideFile<GuidePackFormat>[]): SafeHtml {
    const { guidePack } = m.settings.agents
    return html`<section class="xxd-group" aria-labelledby="guide-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="guide-title">${guidePack.title}</h2>
    <p class="xxd-text" data-variant="secondary">${guidePack.description}</p>
  </div>
  <div class="xxd-group__body">
    ${guideFiles.map(guideFile => {
      const { label, savePath } = guidePack.files[guideFile.format]
      return html`<div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title">${label}</span><span class="xxd-row__desc xxd-mono">${savePath}</span></div>
      <div class="xxd-row__control"><button type="button" class="xxd-btn" data-size="sm" data-copy="${guideFile.content}" data-copy-done="${guidePack.copied(label)}">${PageShell.icon('Copy', 14)}${guidePack.copyContent}</button></div>
    </div>`
    })}
  </div>
</section>`
  }

  static #clientSetups({ m, mcpUrl, appOrigin }: AgentConnectModel): ClientSetup[] {
    const { placements, otherClient, sampleClient, sampleTitle, sampleBody } = m.settings.agents.setup
    const mcpServersJson = (urlKey: string): SnippetPart[] => [
      `{\n  "mcpServers": {\n    "open-artifact": {\n      "${urlKey}": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer `,
      TOKEN_SLOT,
      `" }\n    }\n  }\n}`,
    ]
    return [
      { clientId: 'claude-code', name: 'Claude Code', placement: placements['claude-code'], snippet: [`claude mcp add --transport http open-artifact ${mcpUrl} \\\n  --header "Authorization: Bearer `, TOKEN_SLOT, '"'] },
      { clientId: 'codex', name: 'Codex', placement: placements.codex, snippet: [`[mcp_servers.open-artifact]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer `, TOKEN_SLOT, '" }'] },
      { clientId: 'cursor', name: 'Cursor', placement: placements.cursor, snippet: mcpServersJson('url') },
      { clientId: 'gemini-cli', name: 'Gemini CLI', placement: placements['gemini-cli'], snippet: mcpServersJson('httpUrl') },
      {
        clientId: 'http',
        name: otherClient,
        placement: placements.http,
        snippet: [
          `curl -X POST ${appOrigin}/api/artifacts \\\n  -H "Authorization: Bearer `,
          TOKEN_SLOT,
          `" \\\n  -H "X-Open-Artifact-Client: ${sampleClient}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"${sampleTitle}","files":[{"path":"index.html","content":"<h1>${sampleBody}</h1>"}]}'`,
        ],
      },
    ]
  }
}
