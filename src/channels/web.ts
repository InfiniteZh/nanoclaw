import fs from 'fs';
import path from 'path';

import { WebUIServer } from 'nanoclaw-web-ui';
import type { WebHistoryEntry, WebMessage } from 'nanoclaw-web-ui';

import { ASSISTANT_NAME, DATA_DIR, GROUPS_DIR } from '../config.js';
import { getAllChats, getChatHistory, storeMessageDirect } from '../db.js';
import { Channel, NewMessage, RegisteredGroup } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';
import {
  formatSessionName,
  groupFolderFromSessionId,
  jidFromSessionId,
  legacyGroupFolderFromSessionId,
  isMalformedSessionIdArtifact,
  normalizeSessionIdValue,
  sessionIdFromJid,
} from './web-session.js';

export interface WebChannelOpts {
  onMessage: (chatJid: string, message: NewMessage) => void;
  onChatMetadata: (
    jid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ) => void;
  registeredGroups: () => Record<string, RegisteredGroup>;
  autoRegisterChat?: (jid: string, name: string) => void;
}

interface WebSessionState {
  sessionId: string;
  name: string;
  lastActivity: string;
  history: WebHistoryEntry[];
  pendingToolItems: WebToolHistoryItem[];
}

interface WebToolHistoryItem {
  kind: 'tool_call' | 'tool_result';
  tool: string;
  detail: string;
  full?: string;
  status?: string;
}

export class WebChannel implements Channel {
  name = 'web';

  private server: WebUIServer | null = null;
  private connected = false;
  private sessionState = new Map<string, WebSessionState>();

  constructor(private opts: WebChannelOpts) {}

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.server = new WebUIServer({
      port: parseInt(process.env.WEB_UI_PORT || '3000', 10),
      host: process.env.WEB_UI_HOST || 'localhost',
      authToken: process.env.WEB_UI_AUTH_TOKEN || '',
      assistantName: ASSISTANT_NAME,
      groupsDir: GROUPS_DIR,
      onMessage: async (message: WebMessage) => {
        await this.handleIncomingMessage(message);
      },
      onFetchSessions: async () => this.getSessionSummaries(),
      onFetchHistory: async (sessionId: string) =>
        this.getSessionHistory(sessionId),
    });

