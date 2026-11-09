/** A hue picked from a person's name, so one person keeps one colour on every page and in every browser. */
export function avatarHue(name) {
  let hue = 0
  for (const character of (name ?? '').trim().toLowerCase()) hue = (hue * 31 + character.codePointAt(0)) % 360
  return hue
}

export function avatarStyle(name) {
  return `--avatar-hue: ${avatarHue(name)}`
}
