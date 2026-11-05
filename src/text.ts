/** `text` on one line, with every run of whitespace turned into a single space */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The number of ASCII digits at the start of `text` */
export function countLeadingDigits(text: string): number {
  let count = 0
  while (text.charAt(count) >= '0' && text.charAt(count) <= '9') count++
  return count
}
