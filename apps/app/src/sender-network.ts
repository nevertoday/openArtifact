const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The network a request came from, as the rate limits on requests from nobody in particular count it. An IPv4
 * address is one sender. An IPv6 sender usually holds a whole /64 and can change addresses inside it at will, so
 * every address in one /64 counts as one sender.
 */
export class SenderNetwork {
  /** null when the request names no sender: Cloudflare always names it, so this is local development or a test. */
  static of(request: Request): string | null {
    const address = request.headers.get('CF-Connecting-IP')
    return address === null ? null : SenderNetwork.ofAddress(address)
  }

  static ofAddress(address: string): string {
    const trimmed = address.trim().toLowerCase().split('%')[0] ?? ''
    if (!trimmed.includes(':')) return trimmed
    const groups = SenderNetwork.#ipv6Groups(trimmed)
    if (groups === null) return trimmed
    const mappedIpv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff
    if (mappedIpv4) return [groups[6] ?? 0, groups[7] ?? 0].flatMap(group => [group >> 8, group & 0xff]).join('.')
    return `${groups.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`
  }

  // The eight 16-bit groups, with "::" filled in and a dotted IPv4 tail split in two; null for anything else.
  static #ipv6Groups(address: string): number[] | null {
    const halves = address.split('::')
    if (halves.length > 2) return null
    const groupsOf = (half: string | undefined): number[] | null => {
      if (!half) return []
      const groups: number[] = []
      for (const part of half.split(':')) {
        if (IPV4.test(part)) {
          const [a = 0, b = 0, c = 0, d = 0] = part.split('.').map(Number)
          groups.push((a << 8) | b, (c << 8) | d)
        } else if (/^[0-9a-f]{1,4}$/.test(part)) {
          groups.push(parseInt(part, 16))
        } else {
          return null
        }
      }
      return groups
    }
    const head = groupsOf(halves[0])
    const tail = groupsOf(halves[1])
    if (head === null || tail === null) return null
    if (halves.length === 1) return head.length === 8 ? head : null
    const missing = 8 - head.length - tail.length
    return missing < 1 ? null : [...head, ...Array<number>(missing).fill(0), ...tail]
  }
}
