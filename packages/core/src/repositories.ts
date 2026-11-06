import type { AccessTokenRepository } from './access-token-repository.ts'
import type { ArtifactAccessRepository } from './artifact-access-repository.ts'
import type { ArtifactRepository } from './artifact-repository.ts'
import type { CommentRepository } from './comment-repository.ts'
import type { SharedDataRepository } from './shared-data-repository.ts'
import type { UserDirectory, WorkspaceRepository } from './workspace-repository.ts'

/** Every store the app reads and writes, so one storage adapter can supply them all. */
export interface Repositories {
  artifacts: ArtifactRepository
  artifactAccess: ArtifactAccessRepository
  comments: CommentRepository
  accessTokens: AccessTokenRepository
  workspaces: WorkspaceRepository
  users: UserDirectory
  sharedData: SharedDataRepository
}
