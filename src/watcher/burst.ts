/** Tool activity and assistant notes accumulated since the last sidecar check */
export class Burst {
  writes = 0
  verifications = 0
  reads = 0
  substantiveTextLength = 0
  verificationFailed = false
  userPrompted = false
  readonly touchedFiles = new Set<string>()
  readonly toolActions: string[] = []
  readonly readEvidence: string[] = []
  readonly codeSnippets: string[] = []
  readonly assistantNotes: string[] = []

  get hasPendingActivity(): boolean {
    // Trigger on write bursts, verification runs, user prompts, OR when an investigation/read burst
    // produces a substantive analytical summary (>= 80 chars of findings/analysis).
    const hasReadSynthesis = this.reads > 0 && this.substantiveTextLength >= 80
    return this.writes > 0 || this.verifications > 0 || hasReadSynthesis || this.userPrompted
  }

  get hasToolActivity(): boolean {
    return this.writes > 0 || this.verifications > 0 || this.reads > 0
  }

  addReadEvidence(evidence: string): void {
    pushRecent(this.readEvidence, evidence, 8)
  }

  addCodeSnippet(snippet: string): void {
    pushRecent(this.codeSnippets, snippet, 4)
  }

  addAssistantNote(note: string): void {
    pushRecent(this.assistantNotes, note, 4)
  }
}

function pushRecent(items: string[], item: string, limit: number): void {
  items.push(item)
  if (items.length > limit) items.shift()
}