    await this.server.start();
    this.connected = true;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.server) {
      return;
    }

    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    const timestamp = new Date().toISOString();
    const sessionState = this.ensureSessionState(sessionId, timestamp);
    this.server.sendToSession(sessionId, {
      type: 'message',
      from: 'assistant',
      content: text,
      timestamp,
    });
    storeMessageDirect({
      id: `web_${sessionId}_${Date.now()}_assistant`,
      chat_jid: jid,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp,
      is_from_me: true,
      is_bot_message: true,
    });
    this.flushPendingToolItems(sessionState, timestamp);
    this.appendHistory(sessionId, {
      from: 'assistant',
      content: text,
      timestamp,
    });
  }

  sendStreamStart(jid: string): void {
    if (!this.server) {
      return;
    }

    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    this.ensureSessionState(sessionId, new Date().toISOString());
    this.server.sendToSession(sessionId, {
      type: 'stream_start',
      timestamp: new Date().toISOString(),
    });
  }

  sendStreamStep(
    jid: string,
    step: {
      stepNumber: number;
      stepType: 'tool_call' | 'tool_result' | 'assistant_text';
      content: string;
    },
  ): void {
    if (!this.server) {
      return;
    }

    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    const timestamp = new Date().toISOString();
    const state = this.ensureSessionState(sessionId, timestamp);
    this.recordToolStep(state, step.stepType, step.content);
    this.server.sendToSession(sessionId, {
      type: 'stream_step',
      stepNumber: step.stepNumber,
      stepType: step.stepType,
      content: step.content,
      timestamp,
    });
  }

  sendStreamEnd(jid: string, result?: string): void {
    if (!this.server) {
      return;
    }

    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    const timestamp = new Date().toISOString();
    const state = this.ensureSessionState(sessionId, timestamp);
    this.flushPendingToolItems(state, timestamp);
    this.server.sendToSession(sessionId, {
      type: 'stream_end',
      result,
      timestamp,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
    this.connected = false;
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.server) {
      return;
    }

    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    this.server.sendToSession(sessionId, {
      type: 'typing',
      from: 'assistant',
      isTyping,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleIncomingMessage(webMessage: WebMessage): Promise<void> {
    const jid = webMessage.chatJid.startsWith('web:')
      ? webMessage.chatJid
      : jidFromSessionId(webMessage.chatJid);
    const sessionId = sessionIdFromJid(jid);
    if (!sessionId) {
      return;
    }

    const sessionName = formatSessionName(sessionId);
    this.ensureSessionState(sessionId, webMessage.timestamp, sessionName);
    this.appendHistory(sessionId, {
      from: 'user',
      content: webMessage.content,
      timestamp: webMessage.timestamp,
    });
    this.opts.onChatMetadata(
      jid,
      webMessage.timestamp,
      sessionName,
      'web',
      false,
    );
    this.opts.autoRegisterChat?.(jid, sessionName);

    const newMessage: NewMessage = {
      id: webMessage.id,
      chat_jid: jid,
      sender: webMessage.sender,
      sender_name: webMessage.senderName,
      content: webMessage.content,
      timestamp: webMessage.timestamp,
      is_from_me: false,
    };

    this.opts.onMessage(jid, newMessage);
  }

  private ensureSessionState(
    sessionId: string,
    timestamp: string,
    name = formatSessionName(sessionId),
  ): WebSessionState {
    const existing = this.sessionState.get(sessionId);
    if (existing) {
      existing.lastActivity = timestamp;
      if (!existing.name) {
        existing.name = name;
      }
      return existing;
    }

    const created: WebSessionState = {
      sessionId,
      name,
      lastActivity: timestamp,
      history: [],
      pendingToolItems: [],
    };
    this.sessionState.set(sessionId, created);
    return created;
  }

  private appendHistory(sessionId: string, entry: WebHistoryEntry): void {
    const state = this.ensureSessionState(sessionId, entry.timestamp);
    state.history.push(entry);
    state.lastActivity = entry.timestamp;
  }

  private recordToolStep(
    state: WebSessionState,
    stepType: 'tool_call' | 'tool_result' | 'assistant_text',
    content: string,
  ): void {
    if (stepType === 'assistant_text') {
      const timestamp = new Date().toISOString();
      this.flushPendingToolItems(state, timestamp);
      this.appendHistory(state.sessionId, {
        from: 'assistant',
        content,
        timestamp,
      });
      return;
    }

    if (stepType === 'tool_call') {
      const toolCall = normalizeRealtimeToolCall(content);
      state.pendingToolItems.push(toolCall);
      return;
    }

    const toolResult = normalizeRealtimeToolResult(
      content,
      findRecentToolName(state.pendingToolItems),
    );
    state.pendingToolItems.push(toolResult);
  }

  private flushPendingToolItems(
    state: WebSessionState,
    timestamp: string,
  ): void {
    if (state.pendingToolItems.length === 0) {
      return;
    }

    state.history.push({
      from: 'tools',
      tools: state.pendingToolItems.splice(0),
      timestamp,
    });
    state.lastActivity = timestamp;
  }

  private async getSessionSummaries(): Promise<
    Array<{ sessionId: string; name: string; lastActivity: string }>
  > {
    const summaries = new Map<
      string,
      { sessionId: string; name: string; lastActivity: string }
    >();

    const persistedChats =
      typeof getAllChats === 'function' ? (getAllChats() ?? []) : [];

    for (const chat of persistedChats) {
      if (chat.jid === '__group_sync__') continue;
      const sessionId = sessionIdFromJid(chat.jid);
      if (!sessionId && chat.channel !== 'web') continue;
      const resolvedSessionId =
        sessionId ??
        normalizeSessionIdValue(
          typeof chat.jid === 'string' ? chat.jid.replace(/^web:/, '') : null,
        );
      if (!resolvedSessionId) {
        continue;
      }
      if (isMalformedSessionIdArtifact(resolvedSessionId)) {
        continue;
      }
      const safeName =
        typeof chat.name === 'string' && chat.name.trim()
          ? chat.name.trim()
          : formatSessionName(resolvedSessionId);
      summaries.set(resolvedSessionId, {
        sessionId: resolvedSessionId,
        name: safeName,
        lastActivity: chat.last_message_time,
      });
    }

    for (const state of this.sessionState.values()) {
      const existing = summaries.get(state.sessionId);
      if (!existing || existing.lastActivity < state.lastActivity) {
        summaries.set(state.sessionId, {
          sessionId: state.sessionId,
          name: state.name,
          lastActivity: state.lastActivity,
        });
      }
    }

    for (const persisted of this.readPersistedSessionSummaries()) {
      const existing = summaries.get(persisted.sessionId);
      if (!existing || existing.lastActivity < persisted.lastActivity) {
        summaries.set(persisted.sessionId, persisted);
      }
    }

    return Array.from(summaries.values()).sort((a, b) =>
      b.lastActivity.localeCompare(a.lastActivity),
    );
  }

  private async getSessionHistory(
    sessionId: string,
  ): Promise<WebHistoryEntry[]> {
    const transcriptHistory = this.readTranscriptHistory(sessionId);
    if (transcriptHistory.length > 0) {
      return transcriptHistory;
    }

    const persistedRows =
      typeof getChatHistory === 'function'
        ? (getChatHistory(jidFromSessionId(sessionId)) ?? [])
        : [];
    const persisted = persistedRows.map((msg) => ({
      from:
        msg.is_from_me || msg.is_bot_message
          ? ('assistant' as const)
          : ('user' as const),
      content: msg.content,
      timestamp: msg.timestamp,
    }));
    const inMemory = this.sessionState.get(sessionId)?.history ?? [];
    const merged = [...persisted, ...inMemory];
    const deduped = new Map<string, WebHistoryEntry>();

    for (const entry of merged) {
      if (entry.from === 'tools') {
        const key = `${entry.from}|${entry.timestamp}|${JSON.stringify(entry.tools)}`;
        deduped.set(key, entry);
        continue;
      }
      const key = `${entry.from}|${entry.timestamp}|${entry.content}`;
      deduped.set(key, entry);
    }

    return Array.from(deduped.values()).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }

  private readPersistedSessionSummaries(): Array<{
    sessionId: string;
    name: string;
    lastActivity: string;
  }> {
    const sessionsRoot = path.join(DATA_DIR, 'sessions');
    if (!fs.existsSync(sessionsRoot)) {
      return [];
    }

    const summaries: Array<{
      sessionId: string;
      name: string;
      lastActivity: string;
    }> = [];

    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      let sessionId = '';
      if (entry.name.startsWith('web_session_')) {
        sessionId = entry.name.slice('web_session_'.length);
      } else if (entry.name.startsWith('web_web_')) {
        sessionId = entry.name.slice('web_'.length);
      } else {
        continue;
      }

      if (!sessionId) {
        continue;
      }
      if (isMalformedSessionIdArtifact(sessionId)) {
        continue;
      }

      const transcriptPath = this.findLatestTranscriptPath(sessionId);
      if (!transcriptPath) {
        continue;
      }

      summaries.push({
        sessionId,
        name: formatSessionName(sessionId),
        lastActivity: this.readLastTranscriptTimestamp(transcriptPath),
      });
    }

    return summaries;
  }

  private readTranscriptHistory(sessionId: string): WebHistoryEntry[] {
    const transcriptPath = this.findLatestTranscriptPath(sessionId);
    if (!transcriptPath) {
      return [];
    }

    try {
      const raw = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const history: WebHistoryEntry[] = [];
      const toolUses = new Map<string, { tool: string; input: unknown }>();

      for (const line of lines) {
        const parsed = safeParseRecord(line);
        if (!parsed?.timestamp || typeof parsed.timestamp !== 'string') {
          continue;
        }

        if (parsed.type === 'assistant') {
          const content = Array.isArray(parsed.message?.content)
            ? parsed.message.content
            : [];
          const toolItems: WebToolHistoryItem[] = [];
          const textParts: string[] = [];

          for (const item of content) {
            if (!item || typeof item !== 'object') {
              continue;
            }

            const typedItem = item as {
              type?: string;
              id?: string;
              name?: string;
              input?: unknown;
              text?: string;
            };

            if (typedItem.type === 'tool_use') {
              const tool = typedItem.name?.trim() || 'unknown';
              const toolUseId = typedItem.id || `${parsed.timestamp}:${tool}`;
              toolUses.set(toolUseId, { tool, input: typedItem.input });
              toolItems.push({
                kind: 'tool_call',
                tool,
                detail: summarizeToolInput(typedItem.input, tool),
                full: prettyJson(typedItem.input),
              });
              continue;
            }

            if (
              typedItem.type === 'text' &&
              typeof typedItem.text === 'string'
            ) {
              const trimmed = typedItem.text.trim();
              if (trimmed) {
                textParts.push(trimmed);
              }
            }
          }

          if (toolItems.length > 0) {
            history.push({
              from: 'tools',
              tools: toolItems,
              timestamp: parsed.timestamp,
            });
          }

          if (textParts.length > 0) {
            history.push({
              from: 'assistant',
              content: textParts.join('\n\n'),
              timestamp: parsed.timestamp,
            });
          }
          continue;
        }

        if (parsed.type === 'user' && Array.isArray(parsed.message?.content)) {
          const toolItems: WebToolHistoryItem[] = [];

          for (const item of parsed.message.content) {
            if (!item || typeof item !== 'object') {
              continue;
            }

            const typedItem = item as {
              type?: string;
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            };

            if (typedItem.type !== 'tool_result') {
              continue;
            }

            const linkedTool = typedItem.tool_use_id
              ? toolUses.get(typedItem.tool_use_id)
              : undefined;
            const tool = linkedTool?.tool || 'result';
            const resultText =
              typeof typedItem.content === 'string'
                ? typedItem.content
                : prettyJson(typedItem.content) || '';
            const isError = typedItem.is_error === true;

            toolItems.push({
              kind: 'tool_result',
              tool,
              status: isError ? 'error' : 'success',
              detail: summarizeToolResult(resultText, isError),
              full: prettyJson({
                tool_use_id: typedItem.tool_use_id,
                content: typedItem.content,
                is_error: typedItem.is_error,
              }),
            });
          }

          if (toolItems.length > 0) {
            history.push({
              from: 'tools',
              tools: toolItems,
              timestamp: parsed.timestamp,
            });
          }
          continue;
        }

        if (parsed.type === 'user') {
          const text = extractTranscriptUserText(parsed.message?.content);
          if (text) {
            history.push({
              from: 'user',
              content: text,
              timestamp: parsed.timestamp,
            });
          }
        }
      }

      return history;
    } catch {
      return [];
    }
  }

  private findLatestTranscriptPath(sessionId: string): string | null {
    const candidates: string[] = [];
    const sessionRoots = [
      path.join(DATA_DIR, 'sessions', groupFolderFromSessionId(sessionId)),
      path.join(
        DATA_DIR,
        'sessions',
        legacyGroupFolderFromSessionId(sessionId),
      ),
    ];

    for (const sessionRoot of sessionRoots) {
      if (!fs.existsSync(sessionRoot)) {
        continue;
      }
      candidates.push(...collectJsonlFiles(sessionRoot));
    }

    if (candidates.length === 0) {
      return null;
    }

    return (
      candidates
        .map((filePath) => ({
          filePath,
          mtimeMs: fs.statSync(filePath).mtimeMs,
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null
    );
  }

  private readLastTranscriptTimestamp(transcriptPath: string): string {
    try {
      const raw = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const parsed = safeParseRecord(lines[index]);
        if (parsed?.timestamp && typeof parsed.timestamp === 'string') {
          return parsed.timestamp;
        }
      }
    } catch {
      // fall through to mtime
    }

    return new Date(fs.statSync(transcriptPath).mtimeMs).toISOString();
  }
}

registerChannel('web', (opts: ChannelOpts) => new WebChannel(opts));

function collectJsonlFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function safeParseRecord(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractTranscriptUserText(content: unknown): string | null {
  if (typeof content !== 'string') {
    return null;
  }

  const matches = [
    ...content.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/g),
  ];
  if (matches.length === 0) {
    return content.trim() || null;
  }

  const last = matches[matches.length - 1]?.[1]?.trim();
  return last || null;
}

function prettyJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolInput(input: unknown, fallbackTool: string): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fallbackTool;
  }

  const record = input as Record<string, unknown>;
  const candidates = [
    'file_path',
    'path',
    'filename',
    'url',
    'query',
    'text',
    'command',
    'description',
  ];

  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return fallbackTool;
}

function summarizeToolResult(content: string, isError: boolean): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return isError ? 'error' : 'success';
  }

  const firstLine = trimmed.split('\n')[0] ?? trimmed;
  return firstLine.slice(0, 200);
}

