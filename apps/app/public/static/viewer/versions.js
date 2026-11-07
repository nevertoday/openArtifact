import { api, element, icon, timeElement, userMessageOf } from '../common.js'
import { BlockDiff } from './block-diff.js'

const WEB_PAGE = '网页'

/**
 * The versions of the artifact and which one is on screen. Showing another version swaps the page in place and
 * keeps the reader's place by block; the address, the version button, the notice about an older version and the
 * full-view link follow it. Announces "shown" after every swap.
 */
export class VersionHistory extends EventTarget {
  #artifactPath
  #frame
  #config
  #button
  #menu
  #notice
  #fullViewLink
  #stage
  #records = new Map()
  #historyLoaded = 'not yet'
  #latest
  #missingVersion

  constructor({ config, frame, button, menu, notice, fullViewLink, stage }) {
    super()
    this.#artifactPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}`
    this.#config = config
    this.#frame = frame
    this.#stage = stage
    this.#button = button
    this.#menu = menu
    this.#notice = notice
    this.#fullViewLink = fullViewLink
    this.#latest = config.currentVersion
    this.#missingVersion = config.missingVersion
    if (config.olderVersion) this.#records.set(config.olderVersion.version, { version: config.olderVersion.version, author: { name: config.olderVersion.authorName }, createdAt: config.olderVersion.publishedAt, publishedVia: null, origin: 'published', note: null })
    menu.addEventListener('toggle', event => { if (event.newState === 'open') this.#renderMenu() })
    menu.addEventListener('xxd:change', event => this.show(Number(event.detail.value)).catch(error => this.#showFailure(error)))
    this.#syncShown()
  }

  get latest() {
    return this.#latest
  }

  get shown() {
    return this.#frame.version
  }

  get isShowingLatest() {
    return this.shown === this.#latest
  }

  /** The version published just before this one, or null for the first. Versions are numbered without gaps. */
  previousOf(version) {
    return version > 1 ? version - 1 : null
  }

  /** Fetches the history again; resolves to the latest version number, or null when the fetch failed. */
  async refresh() {
    const fetched = await api(`${this.#artifactPath}/versions`).catch(() => null)
    if (fetched) {
      this.#records = new Map(fetched.versions.map(record => [record.version, record]))
      this.#latest = Math.max(...this.#records.keys())
    }
    if (this.#historyLoaded !== 'yes') this.#historyLoaded = fetched ? 'yes' : 'failed'
    if (this.#menu.matches(':popover-open')) this.#renderMenu()
    return fetched ? this.#latest : null
  }

  async pageUrlOf(version) {
    return (await api(`${this.#artifactPath}/versions/${version}/page`)).url
  }

  /**
   * Puts a version on screen in place of the current one. Resolves to both pages' blocks; to null when another
   * choice of version took its place before it loaded.
   */
  async show(version) {
    const alreadyShown = version === this.shown && !this.#frame.isReplacing
    if (alreadyShown) return { before: this.#frame.blocks, after: this.#frame.blocks }
    this.#missingVersion = null
    this.#button.setAttribute('aria-busy', 'true')
    const blocks = await this.#frame.replaceWith(await this.pageUrlOf(version), version).finally(() => this.#button.removeAttribute('aria-busy'))
    if (blocks === null) return null
    this.#syncShown()
    this.dispatchEvent(new Event('shown'))
    return blocks
  }

  #showFailure(error) {
    Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#stage })
  }

  #syncShown() {
    const shown = this.shown
    const isOld = !this.isShowingLatest
    this.#button.querySelector('[data-version-label]').textContent = isOld ? `v${shown} · 旧版` : `v${shown}`
    this.#button.toggleAttribute('data-old', isOld)
    this.#button.setAttribute('aria-label', `版本 ${shown}${isOld ? '，不是最新版本' : ''}，选择版本`)
    const versionQuery = isOld ? `?v=${shown}` : ''
    history.replaceState(history.state, '', `${location.pathname}${versionQuery}${location.hash}`)
    this.#fullViewLink?.setAttribute('href', `/a/${encodeURIComponent(this.#config.artifactId)}/full${versionQuery}`)
    this.#renderNotice()
  }

  #describe(record) {
    return [timeElement(record.createdAt), ` · ${VersionHistory.#howPublished(record)}`]
  }

  static #howPublished(record) {
    const author = record.author.name
    switch (record.origin) {
      case 'restored':
        return `${author} 用 v${record.restoredFrom} 覆盖`
      case 'published':
        return record.publishedVia ? `${author} 用 ${record.publishedVia} 发布` : `${author} 在${WEB_PAGE}上发布`
      default:
        throw new Error(`unknown version origin ${record.origin}`)
    }
  }

  #renderNotice() {
    const shown = this.shown
    const record = this.#records.get(shown)
    if (this.#missingVersion !== null) return this.#notice.replaceChildren(VersionHistory.#banner(`没有 v${this.#missingVersion}，显示的是最新的 v${this.#latest}。`, []))
    if (this.isShowingLatest) return this.#notice.replaceChildren()
    const published = record ? ['（', timeElement(record.createdAt), `，${record.author.name} 发布）`] : []
    const showLatest = element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'sm', onClick: () => this.show(this.#latest).catch(error => this.#showFailure(error)) }, '看最新版本')
    const overwrite = this.#config.permissions.canEdit ? element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', 'data-overwrite-with-version': shown }, `用 v${shown} 覆盖最新版本`) : null
    this.#notice.replaceChildren(VersionHistory.#banner([`你在看 v${shown}`, ...published, '，不是最新版本。'], [showLatest, overwrite]))
  }

  static #banner(text, actions) {
    return element('div', { className: 'xxd-banner', 'data-size': 'sm', role: 'status' },
      icon('History'),
      element('p', { className: 'xxd-banner__text' }, text),
      element('div', { className: 'xxd-banner__actions' }, actions),
    )
  }

  #renderMenu() {
    const records = [...this.#records.values()].sort((first, second) => second.version - first.version)
    const items = records.map(record => element('button', { type: 'button', className: 'xxd-menu__item viewer-version-menu__item', role: 'menuitemradio', 'aria-checked': String(record.version === this.shown), 'data-value': record.version },
      element('span', { className: 'viewer-version-menu__text' },
        element('span', { className: 'viewer-version-menu__name' }, `v${record.version}`, record.version === this.#latest ? element('span', { className: 'xxd-badge' }, '最新') : null),
        element('small', {}, this.#describe(record)),
        record.note ? element('small', { className: 'viewer-version-menu__note' }, record.note) : null,
      ),
    ))
    const hasPrevious = this.previousOf(this.shown) !== null
    const compare = element('button', { type: 'button', className: 'xxd-menu__item', role: 'menuitem', disabled: !hasPrevious, 'data-start-compare': true }, icon('Columns2', 14), '和上一版对比')
    const status = this.#historyStatus()
    this.#menu.replaceChildren(...[element('div', { role: 'group', 'aria-label': '版本' }, items), status, element('div', { className: 'xxd-menu__sep', role: 'separator' }), compare].filter(Boolean))
    if (this.#historyLoaded === 'not yet') this.refresh()
  }

  #historyStatus() {
    switch (this.#historyLoaded) {
      case 'yes':
        return null
      case 'not yet':
        return element('p', { className: 'viewer-version-menu__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), '正在加载版本…')
      case 'failed':
        return element('p', { className: 'viewer-version-menu__status' }, '版本没有加载出来，稍后再打开看看。')
      default:
        throw new Error(`unknown history state ${this.#historyLoaded}`)
    }
  }
}

/** Marks what changed against the version before the one on screen, and steps through the changes in page order. */
export class VersionCompare {
  #bar
  #frame
  #versions
  #stage
  #steps = []
  #index = -1
  #comparison = 0

  constructor({ bar, frame, versions, menu, stage }) {
    this.#bar = bar
    this.#frame = frame
    this.#versions = versions
    this.#stage = stage
    menu.addEventListener('click', event => { if (event.target.closest('[data-start-compare]')) this.start() })
    bar.querySelector('[data-compare-next]').addEventListener('click', () => this.step(1))
    bar.querySelector('[data-compare-previous]').addEventListener('click', () => this.step(-1))
    bar.querySelector('[data-compare-exit]').addEventListener('click', () => this.exit())
    versions.addEventListener('shown', () => this.exit())
  }

  get isOpen() {
    return !this.#bar.hidden
  }

  // Each comparison has a number; one that a version switch or 退出对比 has overtaken while loading is dropped.
  async start() {
    const comparison = ++this.#comparison
    const to = this.#versions.shown
    const from = this.#versions.previousOf(to)
    if (from === null) return
    this.#bar.hidden = false
    this.#bar.querySelector('[data-compare-title]').textContent = `对比 v${from} → v${to}`
    const legend = this.#bar.querySelector('[data-compare-legend]')
    legend.replaceChildren(element('span', {}, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), '正在对比…'))
    try {
      const [before] = await Promise.all([this.#versions.pageUrlOf(from).then(url => this.#frame.blocksOf(url)), this.#frame.whenReady()])
      if (comparison !== this.#comparison) return
      if (!before) return this.#fail(`v${from} 没有加载出来，稍后再试。`)
      this.#showDiff(BlockDiff.between(before, this.#frame.blocks))
    } catch (error) {
      if (comparison === this.#comparison) this.#fail(userMessageOf(error))
    }
  }

  #fail(message) {
    this.exit()
    Xxd.toast(message, { tone: 'danger', within: this.#stage })
  }

  exit() {
    this.#comparison++
    if (!this.isOpen) return
    this.#bar.hidden = true
    this.#steps = []
    this.#frame.showDiff(null)
  }

  step(direction) {
    if (this.#steps.length === 0) return
    this.#index = (this.#index + direction + this.#steps.length) % this.#steps.length
    this.#frame.stepTo(this.#steps[this.#index])
  }

  #showDiff(diff) {
    this.#steps = BlockDiff.stepsOf(diff, this.#frame.blocks)
    this.#index = -1
    const kind = (name, mark, label) => element('span', { className: 'viewer-compare__kind', 'data-kind': name }, element('i', { 'aria-hidden': 'true' }, mark), label)
    const legend = BlockDiff.isEmpty(diff)
      ? [element('span', {}, '两个版本的文字一样')]
      : [kind('changed', '改', `改了 ${diff.changed.length} 处`), kind('added', '新', `新增 ${diff.added.length} 处`), kind('removed', '删', `删了 ${diff.removed.length} 处`)]
    this.#bar.querySelector('[data-compare-legend]').replaceChildren(...legend)
    for (const button of this.#bar.querySelectorAll('[data-compare-next], [data-compare-previous]')) button.disabled = this.#steps.length === 0
    this.#frame.showDiff(diff)
    this.step(1)
    this.#bar.querySelector('[data-compare-next]').focus()
  }
}

/**
 * Overwrites the latest version with an older one by publishing its files as a new version, so every version
 * stays in the history. Undo is the same move with the version that was replaced. The new version is shown in place.
 */
export class VersionOverwrite {
  #artifactPath
  #versions
  #stage

  constructor({ config, versions, notice, stage }) {
    this.#artifactPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}`
    this.#versions = versions
    this.#stage = stage
    notice.addEventListener('click', event => {
      const overwriteButton = event.target.closest('[data-overwrite-with-version]')
      if (overwriteButton) this.confirm(Number(overwriteButton.dataset.overwriteWithVersion))
    })
  }

  async confirm(olderVersion) {
    const latest = this.#versions.latest
    const nextVersion = latest + 1
    const confirmed = await Xxd.confirmDialog({
      title: `用 v${olderVersion} 覆盖最新版本？`,
      message: `会发布 v${nextVersion}，内容和 v${olderVersion} 一样。v${latest} 和更早的版本都会保留，随时可以再换回来。`,
      cancelLabel: '取消',
      confirmLabel: `覆盖并发布 v${nextVersion}`,
    })
    if (confirmed) await this.#overwrite(olderVersion, latest)
  }

  async #overwrite(olderVersion, baseVersion) {
    try {
      const { version: publishedVersion } = await api(`${this.#artifactPath}/versions/${olderVersion}/restore`, { method: 'POST', body: { baseVersion } })
      await this.#versions.refresh()
      await this.#versions.show(publishedVersion)
      const undo = { label: '撤销', onClick: () => this.#overwrite(baseVersion, publishedVersion) }
      Xxd.toast(`已用 v${olderVersion} 覆盖最新版本，发布为 v${publishedVersion}`, { tone: 'success', within: this.#stage, action: undo })
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#stage })
    }
  }
}
