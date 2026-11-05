import { relative, resolve } from 'node:path'
import * as v from 'valibot'
import { isSensitiveFilePath, redactSecrets } from '../privacy.ts'
import { collapseWhitespace, countLeadingDigits } from '../text.ts'

export const readToolNames = new Set(['read', 'grep', 'glob', 'lsp', 'web_search'])
export const writeToolNames = new Set(['edit', 'write', 'ast_edit', 'apply_patch'])
export const verifyToolNames = new Set(['bash', 'eval', 'lsp'])

const declarationLinePattern =
  /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+\w+|(?:async\s+)?function\s+\w+|class\s+\w+|def\s+\w+|pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+\w+|func\s+\w+|describe\s*\(|test\s*\(|it\s*\()/

const patchFileHeaders = ['*** Update File:', '*** Add File:', '*** Delete File:']

const optionalText = v.fallback(v.optional(v.string()), undefined)

const toolInputSchema = v.object({
  path: optionalText,
  file: optionalText,
  filePath: optionalText,
  targetFile: optionalText,
  input: optionalText,
  content: optionalText,
  command: optionalText,
  pattern: optionalText,
  query: optionalText,
})

/** The tool arguments the watcher reads, with any non-string value dropped */
export type ToolInput = v.InferOutput<typeof toolInputSchema>

export function parseToolInput(input: Record<string, unknown>): ToolInput {
  return v.parse(toolInputSchema, input)
}

/** Extracts the repo-relative file paths referenced in tool arguments (`read`, `edit`, `write`, `apply_patch`, `grep`) so ReadSet / WriteSet comparisons across peers are deterministic */
export function extractFilePaths(cwd: string, input: ToolInput): string[] {
  const rawPaths = [input.path, input.file, input.filePath, input.targetFile].filter(
    (path): path is string => path !== undefined && path.trim() !== '' && !path.includes('://'),
  )
  for (const line of input.input?.split('\n') ?? []) {
    const header = patchFileHeaders.find(prefix => line.startsWith(prefix))
    if (header !== undefined) rawPaths.push(line.slice(header.length))
  }
  return [...new Set(rawPaths.map(path => toRepoPath(cwd, path)).filter(Boolean))]
}

function toRepoPath(cwd: string, rawPath: string): string {
  let cleaned = rawPath.trim()
  if (cleaned.startsWith('"') || cleaned.startsWith("'")) cleaned = cleaned.slice(1)
  if (cleaned.endsWith('"') || cleaned.endsWith("'")) cleaned = cleaned.slice(0, -1)
  // Drops a `:12-40` line range
  cleaned = cleaned.split(':')[0]
  if (!cleaned) return ''
  const absolutePath = resolve(cwd, cleaned)
  const repoPath = relative(cwd, absolutePath)
  return repoPath && !repoPath.startsWith('..') ? repoPath : absolutePath
}

/**
 * Extracts all top-level/exported symbol declarations + a compact head/tail preview
 * from written or patched code so the detached small model sees 100% of implemented
 * functions even in files >1000 chars without blowing up token count.
 */
export function summarizeCodeChange(label: string, toolName: string, rawContent: string): string {
  if (isSensitiveFilePath(label)) {
    return `--- ${label} (${toolName}) ---\n[REDACTED_SENSITIVE_FILE]`
  }
  const sanitized = redactSecrets(rawContent)
  const declarations = sanitized
    .split('\n')
    .map(line => (line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line).trim())
    .filter(line => declarationLinePattern.test(line))
    .map(line => line.slice(0, 120))
  const declarationHeader =
    declarations.length > 0 ? `Declarations (${declarations.length}): ${declarations.slice(0, 20).join(' ; ')}\n` : ''
  const code = sanitized.trim()
  const preview =
    code.length <= 700
      ? code
      : `${code.slice(0, 400)}\n... [${code.length - 650} chars elided] ...\n${code.slice(-250)}`
  return `--- ${label} (${toolName}) ---\n${declarationHeader}${preview}`
}

/**
 * Extracts a compact (<180 chars) evidence fingerprint from read/grep/glob/lsp/web_search tool output
 * so `detached-smol` can objectively verify whether the main agent actually inspected the target files/symbols
 * without sending thousands of tokens of raw file contents.
 */
export function summarizeReadEvidence(
  toolName: string,
  filePaths: readonly string[],
  input: ToolInput,
  rawOutput: string | undefined,
): string {
  const target =
    filePaths.join(', ') ||
    (input.pattern !== undefined ? `pattern:${input.pattern}` : '') ||
    (input.query !== undefined ? `query:${input.query}` : '') ||
    toolName

  if (filePaths.some(isSensitiveFilePath)) {
    return `${toolName}(${target}) -> [REDACTED_SENSITIVE_FILE]`
  }
  if (rawOutput === undefined || rawOutput.trim() === '') {
    return `${toolName}(${target}) -> read ok`
  }

  const sanitized = redactSecrets(rawOutput)
  const symbols = sanitized
    .split('\n')
    .map(line => withoutLineNumber(line).trim())
    .filter(line => declarationLinePattern.test(line))
    .map(line => line.slice(0, 80))
  if (symbols.length > 0) {
    return `${toolName}(${target}) -> symbols=[${symbols.slice(0, 6).join(' ; ')}]`
  }
  return `${toolName}(${target}) -> snippet="${collapseWhitespace(sanitized).slice(0, 140)}"`
}

/** Drops the `12:` or `12|` line-number prefix that read and grep output put before each line */
function withoutLineNumber(line: string): string {
  const trimmed = line.trimStart()
  const digitCount = countLeadingDigits(trimmed)
  const separator = trimmed.charAt(digitCount)
  return digitCount > 0 && (separator === ':' || separator === '|') ? trimmed.slice(digitCount + 1) : line
}

export function summarizeVerification(
  toolName: string,
  input: ToolInput,
  filePaths: readonly string[],
  rawOutput: string | undefined,
  failed: boolean,
): string {
  const command =
    input.command === undefined ? filePaths.join(', ') || toolName : redactSecrets(input.command).slice(0, 80)
  const outputTail =
    rawOutput !== undefined && rawOutput !== ''
      ? ` | ${failed ? 'error' : 'output'}: ${collapseWhitespace(redactSecrets(rawOutput)).slice(-160)}`
      : ''
  return `${toolName}(${JSON.stringify(command)}) -> ${failed ? 'FAILED' : 'ok (exit 0)'}${outputTail}`
}
