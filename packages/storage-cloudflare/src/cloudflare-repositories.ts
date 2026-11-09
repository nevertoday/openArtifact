import type { Repositories } from '@open-artifact/core'
import { CloudflareAccessTokenRepository } from './cloudflare-access-token-repository.ts'
import { CloudflareArtifactAccessRepository } from './cloudflare-artifact-access-repository.ts'
import { CloudflareArtifactRepository } from './cloudflare-artifact-repository.ts'
import { CloudflareAuditLog } from './cloudflare-audit-log.ts'
import { CloudflareCommentRepository } from './cloudflare-comment-repository.ts'
import { CloudflareNotificationRepository } from './cloudflare-notification-repository.ts'
import { CloudflareInviteRepository } from './cloudflare-invite-repository.ts'
import { CloudflareOutboundMailLog } from './cloudflare-outbound-mail-log.ts'
import { CloudflarePublishLog } from './cloudflare-publish-log.ts'
import { CloudflareProfileRepository } from './cloudflare-profile-repository.ts'
import { CloudflareShareCardImages } from './cloudflare-share-card-images.ts'
import { CloudflareSharedDataRepository } from './cloudflare-shared-data-repository.ts'
import { CloudflareSignInCodeFailures } from './cloudflare-sign-in-code-failures.ts'
import { CloudflareUserDirectory, CloudflareWorkspaceRepository } from './cloudflare-workspace-repository.ts'

export function cloudflareRepositories(db: D1Database, files: R2Bucket): Repositories {
  return {
    artifacts: new CloudflareArtifactRepository(db, files),
    artifactAccess: new CloudflareArtifactAccessRepository(db),
    comments: new CloudflareCommentRepository(db),
    notifications: new CloudflareNotificationRepository(db),
    accessTokens: new CloudflareAccessTokenRepository(db),
    workspaces: new CloudflareWorkspaceRepository(db),
    invites: new CloudflareInviteRepository(db),
    users: new CloudflareUserDirectory(db),
    sharedData: new CloudflareSharedDataRepository(db),
    profiles: new CloudflareProfileRepository(db),
    auditLog: new CloudflareAuditLog(db),
    signInCodeFailures: new CloudflareSignInCodeFailures(db),
    shareCardImages: new CloudflareShareCardImages(files),
    outboundMail: new CloudflareOutboundMailLog(db),
    publishLog: new CloudflarePublishLog(db),
  }
}
