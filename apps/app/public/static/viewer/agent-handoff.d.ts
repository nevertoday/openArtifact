export interface HandedOffArtifact {
  artifactId: string
  title: string
  version: number
  url: string
  guideUrl: string
}

export interface HandedOffThread {
  number: number
  root: {
    commentId: string
    body: string
    author: { name: string }
    anchor: { version: number | null; selector: string | null; textQuote: string | null; quote: { exact: string } | null } | null
  }
}

export class AgentHandoff {
  constructor(artifact: HandedOffArtifact)
  promptFor(threads: HandedOffThread[]): string
}
