import type { PeerSyncMessage } from './broker.ts'

/**
 * Formats drained `PeerSyncMessage[]` as an XML-wrapped, Zero-ACK advisory block
 * suitable for `tool_result.additionalContext`.
 */
export function formatPeerSyncNotices(messages: readonly PeerSyncMessage[]): string {
  return messages
    .map(message => {
      const attributes = [
        `from="@${message.fromPeerId}"`,
        `kind="${message.kind}"`,
        message.completedTask === undefined ? '' : `milestone=${JSON.stringify(message.completedTask)}`,
        message.touchedFiles.length > 0 ? `files=${JSON.stringify(message.touchedFiles.join(','))}` : '',
        message.exportedSymbols.length > 0 ? `symbols=${JSON.stringify(message.exportedSymbols.join(','))}` : '',
        `policy="zero-ack: adapt your code directly if affected; NEVER send thank-you or acknowledgment messages"`,
      ]
        .filter(Boolean)
        .join(' ')
      return `<peer-sync ${attributes}>\n${message.summary}\n</peer-sync>`
    })
    .join('\n')
}
