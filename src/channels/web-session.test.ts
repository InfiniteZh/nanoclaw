import { describe, expect, it } from 'vitest';

import {
  formatSessionName,
  groupFolderFromJid,
  groupFolderFromSessionId,
  isMalformedSessionIdArtifact,
  jidFromSessionId,
  sessionIdFromJid,
} from './web-session.js';

describe('web session helpers', () => {
  it('maps web session ids to canonical group folders', () => {
    expect(groupFolderFromSessionId('web_1775479545295_hcj9wt3x4')).toBe(
      'web_session_web_1775479545295_hcj9wt3x4',
    );
  });

  it('derives canonical web group folders from web jids', () => {
    expect(groupFolderFromJid('web:web_1775479545295_hcj9wt3x4')).toBe(
      'web_session_web_1775479545295_hcj9wt3x4',
    );
  });

  it('round-trips between jid and session id', () => {
    const sessionId = 'web_1775479545295_hcj9wt3x4';
    const jid = jidFromSessionId(sessionId);

    expect(jid).toBe('web:web_1775479545295_hcj9wt3x4');
    expect(sessionIdFromJid(jid)).toBe(sessionId);
  });

  it('formats stable human-readable session names', () => {
    expect(formatSessionName('web_1775479545295_hcj9wt3x4')).toBe(
      'Web Session web_1775',
    );
  });

  it('guards against malformed runtime session ids', () => {
    expect(sessionIdFromJid({ bad: true } as never)).toBe(null);
    expect(formatSessionName({ bad: true } as never)).toBe('Web Session');
    expect(isMalformedSessionIdArtifact('_object_Object_')).toBe(true);
    expect(isMalformedSessionIdArtifact('web_1775564484733_iy325d58m')).toBe(
      false,
    );
  });
});