function normalizeRealtimeToolCall(content: string): WebToolHistoryItem {
  const parsed = safeParseRecord(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      kind: 'tool_call',
      tool: 'unknown',
      detail: content,
      full: content,
    };
  }

  const record = parsed as Record<string, unknown>;
  const tool =
    typeof record.name === 'string' && record.name.trim()
      ? record.name
      : 'unknown';
  const input = record.arguments ?? record.args ?? record.input ?? record;

  return {
    kind: 'tool_call',
    tool,
    detail: summarizeToolInput(input, tool),
    full: prettyJson(input),
  };
}

function normalizeRealtimeToolResult(
  content: string,
  fallbackTool?: string,
): WebToolHistoryItem {
  const parsed = safeParseRecord(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      kind: 'tool_result',
      tool: fallbackTool || 'result',
      detail: content,
      full: content,
      status: 'success',
    };
  }

  const record = parsed as Record<string, unknown>;
  const rawContent =
    typeof record.content === 'string'
      ? record.content
      : prettyJson(record.content) || '';
  const isError = record.is_error === true || record.isError === true;
  const explicitTool =
    typeof record.tool === 'string'
      ? record.tool
      : typeof record.name === 'string'
        ? record.name
        : '';

  return {
    kind: 'tool_result',
    tool: explicitTool || fallbackTool || 'result',
    detail: summarizeToolResult(rawContent, isError),
    full: prettyJson(record),
    status: isError ? 'error' : 'success',
  };
}

function findRecentToolName(
  pendingToolItems: WebToolHistoryItem[],
): string | undefined {
  for (let index = pendingToolItems.length - 1; index >= 0; index -= 1) {
    const candidate = pendingToolItems[index];
    if (candidate.kind === 'tool_call' && candidate.tool !== 'unknown') {
      return candidate.tool;
    }
  }

  return undefined;
}
