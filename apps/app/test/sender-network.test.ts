import { describe, expect, it } from 'vitest'
import { SenderNetwork } from '../src/sender-network.ts'

describe('SenderNetwork', () => {
  it('keeps an IPv4 address whole', () => {
    expect(SenderNetwork.ofAddress('203.0.113.7')).toBe('203.0.113.7')
  })

  it('counts every IPv6 address in one /64 as one sender, however it is written', () => {
    const networks = ['2001:db8:1:2::1', '2001:0db8:0001:0002:ffff:ffff:ffff:fffe', '2001:DB8:1:2:0:0:0:9', '2001:db8:1:2::a%eth0'].map(SenderNetwork.ofAddress)

    expect(new Set(networks)).toEqual(new Set(['2001:db8:1:2::/64']))
    expect(SenderNetwork.ofAddress('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64')
    expect(SenderNetwork.ofAddress('::1')).toBe('0:0:0:0::/64')
    expect(SenderNetwork.ofAddress('2001:db8::')).toBe('2001:db8:0:0::/64')
  })

  it('reads an IPv4 address carried in IPv6 as the IPv4 address', () => {
    expect(SenderNetwork.ofAddress('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(SenderNetwork.ofAddress('::ffff:cb00:7107')).toBe('203.0.113.7')
  })

  it('keeps an address it cannot read as it came, so it still limits something', () => {
    expect(SenderNetwork.ofAddress('not:an::address::')).toBe('not:an::address::')
  })

  it('takes the sender from the header Cloudflare sets, and none without it', () => {
    expect(SenderNetwork.of(new Request('http://app.test/', { headers: { 'CF-Connecting-IP': '2001:db8:1:2::77' } }))).toBe('2001:db8:1:2::/64')
    expect(SenderNetwork.of(new Request('http://app.test/'))).toBeNull()
  })
})
