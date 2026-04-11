import fs from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import type { WebHistoryEntry } from 'nanoclaw-web-ui';
import { DATA_DIR } from '../config.js';

const serverInstances: MockWebUIServer[] = [];
const getAllChats = vi.fn();
const getChatHistory = vi.fn();
const storeMessageDirect = vi.fn();
const createdPaths: string[] = [];

class MockWebUIServer {
  options: any;
  started = false;
  stopped = false;
  sentMessages: Array<{ sessionId: string; payload: any }> = [];

  constructor(options: any) {
    this.options = options;
    serverInstances.push(this);
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  sendToSession(sessionId: string, payload: any): boolean {
    this.sentMessages.push({ sessionId, payload });
    return true;
  }
}

vi.mock('nanoclaw-web-ui', () => ({
  WebUIServer: MockWebUIServer,
}));

vi.mock('../db.js', () => ({
  getAllChats,
  getChatHistory,
  storeMessageDirect,
}));

describe('Web channel factory', () => {
  afterEach(() => {
    while (createdPaths.length > 0) {
      const target = createdPaths.pop();
      if (target && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  });

  beforeEach(() => {
    vi.resetModules();
    serverInstances.length = 0;
    getAllChats.mockReset();
    getChatHistory.mockReset();
    storeMessageDirect.mockReset();
    getAllChats.mockReturnValue([]);
    getChatHistory.mockReturnValue([]);
    delete process.env.WEB_UI_PORT;
    delete process.env.WEB_UI_HOST;
    delete process.env.WEB_UI_AUTH_TOKEN;
  });

  it('registers the web channel and creates a channel instance', async () => {
    const registry = await import('./registry.js');
    await import('./web.js');

    const factory = registry.getChannelFactory('web');
    expect(factory).toBeDefined();

    const channel = factory!({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    expect(channel).not.toBeNull();
    expect(channel!.name).toBe('web');
    expect(channel!.ownsJid('web:test_session')).toBe(true);
  });

  it('starts the web UI server, forwards inbound messages, and sends assistant replies back to the session', async () => {
    const inboundMessages: Array<{ jid: string; content: string }> = [];
    const metadataCalls: Array<{ jid: string; name?: string }> = [];

    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: (jid, message) => {
        inboundMessages.push({ jid, content: message.content });
      },
      onChatMetadata: (jid, _timestamp, name) => {
        metadataCalls.push({ jid, name });
      },
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(serverInstances).toHaveLength(1);
    expect(serverInstances[0].started).toBe(true);

    await serverInstances[0].options.onMessage({
      id: 'msg_1',
      chatJid: 'web:test_session',
      sender: 'user',
      senderName: 'Tester',
      content: 'hello from web',
      timestamp: '2026-04-06T12:00:00.000Z',
    });

    expect(inboundMessages).toEqual([
      {
        jid: 'web:test_session',
        content: 'hello from web',
      },
    ]);
    expect(metadataCalls).toEqual([
      {
        jid: 'web:test_session',
        name: 'Web Session test_ses',
      },
    ]);

    await channel.sendMessage('web:test_session', 'assistant reply');

    expect(serverInstances[0].sentMessages).toEqual([
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'message',
          from: 'assistant',
          content: 'assistant reply',
        }),
      },
    ]);

    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
    expect(serverInstances[0].stopped).toBe(true);
  });

  it('exposes active sessions and in-memory history to the web ui server', async () => {
    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    await serverInstances[0].options.onMessage({
      id: 'msg_1',
      chatJid: 'test_session',
      sender: 'user',
      senderName: 'Tester',
      content: 'hello from web',
      timestamp: '2026-04-06T12:00:00.000Z',
    });

    await channel.sendMessage('web:test_session', 'assistant reply');

    const sessions = await serverInstances[0].options.onFetchSessions();
    const history = (await serverInstances[0].options.onFetchHistory(
      'test_session',
    )) as WebHistoryEntry[];

    expect(sessions).toContainEqual(
      expect.objectContaining({
        sessionId: 'test_session',
        name: 'Web Session test_ses',
      }),
    );
    expect(history).toEqual([
      {
        from: 'user',
        content: 'hello from web',
        timestamp: '2026-04-06T12:00:00.000Z',
      },
      expect.objectContaining({
        from: 'assistant',
        content: 'assistant reply',
      }),
    ]);
  });

  it('restores persisted web sessions and history from the database', async () => {
    getAllChats.mockReturnValue([
      {
        jid: 'web:existing_session',
        name: 'Existing Session',
        last_message_time: '2026-04-06T10:00:00.000Z',
        channel: 'web',
        is_group: 0,
      },
    ]);
    getChatHistory.mockReturnValue([
      {
        id: 'msg_user',
        chat_jid: 'web:existing_session',
        sender: 'existing_session',
        sender_name: 'User',
        content: 'persisted question',
        timestamp: '2026-04-06T09:59:00.000Z',
        is_from_me: 0,
      },
      {
        id: 'msg_bot',
        chat_jid: 'web:existing_session',
        sender: 'Andy',
        sender_name: 'Andy',
        content: 'persisted answer',
        timestamp: '2026-04-06T10:00:00.000Z',
        is_from_me: 1,
      },
    ]);

    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const sessions = await serverInstances[0].options.onFetchSessions();
    const history =
      await serverInstances[0].options.onFetchHistory('existing_session');

    expect(sessions).toContainEqual({
      sessionId: 'existing_session',
      name: 'Existing Session',
      lastActivity: '2026-04-06T10:00:00.000Z',
    });
    expect(history).toEqual([
      {
        from: 'user',
        content: 'persisted question',
        timestamp: '2026-04-06T09:59:00.000Z',
      },
      {
        from: 'assistant',
        content: 'persisted answer',
        timestamp: '2026-04-06T10:00:00.000Z',
      },
    ]);
  });

  it('filters malformed persisted web sessions instead of surfacing Web Session [object names', async () => {
    getAllChats.mockReturnValue([
      {
        jid: { bad: true },
        name: 'Broken Session',
        last_message_time: '2026-04-06T10:00:00.000Z',
        channel: 'web',
        is_group: 0,
      },
      {
        jid: 'web:valid_session',
        name: { bad: true },
        last_message_time: '2026-04-06T10:01:00.000Z',
        channel: 'web',
        is_group: 0,
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const sessions = await serverInstances[0].options.onFetchSessions();

    expect(sessions).toContainEqual({
      sessionId: 'valid_session',
      name: 'Web Session valid_se',
      lastActivity: '2026-04-06T10:01:00.000Z',
    });
    expect(
      sessions.some(
        (session: { sessionId: string; name: string }) =>
          String(session.sessionId).includes('[object') ||
          String(session.name).includes('[object'),
      ),
    ).toBe(false);
  });

  it('persists assistant replies so refreshed sessions can recover them', async () => {
    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();
    await channel.sendMessage('web:test_session', 'assistant reply');

    expect(storeMessageDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_jid: 'web:test_session',
        sender_name: 'Andy',
        content: 'assistant reply',
        is_from_me: true,
        is_bot_message: true,
      }),
    );
  });

  it('streams tool steps to the websocket and flushes them into session history before the final reply', async () => {
    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    channel.sendStreamStart?.('web:test_session');
    channel.sendStreamStep?.('web:test_session', {
      stepNumber: 1,
      stepType: 'tool_call',
      content:
        '{"name":"Read","arguments":{"file_path":"/workspace/group/package.json"}}',
    });
    channel.sendStreamStep?.('web:test_session', {
      stepNumber: 2,
      stepType: 'tool_result',
      content:
        '{"tool_use_id":"toolu_1","content":"{\\"name\\":\\"nanoclaw\\"}","is_error":false}',
    });
    await channel.sendMessage('web:test_session', 'assistant reply');

    expect(serverInstances[0].sentMessages).toEqual([
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'stream_start',
        }),
      },
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'stream_step',
          stepNumber: 1,
          stepType: 'tool_call',
        }),
      },
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'stream_step',
          stepNumber: 2,
          stepType: 'tool_result',
        }),
      },
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'message',
          content: 'assistant reply',
        }),
      },
    ]);

    const history =
      await serverInstances[0].options.onFetchHistory('test_session');

    expect(history).toEqual([
      {
        from: 'tools',
        timestamp: expect.any(String),
        tools: [
          expect.objectContaining({
            kind: 'tool_call',
            tool: 'Read',
          }),
          expect.objectContaining({
            kind: 'tool_result',
            tool: 'Read',
            status: 'success',
          }),
        ],
      },
      {
        from: 'assistant',
        content: 'assistant reply',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('streams assistant text between tool calls and stores it as assistant history', async () => {
    const { WebChannel } = await import('./web.js');

    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    channel.sendStreamStart?.('web:test_session');
    channel.sendStreamStep?.('web:test_session', {
      stepNumber: 1,
      stepType: 'assistant_text',
      content: '我先看一下这个技能的配置。',
    });

    expect(serverInstances[0].sentMessages).toEqual([
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'stream_start',
        }),
      },
      {
        sessionId: 'test_session',
        payload: expect.objectContaining({
          type: 'stream_step',
          stepNumber: 1,
          stepType: 'assistant_text',
          content: '我先看一下这个技能的配置。',
        }),
      },
    ]);

    const history =
      await serverInstances[0].options.onFetchHistory('test_session');

    expect(history).toEqual([
      {
        from: 'assistant',
        content: '我先看一下这个技能的配置。',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('restores persisted transcript history from jsonl files', async () => {
    const sessionId = 'jsonl_readback';
    writeTranscript(sessionId, 'history.jsonl', [
      {
        type: 'user',
        timestamp: '2026-04-06T09:00:00.000Z',
        message: {
          role: 'user',
          content:
            '<context timezone="Asia/Shanghai" />\n<messages>\n<message sender="User" time="Apr 6, 2026, 5:00 PM">请帮我读取 package.json</message>\n</messages>',
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-06T09:00:01.000Z',
        message: {
          role: 'assistant',
          type: 'message',
          content: [
            {
              type: 'text',
              text: '我已经读取了 package.json。',
            },
          ],
        },
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const history = await serverInstances[0].options.onFetchHistory(sessionId);

    expect(history).toEqual([
      {
        from: 'user',
        content: '请帮我读取 package.json',
        timestamp: '2026-04-06T09:00:00.000Z',
      },
      {
        from: 'assistant',
        content: '我已经读取了 package.json。',
        timestamp: '2026-04-06T09:00:01.000Z',
      },
    ]);
  });

  it('lists transcript-backed sessions even when they are not in memory', async () => {
    const sessionId = 'persisted_only_list';
    writeTranscript(sessionId, 'history.jsonl', [
      {
        type: 'user',
        timestamp: '2026-04-06T09:20:00.000Z',
        message: {
          role: 'user',
          content:
            '<context timezone="Asia/Shanghai" />\n<messages>\n<message sender="User" time="Apr 6, 2026, 5:20 PM">列出历史会话</message>\n</messages>',
        },
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const sessions = await serverInstances[0].options.onFetchSessions();

    expect(sessions).toContainEqual({
      sessionId,
      name: 'Web Session persiste',
      lastActivity: '2026-04-06T09:20:00.000Z',
    });
  });

  it('reads transcript history from the legacy web_web session folder', async () => {
    const sessionId = 'web_legacy_readback';
    writeLegacyTranscript(sessionId, 'history.jsonl', [
      {
        type: 'user',
        timestamp: '2026-04-06T09:00:00.000Z',
        message: {
          role: 'user',
          content:
            '<context timezone="Asia/Shanghai" />\n<messages>\n<message sender="User" time="Apr 6, 2026, 5:00 PM">旧目录里的历史也要恢复</message>\n</messages>',
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-06T09:00:01.000Z',
        message: {
          role: 'assistant',
          type: 'message',
          content: [
            {
              type: 'text',
              text: '我已经从 legacy web_web transcript 恢复出这条消息。',
            },
          ],
        },
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const history = await serverInstances[0].options.onFetchHistory(sessionId);

    expect(history).toEqual([
      {
        from: 'user',
        content: '旧目录里的历史也要恢复',
        timestamp: '2026-04-06T09:00:00.000Z',
      },
      {
        from: 'assistant',
        content: '我已经从 legacy web_web transcript 恢复出这条消息。',
        timestamp: '2026-04-06T09:00:01.000Z',
      },
    ]);
  });

  it('prefers transcript history over duplicated database rows', async () => {
    const sessionId = 'jsonl_over_db';
    writeTranscript(sessionId, 'history.jsonl', [
      {
        type: 'user',
        timestamp: '2026-04-06T09:00:00.000Z',
        message: {
          role: 'user',
          content:
            '<messages><message sender="User" time="Apr 6, 2026, 5:00 PM">只保留 transcript 这一份</message></messages>',
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-06T09:00:01.000Z',
        message: {
          role: 'assistant',
          type: 'message',
          content: [{ type: 'text', text: '这是 transcript 里的回答。' }],
        },
      },
    ]);

    getChatHistory.mockReturnValue([
      {
        id: 'dup_user',
        chat_jid: `web:${sessionId}`,
        sender: 'user',
        sender_name: 'User',
        content: '只保留 transcript 这一份',
        timestamp: '2026-04-06T09:00:02.000Z',
        is_from_me: 0,
      },
      {
        id: 'dup_bot',
        chat_jid: `web:${sessionId}`,
        sender: 'Andy',
        sender_name: 'Andy',
        content: '这是数据库里的重复回答。',
        timestamp: '2026-04-06T09:00:03.000Z',
        is_from_me: 1,
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const history = await serverInstances[0].options.onFetchHistory(sessionId);

    expect(history).toEqual([
      {
        from: 'user',
        content: '只保留 transcript 这一份',
        timestamp: '2026-04-06T09:00:00.000Z',
      },
      {
        from: 'assistant',
        content: '这是 transcript 里的回答。',
        timestamp: '2026-04-06T09:00:01.000Z',
      },
    ]);
  });

  it('restores tool calls and tool results from transcript content blocks', async () => {
    const sessionId = 'jsonl_tools';
    writeTranscript(sessionId, 'history.jsonl', [
      {
        type: 'assistant',
        timestamp: '2026-04-06T09:00:00.000Z',
        message: {
          role: 'assistant',
          type: 'message',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: '/workspace/group/package.json' },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-04-06T09:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '{"name":"nanoclaw"}',
              is_error: false,
            },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-06T09:00:02.000Z',
        message: {
          role: 'assistant',
          type: 'message',
          content: [{ type: 'text', text: '我已经读取完成。' }],
        },
      },
    ]);

    const { WebChannel } = await import('./web.js');
    const channel = new WebChannel({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat: () => {},
    });

    await channel.connect();

    const history = await serverInstances[0].options.onFetchHistory(sessionId);

    expect(history).toEqual([
      {
        from: 'tools',
        timestamp: '2026-04-06T09:00:00.000Z',
        tools: [
          expect.objectContaining({
            kind: 'tool_call',
            tool: 'Read',
            detail: '/workspace/group/package.json',
          }),
        ],
      },
      {
        from: 'tools',
        timestamp: '2026-04-06T09:00:01.000Z',
        tools: [
          expect.objectContaining({
            kind: 'tool_result',
            tool: 'Read',
            status: 'success',
            detail: '{"name":"nanoclaw"}',
          }),
        ],
      },
      {
        from: 'assistant',
        content: '我已经读取完成。',
        timestamp: '2026-04-06T09:00:02.000Z',
      },
    ]);
  });
});

function writeTranscript(
  sessionId: string,
  filename: string,
  entries: Array<Record<string, unknown>>,
): void {
  const groupFolder = `web_session_${sessionId}`;
  const sessionRoot = path.join(DATA_DIR, 'sessions', groupFolder);
  const transcriptDir = path.join(
    sessionRoot,
    '.claude',
    'projects',
    '-workspace-group',
  );
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, filename),
    entries.map((entry) => JSON.stringify({ sessionId, ...entry })).join('\n'),
    'utf-8',
  );
  createdPaths.push(sessionRoot);
}

function writeLegacyTranscript(
  sessionId: string,
  filename: string,
  entries: Array<Record<string, unknown>>,
): void {
  const groupFolder = `web_${sessionId}`;
  const sessionRoot = path.join(DATA_DIR, 'sessions', groupFolder);
  const transcriptDir = path.join(
    sessionRoot,
    '.claude',
    'projects',
    '-workspace-group',
  );
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, filename),
    entries.map((entry) => JSON.stringify({ sessionId, ...entry })).join('\n'),
    'utf-8',
  );
  createdPaths.push(sessionRoot);
}
