import { describe, expect, it } from 'vitest'
import { ArtifactPath, ArtifactSlug, ShortId } from '../src/artifact-address.ts'

describe('ShortId', () => {
  it('is twelve characters from 0-9 and a-z, different every time', () => {
    const shortIds = Array.from({ length: 200 }, () => ShortId.generate())

    for (const shortId of shortIds) expect(shortId).toMatch(/^[0-9a-z]{12}$/)
    expect(new Set(shortIds).size).toBe(shortIds.length)
  })

  it('uses every character of the alphabet', () => {
    const seen = new Set(Array.from({ length: 300 }, () => ShortId.generate()).join(''))

    expect(seen.size).toBe(36)
  })
})

describe('ArtifactSlug', () => {
  it('keeps the ASCII words of a title in lower case, joined by single dashes', () => {
    expect(ArtifactSlug.normalize('UI 细节对比：Open Artifact × 小小东')).toBe('ui-open-artifact')
    expect(ArtifactSlug.normalize('  Q3 -- Sales__Review!! ')).toBe('q3-sales-review')
    expect(ArtifactSlug.normalize('Café déjà vu')).toBe('cafe-deja-vu')
    expect(ArtifactSlug.normalize('ＵＩ 设计')).toBe('ui')
  })

  it('is empty when the text has no ASCII words', () => {
    expect(ArtifactSlug.normalize('季度销售复盘')).toBe('')
    expect(ArtifactSlug.normalize('---')).toBe('')
  })

  it('stops at the last whole word within 60 characters', () => {
    const slug = ArtifactSlug.normalize('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo')

    expect(slug).toBe('alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india')
    expect(ArtifactSlug.normalize('x'.repeat(80))).toBe('x'.repeat(60))
  })

  it('prefers the words the publisher chose, and falls back to the title when they normalize to nothing', () => {
    expect(ArtifactSlug.forNewArtifact('Quarterly Sales Review', '季度销售复盘')).toBe('quarterly-sales-review')
    expect(ArtifactSlug.forNewArtifact('季度', 'Roadmap 2027')).toBe('roadmap-2027')
    expect(ArtifactSlug.forNewArtifact(null, '季度销售复盘')).toBe('')
  })

  it('takes the words of a translated title over the title\'s own, unless the translation keeps none', () => {
    expect(ArtifactSlug.forNewArtifact(null, 'pstack 使用指南', 'pstack User Guide')).toBe('pstack-user-guide')
    expect(ArtifactSlug.forNewArtifact('guide', 'pstack 使用指南', 'pstack User Guide')).toBe('guide')
    expect(ArtifactSlug.forNewArtifact(null, 'pstack 使用指南', '使用指南')).toBe('pstack')
    expect(ArtifactSlug.afterChange('', null, '季度销售复盘', 'Quarterly sales review')).toBe('quarterly-sales-review')
    expect(ArtifactSlug.afterChange('roadmap', null, '季度销售复盘', 'Quarterly sales review')).toBe('roadmap')
  })

  it('asks for a translation only when Chinese words of the title would make the address', () => {
    expect(ArtifactSlug.needsEnglishTitle(null, '季度销售复盘')).toBe(true)
    expect(ArtifactSlug.needsEnglishTitle(null, 'pstack 使用指南')).toBe(true)
    expect(ArtifactSlug.needsEnglishTitle(null, 'Roadmap 2027')).toBe(false)
    expect(ArtifactSlug.needsEnglishTitle('quarterly-review', '季度销售复盘')).toBe(false)
    expect(ArtifactSlug.needsEnglishTitle('季度', '季度销售复盘')).toBe(true)
    expect(ArtifactSlug.takesWordsFromTitle('', null, '季度销售复盘')).toBe(true)
    expect(ArtifactSlug.takesWordsFromTitle('roadmap', null, '季度销售复盘')).toBe(false)
    expect(ArtifactSlug.takesWordsFromTitle('', null, null)).toBe(false)
  })

  it('keeps the words of links already sent when only the title changes', () => {
    expect(ArtifactSlug.afterChange('roadmap', null, 'Launch plan')).toBe('roadmap')
    expect(ArtifactSlug.afterChange('roadmap', 'launch-plan', null)).toBe('launch-plan')
    expect(ArtifactSlug.afterChange('', null, 'Launch plan')).toBe('launch-plan')
    expect(ArtifactSlug.afterChange('', null, null)).toBe('')
  })
})

describe('ArtifactPath', () => {
  it('puts the words before the short id, or the short id alone', () => {
    expect(ArtifactPath.of({ slug: 'ui-design-comparison', shortId: 'k7f3q9x2m4ab' })).toBe('/a/ui-design-comparison-k7f3q9x2m4ab')
    expect(ArtifactPath.of({ slug: '', shortId: 'k7f3q9x2m4ab' }, 'full')).toBe('/a/k7f3q9x2m4ab/full')
  })

  it('reads the short id after the last dash and ignores the words', () => {
    expect(ArtifactPath.parse('ui-design-comparison-k7f3q9x2m4ab')).toEqual({ kind: 'short_id', shortId: 'k7f3q9x2m4ab' })
    expect(ArtifactPath.parse('wrong-words-k7f3q9x2m4ab')).toEqual({ kind: 'short_id', shortId: 'k7f3q9x2m4ab' })
    expect(ArtifactPath.parse('K7F3Q9X2M4AB')).toEqual({ kind: 'short_id', shortId: 'k7f3q9x2m4ab' })
  })

  it('reads an artifact id from links sent before short ids, though its last part looks like one', () => {
    expect(ArtifactPath.parse('3491a93b-f46c-45f9-b006-9be3110d2512')).toEqual({ kind: 'artifact_id', artifactId: '3491a93b-f46c-45f9-b006-9be3110d2512' })
  })

  it('names nothing when no short id ends the segment', () => {
    expect(ArtifactPath.parse('no-such-artifact')).toBeNull()
    expect(ArtifactPath.parse('roadmap-k7f3q9x2m4a')).toBeNull()
    expect(ArtifactPath.parse('')).toBeNull()
  })
})
