import { ArtifactRemoval, type AuditEvent, type UserDirectory } from '@open-artifact/core'

export interface PersonRef {
  userId: string
  name: string
}

/** How a person is named on screen: the name they set, else the part of their email before the @. */
export class People {
  readonly #users: UserDirectory
  readonly #words: () => Promise<{ deletedPerson: string; operator: string }>

  /** `words` names an account that no longer exists and the operator who took a page down, in the request's language. */
  constructor(users: UserDirectory, words: () => Promise<{ deletedPerson: string; operator: string }>) {
    this.#users = users
    this.#words = words
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

  /** Names for every id; an id whose account was deleted shows as a deleted person. */
  async namesOf(userIds: Iterable<string | null>): Promise<Map<string, string>> {
    const knownIds = [...userIds].filter((userId): userId is string => userId !== null)
    const profiles = await this.#users.profilesOf(knownIds)
    const words = await this.#words()
    return new Map(knownIds.map(userId => {
      const profile = profiles.get(userId)
      if (profile) return [userId, People.displayName(profile)]
      return [userId, userId === ArtifactRemoval.OPERATOR ? words.operator : words.deletedPerson]
    }))
  }
}
