import type { AccessTokenRepository } from './access-token-repository.ts'
import type { ArtifactAccessRepository } from './artifact-access-repository.ts'
import type { ArtifactRepository } from './artifact-repository.ts'
import type { AuditLog } from './audit-log.ts'
import type { CommentRepository } from './comment-repository.ts'
import type { NotificationRepository } from './notification-repository.ts'
import type { ProfileRepository } from './profile-repository.ts'
import type { InviteRepository } from './invite-repository.ts'
import type { SharedDataRepository } from './shared-data-repository.ts'
import type { SignInCodeFailures } from './sign-in-code-failures.ts'
import type { UserDirectory, WorkspaceRepository } from './workspace-repository.ts'

/** Every store the app reads and writes, so one storage adapter can supply them all. */
export interface Repositories {
  artifacts: ArtifactRepository
  artifactAccess: ArtifactAccessRepository
  comments: CommentRepository
  notifications: NotificationRepository
  accessTokens: AccessTokenRepository
  workspaces: WorkspaceRepository
  invites: InviteRepository
  users: UserDirectory
  sharedData: SharedDataRepository
  auditLog: AuditLog
  profiles: ProfileRepository
  signInCodeFailures: SignInCodeFailures
}
