/**
 * The pictures shown when a link is shared, each drawn once and kept. `variant` names one drawing of the owner,
 * an artifact or a personal page, and always means the same picture, so a stored one never goes stale.
 */
export interface ShareCardImages {
  read(ownerId: string, variant: string): Promise<Uint8Array | null>
  write(ownerId: string, variant: string, png: Uint8Array): Promise<void>
}
