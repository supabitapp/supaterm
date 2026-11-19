export function beginAcpMockPrompt(cancelledSessions: Set<string>, sessionId: string) {
  cancelledSessions.delete(sessionId);
}
