import type { Repositories } from '@open-artifact/core'
import { CloudflareAccessTokenRepository } from './cloudflare-access-token-repository.ts'
import { CloudflareArtifactAccessRepository } from './cloudflare-artifact-access-repository.ts'
import { CloudflareArtifactRepository } from './cloudflare-artifact-repository.ts'
import { CloudflareAuditLog } from './cloudflare-audit-log.ts'
import { CloudflareCommentRepository } from './cloudflare-comment-repository.ts'
import { CloudflareInviteRepository } from './cloudflare-invite-repository.ts'
import { CloudflareSharedDataRepository } from './cloudflare-shared-data-repository.ts'
import { CloudflareUserDirectory, CloudflareWorkspaceRepository } from './cloudflare-workspace-repository.ts'

export function cloudflareRepositories(db: D1Database, files: R2Bucket): Repositories {
  return {
    artifacts: new CloudflareArtifactRepository(db, files),
    artifactAccess: new CloudflareArtifactAccessRepository(db),
    comments: new CloudflareCommentRepository(db),
    accessTokens: new CloudflareAccessTokenRepository(db),
    workspaces: new CloudflareWorkspaceRepository(db),
    invites: new CloudflareInviteRepository(db),
    users: new CloudflareUserDirectory(db),
    sharedData: new CloudflareSharedDataRepository(db),
    auditLog: new CloudflareAuditLog(db),
  }
}
