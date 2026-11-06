import type { ArtifactSummary, GrantRole, PersonGrant } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import type { ApiContext } from './api-context.ts'

interface Notice {
  recipientId: string
  subject: string
  text: string
}

const ROLE_LABELS: Record<GrantRole, string> = { viewer: '可查看', commenter: '可评论', editor: '可编辑' }

/**
 * Mail about who can see an artifact. The change is already saved when a notice goes out, so a failed
 * delivery is logged with its cause and never turns the request into an error.
 */
export class SharingNotices {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  /** Tells each person who can now open the artifact because they are on its list of people. */
  async sharedWith(sharer: Identity, summary: ArtifactSummary, newlyGranted: PersonGrant[]): Promise<void> {
    const viewerUrl = this.#context.viewerUrl(summary.artifactId)
    await this.#notify(
      newlyGranted.map(grant => ({
        recipientId: grant.userId,
        subject: `${sharer.name} 把「${summary.title}」分享给了你`,
        text: `${sharer.name} 把「${summary.title}」分享给了你，你的权限是「${ROLE_LABELS[grant.role]}」。\n\n打开查看：${viewerUrl}`,
      })),
    )
  }

  // The one place sharing mail is sent; each notice goes out on its own, so one failure never stops the others.
  async #notify(notices: Notice[]): Promise<void> {
    if (notices.length === 0) return
    const recipients = await this.#context.repositories.users.profilesOf(notices.map(notice => notice.recipientId))
    const deliveries = await Promise.allSettled(
      notices.map(async notice => {
        const recipient = recipients.get(notice.recipientId)
        if (!recipient) throw new Error(`user ${notice.recipientId} has no profile to mail`)
        await this.#context.mailer.send({ to: recipient.email, subject: notice.subject, text: notice.text })
      }),
    )
    deliveries.forEach((delivery, index) => {
      if (delivery.status === 'rejected') console.error(new Error(`sharing notice to user ${notices[index]?.recipientId} could not be sent`, { cause: delivery.reason }))
    })
  }
}
