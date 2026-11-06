import type { ArtifactFileSource } from '@open-artifact/core'

export interface UsercontentEnv {
  ARTIFACT_FILES: ArtifactFileSource
  APP_ORIGIN: string
  /** Shared with the app Worker, which signs the file URLs it hands to viewers. */
  USERCONTENT_SIGNING_KEY: string
}
