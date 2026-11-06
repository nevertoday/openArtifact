import type { GuideFile } from '../guide/agent-guide.ts'
import { html, SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

/** Where a new token goes in a snippet; settings.js fills every slot once the token exists. */
const TOKEN_SLOT = Symbol('token slot')
type SnippetPart = string | typeof TOKEN_SLOT

/** How one agent client connects: where the snippet goes, and the snippet with a slot for the token. */
interface ClientSetup {
  /** Stable id for element ids and the tab the person picked. */
  clientId: string
  name: string
  /** One line above the snippet: where to run or paste it. */
  placement: string
  snippet: SnippetPart[]
}

export interface AgentConnectModel {
  mcpUrl: string
  appOrigin: string
  guideFiles: GuideFile[]
}

const TEST_PAGE_PROMPT = '用 open-artifact 发布一个测试页：标题「连接测试」，内容写一句你好。'

/**
 * Settings › Agent 接入 as three steps: name a token, paste the setup with the token already in it, and see the
 * agent's first page arrive. The token exists only in the browser, so steps 2 and 3 wait for settings.js.
 */
export class AgentConnectSection {
  static render(model: AgentConnectModel): SafeHtml {
    return html`<div class="xxd-settings agent-connect">
${AgentConnectSection.#namingStep()}
${AgentConnectSection.#setupStep(model)}
${AgentConnectSection.#checkStep()}
<section class="xxd-stack" aria-labelledby="tokens-title">
  <h2 class="xxd-text" data-variant="heading3" id="tokens-title">已有的 token</h2>
  <div id="token-table"></div>
</section>
${AgentConnectSection.#guidePack(model.guideFiles)}
</div>`
  }

  static #namingStep(): SafeHtml {
    return html`<section class="xxd-stack" aria-labelledby="connect-name-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="connect-name-title">1 · 给这个 agent 起个名字</h2>
    <p class="xxd-text" data-variant="secondary">每个 agent 用自己的 token，丢了或不用了就单独撤销。名字只有你看得到。</p>
  </div>
  <form class="token-form" id="create-token-form" data-xxd-validate>
    <div class="xxd-field token-form__name">
      <label class="xxd-label" for="token-name">名字</label>
      <input class="xxd-input" id="token-name" name="name" required maxlength="80" placeholder="例如 Claude Code · 工作机" data-error-required="给 agent 起个名字，比如它装在哪台机器上">
    </div>
    <div class="xxd-field">
      <label class="xxd-label" for="token-expiry">有效期</label>
      <label class="xxd-select"><select id="token-expiry" name="expiresInDays"><option value="90">90 天</option><option value="30">30 天</option><option value="365">1 年</option><option value="never">永不过期</option></select></label>
    </div>
    <button type="submit" class="xxd-btn" data-variant="primary">新建 token</button>
  </form>
</section>`
  }

  static #setupStep(model: AgentConnectModel): SafeHtml {
    const clientSetups = AgentConnectSection.#clientSetups(model)
    return html`<section class="xxd-stack" id="connect-setup" aria-labelledby="connect-setup-title" hidden>
  <h2 class="xxd-text" data-variant="heading3" id="connect-setup-title">2 · 把配置填进 agent</h2>
  <div class="xxd-banner" data-tone="warning" role="status">${PageShell.icon('TriangleAlert')}<div><p class="xxd-banner__title">这个 token 只显示这一次。离开这个页面后就看不到了。</p></div></div>
  <div class="xxd-field">
    <span class="xxd-label" id="connect-token-label">「<span data-token-name></span>」的 token</span>
    <div class="xxd-clipboard" aria-labelledby="connect-token-label"><code id="connect-token-value"><span data-token-slot></span></code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="复制 token" data-copy-target="#connect-token-value" data-copy-done="已复制 token">${PageShell.icon('Copy', 14)}</button></div>
  </div>
  <p class="xxd-text" data-variant="secondary">选你用的 agent，复制下面的配置，token 已经填好了。改完配置后重启 agent。</p>
  <div class="xxd-tabs" data-xxd-tabs aria-label="agent">
    ${clientSetups.map((clientSetup, index) => html`<button type="button" role="tab" id="connect-tab-${clientSetup.clientId}" aria-controls="connect-panel-${clientSetup.clientId}" aria-selected="${index === 0 ? 'true' : 'false'}">${clientSetup.name}</button>`)}
  </div>
  ${clientSetups.map((clientSetup, index) => html`<div class="xxd-tabpanel xxd-stack connect-panel" id="connect-panel-${clientSetup.clientId}" ${index === 0 ? '' : new SafeHtml('hidden')}>
    ${clientSetup.clientId === 'http' ? AgentConnectSection.#httpNote(model.appOrigin) : ''}
    <p class="xxd-text">${clientSetup.placement}</p>
    ${AgentConnectSection.#codeBlock(clientSetup)}
  </div>`)}
</section>`
  }

  static #httpNote(appOrigin: string): SafeHtml {
    const llmsTxtUrl = `${appOrigin}/llms.txt`
    return html`<p class="xxd-text" data-variant="secondary">不支持 MCP 的 agent 直接调 HTTP API：先让它读 llms.txt，里面写了全部接口；<code class="xxd-code-inline">X-Open-Artifact-Client</code> 填 agent 的名字，大家会看到是谁发布的。</p>
<div class="xxd-clipboard"><code>${llmsTxtUrl}</code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="复制 llms.txt 地址" data-copy="${llmsTxtUrl}">${PageShell.icon('Copy', 14)}</button></div>`
  }

  // One copy button in the corner; the tab above already names the client.
  static #codeBlock(clientSetup: ClientSetup): SafeHtml {
    const snippetHtml = clientSetup.snippet.map(part => (part === TOKEN_SLOT ? html`<span data-token-slot></span>` : part))
    return html`<div class="xxd-code-block connect-snippet">
  <pre class="xxd-code" tabindex="0"><code id="connect-snippet-${clientSetup.clientId}">${snippetHtml}</code></pre>
  <button type="button" class="xxd-btn connect-snippet__copy" data-variant="ghost" data-icon-only data-size="xs" aria-label="复制 ${clientSetup.name} 配置" data-copy-target="#connect-snippet-${clientSetup.clientId}" data-copy-done="已复制">${PageShell.icon('Copy', 14)}</button>
</div>`
  }

  static #checkStep(): SafeHtml {
    return html`<section class="xxd-stack" id="connect-check" aria-labelledby="connect-check-title" hidden>
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="connect-check-title">3 · 让 agent 发布一个测试页</h2>
    <p class="xxd-text" data-variant="secondary">重启 agent 后，把这句话发给它。页面发布后，这里会告诉你。</p>
  </div>
  <div class="xxd-clipboard"><code>${TEST_PAGE_PROMPT}</code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="复制这句话" data-copy="${TEST_PAGE_PROMPT}">${PageShell.icon('Copy', 14)}</button></div>
  <div id="connect-status" role="status"></div>
</section>`
  }

  static #guidePack(guideFiles: GuideFile[]): SafeHtml {
    return html`<section class="xxd-group" aria-labelledby="guide-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="guide-title">指南包</h2>
    <p class="xxd-text" data-variant="secondary">告诉 agent 什么时候发布、页面要遵守什么约定、该更新而不是新建。已经填好本实例的地址。</p>
  </div>
  <div class="xxd-group__body">
    ${guideFiles.map(guideFile => html`<div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title">${guideFile.label}</span><span class="xxd-row__desc xxd-mono">${guideFile.savePath}</span></div>
      <div class="xxd-row__control"><button type="button" class="xxd-btn" data-size="sm" data-copy="${guideFile.content}" data-copy-done="已复制 ${guideFile.label}">${PageShell.icon('Copy', 14)}复制内容</button></div>
    </div>`)}
  </div>
</section>`
  }

  static #clientSetups({ mcpUrl, appOrigin }: AgentConnectModel): ClientSetup[] {
    const mcpServersJson = (urlKey: string): SnippetPart[] => [
      `{\n  "mcpServers": {\n    "open-artifact": {\n      "${urlKey}": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer `,
      TOKEN_SLOT,
      `" }\n    }\n  }\n}`,
    ]
    return [
      { clientId: 'claude-code', name: 'Claude Code', placement: '在终端运行：', snippet: [`claude mcp add --transport http open-artifact ${mcpUrl} \\\n  --header "Authorization: Bearer `, TOKEN_SLOT, '"'] },
      { clientId: 'codex', name: 'Codex', placement: '加到 ~/.codex/config.toml：', snippet: [`[mcp_servers.open-artifact]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer `, TOKEN_SLOT, '" }'] },
      { clientId: 'cursor', name: 'Cursor', placement: '加到项目里的 .cursor/mcp.json，或者全局的 ~/.cursor/mcp.json：', snippet: mcpServersJson('url') },
      { clientId: 'gemini-cli', name: 'Gemini CLI', placement: '加到 ~/.gemini/settings.json：', snippet: mcpServersJson('httpUrl') },
      {
        clientId: 'http',
        name: '其他（HTTP）',
        placement: '发布一个页面试试：',
        snippet: [
          `curl -X POST ${appOrigin}/api/artifacts \\\n  -H "Authorization: Bearer `,
          TOKEN_SLOT,
          `" \\\n  -H "X-Open-Artifact-Client: 我的脚本" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"连接测试","files":[{"path":"index.html","content":"<h1>你好</h1>"}]}'`,
        ],
      },
    ]
  }
}
