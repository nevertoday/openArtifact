import { m, userMessageOf } from '../common.js'
import { BlockDiff } from './block-diff.js'

const LIVE_REFRESH_MS = 15_000

/**
 * Keeps the open page current while the tab is visible: comments others write, versions others publish, and the
 * moment an agent answers the reader's own comment with a new version. Then the new version takes the old one's
 * place without losing the reader's spot, the blocks it changed light up, and the pin turns into a check.
 */
export class LiveUpdates {
  #threads
  #versions
  #frame
  #list
  #drawer
  #stage
  #announcedVersion
  #heldVersion = null
  #followsLatest

  constructor({ threads, versions, frame, list, drawer, stage }) {
    this.#threads = threads
    this.#versions = versions
    this.#frame = frame
    this.#list = list
    this.#drawer = drawer
    this.#stage = stage
    this.#announcedVersion = versions?.latest ?? null
    // Whoever opened an older version on purpose is reading history; only a reader on the latest one is moved on.
    this.#followsLatest = versions?.isShowingLatest ?? false
    versions?.addEventListener('shown', () => { this.#followsLatest = versions.isShowingLatest })
  }

  start() {
    setInterval(() => this.#check(), LIVE_REFRESH_MS)
    document.addEventListener('visibilitychange', () => this.#check())
  }

  // A failed fetch keeps what is on screen; the next check tries again.
  async #check() {
    if (document.visibilityState !== 'visible') return
    const [commentChanges] = await Promise.all([this.#threads.refresh(), this.#versions?.refresh()])
    if (commentChanges) this.#list.noteArrived(commentChanges.arrived)
    const fixedForMe = commentChanges?.fixedForMe ?? []
    if (fixedForMe.length > 0) return this.#showAgentFix(fixedForMe)
    this.#offerNewVersion()
  }

  #hasNewerVersion() {
    return this.#versions !== null && this.#versions.latest > this.#frame.version
  }

  async #showAgentFix(fixedThreads) {
    const agentName = fixedThreads[0].agentReply?.postedVia ?? 'agent'
    this.#announcedVersion = this.#versions?.latest ?? null
    if (!this.#drawer.isSheet) this.#list.select(fixedThreads[0].id, { reveal: false })
    const changedPaths = this.#followsLatest && this.#hasNewerVersion() ? await this.#changesOnLatest() : []
    if (changedPaths.length > 0) this.#frame.wash(changedPaths, { scroll: false })
    Xxd.toast(m.viewerClient.liveUpdates.fixed(agentName), { tone: 'success', within: this.#stage, action: this.#nextStepAfterFix(changedPaths) })
  }

  // The changes when the new version is on screen; else a way to it when there is one.
  #nextStepAfterFix(changedPaths) {
    if (changedPaths.length > 0) return { label: m.viewerClient.liveUpdates.seeChanges, onClick: () => this.#frame.wash(changedPaths, { scroll: true }) }
    if (this.#hasNewerVersion()) return { label: m.viewerClient.liveUpdates.seeLatest, onClick: () => this.#showLatestAndChanges() }
    return undefined
  }

  // Someone published while the reader was on the latest version: offered, not forced, since it moves the page.
  // While the reader waits for an agent, the version is held back one check: it is likely the agent's answer.
  #offerNewVersion() {
    const latest = this.#versions?.latest ?? null
    const isNewToReader = latest !== null && latest !== this.#announcedVersion && this.#hasNewerVersion()
    if (!this.#followsLatest || !isNewToReader) return
    const holdForAgent = this.#threads.isWaitingForAgent && this.#heldVersion !== latest
    if (holdForAgent) {
      this.#heldVersion = latest
      return
    }
    this.#announcedVersion = latest
    Xxd.toast(m.viewerClient.liveUpdates.published(latest), { within: this.#stage, action: { label: m.viewerClient.liveUpdates.seeNew, onClick: () => this.#showLatestAndChanges() } })
  }

  // The agent's answer stands even when its new version cannot be shown; the toast then offers it instead.
  async #changesOnLatest() {
    try {
      return await this.#showLatest()
    } catch (error) {
      reportError(error)
      return []
    }
  }

  // A swap that another choice of version overtook has nothing to show.
  async #showLatest() {
    const blocks = await this.#versions.show(this.#versions.latest)
    return blocks ? BlockDiff.changedPaths(BlockDiff.between(blocks.before, blocks.after)) : []
  }

  async #showLatestAndChanges() {
    try {
      this.#frame.wash(await this.#showLatest(), { scroll: true })
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#stage })
    }
  }
}
