import type { AuditEvent, UserDirectory } from '@open-artifact/core'

export interface PersonRef {
  userId: string
  name: string
}

/** How a person is named on screen: the name they set, else the part of their email before the @. */
export class People {
  readonly #users: UserDirectory

  constructor(users: UserDirectory) {
    this.#users = users
  }

  /** False until the person sets a name; until then others see the part of their email before the @. */
  static hasChosenName(profile: { name: string }): boolean {
    return profile.name.trim().length > 0
  }

  static displayName(profile: { name: string; email: string }): string {
    const chosenName = profile.name.trim()
    return chosenName.length > 0 ? chosenName : (profile.email.split('@')[0] ?? profile.email)
  }

  /** Names of each event's actor and, for a membership change, of the member. */
  namesInAuditEvents(auditEvents: AuditEvent[]): Promise<Map<string, string>> {
    return this.namesOf(auditEvents.flatMap(auditEvent => [auditEvent.actorId, People.memberIdOf(auditEvent)]))
  }

  static memberIdOf(auditEvent: AuditEvent): string | null {
    return auditEvent.targetType === 'member' ? auditEvent.targetId : null
  }

  /** Names for every id; an id whose account was deleted shows as 已删除的用户. */
  async namesOf(userIds: Iterable<string | null>): Promise<Map<string, string>> {
    const knownIds = [...userIds].filter((userId): userId is string => userId !== null)
    const profiles = await this.#users.profilesOf(knownIds)
    return new Map(knownIds.map(userId => {
      const profile = profiles.get(userId)
      return [userId, profile ? People.displayName(profile) : '已删除的用户']
    }))
  }
}
