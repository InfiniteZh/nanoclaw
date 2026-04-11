function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function normalizeSessionIdValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function isMalformedSessionIdArtifact(sessionId: string): boolean {
  return /^_?object_[A-Za-z0-9]+_?$/i.test(sessionId);
}

export function sessionIdFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string') {
    return null;
  }

  if (!jid.startsWith('web:')) {
    return null;
  }

  return normalizeSessionIdValue(jid.slice('web:'.length));
}

export function jidFromSessionId(sessionId: unknown): string {
  const normalized = normalizeSessionIdValue(sessionId);
  return normalized ? `web:${normalized}` : 'web:';
}

export function groupFolderFromSessionId(sessionId: unknown): string {
  const normalized = normalizeSessionIdValue(sessionId) || '';
  return `web_session_${sanitizeSessionId(normalized)}`;
}

export function legacyGroupFolderFromSessionId(sessionId: unknown): string {
  const normalized = normalizeSessionIdValue(sessionId) || '';
  return `web_${sanitizeSessionId(normalized)}`;
}

export function groupFolderFromJid(jid: string): string | null {
  const sessionId = sessionIdFromJid(jid);
  return sessionId ? groupFolderFromSessionId(sessionId) : null;
}

export function formatSessionName(sessionId: unknown): string {
  const normalized = normalizeSessionIdValue(sessionId);
  if (!normalized) {
    return 'Web Session';
  }

  return `Web Session ${normalized.slice(0, 8)}`;
}
