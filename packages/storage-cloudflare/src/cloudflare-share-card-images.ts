import type { ShareCardImages } from '@open-artifact/core'

/** Share cards live in the files bucket beside the artifacts, under cards/{owner}/, so purging an owner is one prefix. */
export class CloudflareShareCardImages implements ShareCardImages {
  readonly #files: R2Bucket

  constructor(files: R2Bucket) {
    this.#files = files
  }

  async read(ownerId: string, variant: string): Promise<Uint8Array | null> {
    const storedCard = await this.#files.get(CloudflareShareCardImages.#key(ownerId, variant))
    return storedCard ? new Uint8Array(await storedCard.arrayBuffer()) : null
  }

  async write(ownerId: string, variant: string, png: Uint8Array): Promise<void> {
    await this.#files.put(CloudflareShareCardImages.#key(ownerId, variant), png, { httpMetadata: { contentType: 'image/png' } })
  }

  static prefixOf(ownerId: string): string {
    return `cards/${ownerId}/`
  }

  static #key(ownerId: string, variant: string): string {
    return `${CloudflareShareCardImages.prefixOf(ownerId)}${variant}.png`
  }
}
