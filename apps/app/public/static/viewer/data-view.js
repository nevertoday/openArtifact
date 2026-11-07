import { api, element, timeElement, userMessageOf } from '../common.js'

/** The data view of the drawer: what the page collected through its shared data, collection by collection. */
export class DataView {
  #element
  #dataPath
  #collections = null

  constructor(dataElement, artifactId) {
    this.#element = dataElement
    this.#dataPath = `/api/artifacts/${encodeURIComponent(artifactId)}/data`
  }

  /** How many documents the page has collected in all; the ⋯ menu names it. */
  async documentCount() {
    const collections = await this.#loadCollections()
    return collections.reduce((total, collection) => total + collection.documentCount, 0)
  }

  async show() {
    this.#element.replaceChildren(element('p', { className: 'viewer-drawer__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), '正在加载数据…'))
    try {
      this.#collections = null
      const collections = await this.#loadCollections()
      if (collections.length === 0) return this.#element.replaceChildren(DataView.#emptyState())
      this.#element.replaceChildren(...await Promise.all(collections.map(collection => this.#collectionSection(collection))))
    } catch (error) {
      this.#element.replaceChildren(element('p', { className: 'viewer-drawer__status' }, `数据没有加载出来：${userMessageOf(error)}`))
    }
  }

  async #loadCollections() {
    this.#collections ??= (await api(this.#dataPath)).collections
    return this.#collections
  }

  static #emptyState() {
    return element('div', { className: 'xxd-empty viewer-data__empty', 'data-size': 'sm' },
      element('p', { className: 'xxd-empty__title' }, '这个页面还没有收集到数据。'),
      element('p', { className: 'xxd-empty__text' }, '报名、投票这类页面收到的内容会显示在这里。'))
  }

  async #collectionSection(collection) {
    const { documents } = await api(`${this.#dataPath}/${encodeURIComponent(collection.collection)}`)
    return element('section', { className: 'xxd-stack viewer-data__collection' },
      element('p', { className: 'xxd-cluster' }, element('span', { className: 'xxd-mono' }, collection.collection), element('span', { className: 'xxd-text', 'data-variant': 'caption' }, `${collection.documentCount} 条`)),
      element('div', { className: 'xxd-table-wrap' }, element('table', { className: 'xxd-table', 'data-density': 'compact' },
        element('thead', {}, element('tr', {}, element('th', {}, 'id'), element('th', {}, '内容'), element('th', {}, '最后修改'))),
        element('tbody', {}, documents.map(sharedDocument => element('tr', {},
          element('td', { className: 'xxd-mono viewer-data__id', title: sharedDocument.id }, sharedDocument.id),
          element('td', { 'data-wrap': true }, element('code', { className: 'xxd-code-inline' }, JSON.stringify(sharedDocument.data))),
          element('td', {}, element('span', { className: 'xxd-text', 'data-variant': 'secondary' }, `${sharedDocument.updatedBy?.name ?? '匿名访客'} · `, timeElement(sharedDocument.updatedAt))),
        ))),
      )),
    )
  }
}
