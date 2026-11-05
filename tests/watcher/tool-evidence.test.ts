import { describe, expect, it } from 'vitest'
import { parseToolInput, summarizeCodeChange, summarizeReadEvidence } from '../../src/watcher/tool-evidence.ts'

describe('tool evidence', () => {
  it('summarizes a large code change with every declaration and an elided body', () => {
    const padding = '// comment padding line\n'.repeat(60)
    const code = `export function add(a: number, b: number) { return a + b; }\n${padding}\nexport function divide(a: number, b: number) { return a / b; }`

    const summary = summarizeCodeChange('src/calc.ts', 'write', code)

    expect(summary).toContain(
      'Declarations (2): export function add(a: number, b: number) { return a + b; } ; export function divide(a: number, b: number)',
    )
    expect(summary).toContain('chars elided')
  })

  it('fingerprints grep output by the declarations it matched', () => {
    const evidence = summarizeReadEvidence(
      'grep',
      ['src'],
      parseToolInput({ pattern: 'isExpired' }),
      '12: export function isExpired() {}',
    )

    expect(evidence).toBe('grep(src) -> symbols=[export function isExpired() {}]')
  })

  it('never summarizes the contents of sensitive files', () => {
    const envSummary = summarizeCodeChange('.env.local', 'write', 'OPENAI_API_KEY=sk-proj-1234567890abcdefghij')
    expect(envSummary).toContain('[REDACTED_SENSITIVE_FILE]')
    expect(envSummary).not.toContain('sk-proj-')

    const keyRead = summarizeReadEvidence(
      'read',
      ['~/.ssh/id_ed25519'],
      parseToolInput({}),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
    )
    expect(keyRead).toContain('[REDACTED_SENSITIVE_FILE]')
    expect(keyRead).not.toContain('PRIVATE KEY')
  })
})
