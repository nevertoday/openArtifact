import { api, m, submitOnce, userMessageOf } from '../common.js'

/** The Report button on a public link's viewer and its dialog, which sends the visitor's report to the operator. */
export class ReportDialog {
  #dialog
  #form
  #artifactId

  constructor({ button, dialog, artifactId }) {
    this.#dialog = dialog
    this.#form = dialog.querySelector('[data-report-form]')
    this.#artifactId = artifactId
    button.addEventListener('click', () => Xxd.openDialog(dialog))
    submitOnce(this.#form, () => this.#send())
  }

  async #send() {
    const fields = new FormData(this.#form)
    const report = { reason: fields.get('reason'), details: fields.get('details').trim() || null, contactEmail: fields.get('contactEmail').trim() || null }
    try {
      await api(`/api/artifacts/${encodeURIComponent(this.#artifactId)}/reports`, { method: 'POST', body: report })
    } catch (error) {
      Xxd.toast(m.viewerClient.report.failed(userMessageOf(error)), { tone: 'danger', within: this.#dialog })
      return
    }
    Xxd.closeDialog(this.#dialog)
    this.#form.reset()
    Xxd.toast(m.viewerClient.report.sent, { tone: 'success' })
  }
}
