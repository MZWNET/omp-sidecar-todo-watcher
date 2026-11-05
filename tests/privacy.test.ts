import { describe, expect, it } from 'vitest'
import { isSensitiveFilePath, redactSecrets } from '../src/privacy.ts'

describe('privacy', () => {
  it.each([
    '.env',
    'config/.env.production',
    '/home/user/.ssh/id_rsa',
    '.ssh/config',
    'certs/server.pem',
    'config/secrets.json',
  ])('treats %s as sensitive', filePath => {
    expect(isSensitiveFilePath(filePath)).toBe(true)
  })

  it('treats ordinary source files as safe', () => {
    expect(isSensitiveFilePath('src/auth.ts')).toBe(false)
  })

  it('scrubs API tokens, bearer tokens, secret assignments, and PEM keys', () => {
    const scrubbed = redactSecrets(
      [
        "const key = 'sk-1234567890abcdefghijklmnop';",
        'const gh = "ghp_1234567890abcdefghijklmnopqrstuv";',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      ].join('\n'),
    )

    expect(scrubbed).not.toContain('sk-1234567890')
    expect(scrubbed).not.toContain('ghp_1234567890')
    expect(scrubbed).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(scrubbed).not.toContain('wJalrXUtnFEMI')
    expect(scrubbed).not.toContain('MIIEowIBAAKCAQEA')
    expect(scrubbed).toContain('[REDACTED_SECRET]')
    expect(scrubbed).toContain('[REDACTED_PRIVATE_KEY]')
  })
})
