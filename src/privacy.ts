import picomatch from 'picomatch'

const matchesSensitiveFile = picomatch(
  [
    '**/.env',
    '**/.env.*',
    '**/.env.*/**',
    '**/.npmrc',
    '**/.pypirc',
    '**/.netrc',
    '**/.git-credentials',
    '**/id_{rsa,ed25519,ecdsa,dsa}{,.*}',
    '**/*.{pem,key,p12,pfx,keystore,jks}',
    '**/*{secret,credential,token,passwd,password}{,s}.{json,yaml,yml,toml,ini,conf}',
    '**/.ssh/**',
    '**/.aws/**',
    '**/.gnupg/**',
  ],
  { dot: true, nocase: true },
)

const secretPatterns: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(Bearer\s+)[\w.~+/=-]{16,}\b/gi, '$1[REDACTED_TOKEN]'],
  [
    /\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,})\b/g,
    '[REDACTED_SECRET]',
  ],
  [
    /\b(\w*(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\w*\s*[:=]\s*)(['"]?)[^\s'"`,;]{8,}\2/gi,
    '$1$2[REDACTED]$2',
  ],
]

/**
 * Checks whether a file path points to a credential/secret/key file whose contents
 * must NEVER be extracted into sidecar prompts or git diff snippets.
 */
export function isSensitiveFilePath(filePath: string): boolean {
  const normalized = filePath.trim().replaceAll('\\', '/')
  return normalized !== '' && matchesSensitiveFile(normalized)
}

/**
 * Redacts API keys, Bearer tokens, PEM private keys, JWTs, and secret assignments
 * before any text is sent to an external Sidecar LLM or persisted to SQLite.
 */
export function redactSecrets(text: string): string {
  return secretPatterns.reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), text)
}
