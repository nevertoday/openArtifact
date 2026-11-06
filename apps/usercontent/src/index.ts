import { SigningKey, UsercontentSignature } from '@open-artifact/core'
import type { UsercontentEnv } from './env.ts'
import { UsercontentFiles } from './usercontent-files.ts'

export default {
  async fetch(request: Request, env: UsercontentEnv): Promise<Response> {
    const usercontentSignature = new UsercontentSignature(new SigningKey(env.USERCONTENT_SIGNING_KEY))
    return new UsercontentFiles(env.ARTIFACT_FILES, usercontentSignature, env.APP_ORIGIN).respond(request)
  },
} satisfies ExportedHandler<UsercontentEnv>
