import * as lark from '@larksuiteoapi/node-sdk';

import {
  ASSISTANT_NAME,
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  FEISHU_DOMAIN,
} from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1000;
const CHAT_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGE_LENGTH = 4000;

interface CacheEntry<T> {
  value: T;
  expireAt: number;
}

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  autoRegisterChat?: (jid: string, name: string) => void;
}

export class FeishuChannel implements Channel {
  name = 'feishu';
  prefixAssistantName = false;

  private client: lark.Client;
  private wsClient!: lark.WSClient;
  private connected = false;
  private botOpenId?: string;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private chatNameCache = new Map<string, CacheEntry<string>>();
  private processedMessageIds = new Map<string, number>();
  private lastReceivedMessageId = new Map<string, string>();
  private activeReactionId = new Map<string, string>();
  private replyTargetId = new Map<string, string>();
  private opts: FeishuChannelOpts;

  constructor(opts: FeishuChannelOpts) {
    this.opts = opts;
    const domain =
      FEISHU_DOMAIN === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    this.client = new lark.Client({
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      domain,
    });
  }

  async connect(): Promise<void> {
    await this.fetchBotInfo();

    const domain =
      FEISHU_DOMAIN === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

    const dispatcher = new lark.EventDispatcher({});
    dispatcher.register({
      'im.message.receive_v1': (data: {
        sender: {
          sender_id?: {
            union_id?: string;
            user_id?: string;
            open_id?: string;
          };
          sender_type: string;
        };
        message: {
          message_id: string;
          chat_id: string;
          chat_type: string;
          message_type: string;
          content: string;
          create_time: string;
          mentions?: Array<{
            key: string;
            id: { union_id?: string; user_id?: string; open_id?: string };
            name: string;
          }>;
        };
      }) => {
        this.handleMessage(data).catch((err) =>
          logger.error({ err }, 'Error handling Feishu message'),
        );
      },
    });

    this.wsClient = new lark.WSClient({
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      domain,
      autoReconnect: true,
    });

    await this.wsClient.start({ eventDispatcher: dispatcher });
    this.connected = true;
    logger.info('Feishu WebSocket connected');

    this.flushOutgoingQueue();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.connected) {
      this.outgoingQueue.push({ jid, text });
      logger.info(
        { jid, length: text.length, queueSize: this.outgoingQueue.length },
        'Feishu disconnected, message queued',
      );
      return;
    }

    const rawId = jid.replace('feishu:', '');
    const receiveIdType: 'chat_id' | 'open_id' = rawId.startsWith('oc_')
      ? 'chat_id'
      : 'open_id';

    // Reply to the original message for the first chunk, then send as new messages
    const replyToId = this.replyTargetId.get(jid);
    if (replyToId) this.replyTargetId.delete(jid);

    // Check if agent output is already a JSON 2.0 card — passthrough directly
    const card = this.tryParseCard(text);
    if (card) {
      const content = JSON.stringify(card);
      try {
        if (replyToId) {
          await this.client.im.message.reply({
            path: { message_id: replyToId },
            data: { msg_type: 'interactive', content },
          });
          await this.setTyping(jid, false);
        } else {
          await this.client.im.message.create({
            data: { receive_id: rawId, msg_type: 'interactive', content },
            params: { receive_id_type: receiveIdType },
          });
        }
        logger.info({ jid }, 'Feishu JSON 2.0 card passthrough sent');
      } catch (err) {
        this.outgoingQueue.push({ jid, text });
        logger.warn({ jid, err }, 'Failed to send Feishu card passthrough, queued');
      }
      return;
    }

    const feishuText = this.toFeishuMarkdown(text);
    const chunks = this.splitMessage(feishuText, MAX_MESSAGE_LENGTH);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        // Send as interactive card with markdown (JSON 2.0) for rich text rendering
        const content = JSON.stringify({
          schema: '2.0',
          body: {
            elements: [
              {
                tag: 'markdown',
                content: chunk,
              },
            ],
          },
        });

        if (i === 0 && replyToId) {
          await this.client.im.message.reply({
            path: { message_id: replyToId },
            data: { msg_type: 'interactive', content },
          });
          // Remove typing reaction after reply is sent
          await this.setTyping(jid, false);
        } else {
          await this.client.im.message.create({
            data: {
              receive_id: rawId,
              msg_type: 'interactive',
              content,
            },
            params: { receive_id_type: receiveIdType },
          });
        }
        logger.info({ jid, length: chunk.length, isReply: i === 0 && !!replyToId }, 'Feishu card message sent');
      } catch (err) {
        this.outgoingQueue.push({ jid, text: chunk });
        logger.warn(
          { jid, err, queueSize: this.outgoingQueue.length },
          'Failed to send Feishu message, queued',
        );
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      this.wsClient?.close();
    } catch (err) {
      logger.debug({ err }, 'Error closing Feishu WSClient');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (isTyping) {
      const messageId = this.lastReceivedMessageId.get(jid);
      if (!messageId) return;
      this.replyTargetId.set(jid, messageId);
      try {
        const resp = await this.client.request<{
          data?: { reaction_id?: string };
        }>({
          method: 'POST',
          url: `/open-apis/im/v1/messages/${messageId}/reactions`,
          data: { reaction_type: { emoji_type: 'OnIt' } },
        });
        const reactionId = resp?.data?.reaction_id;
        if (reactionId) {
          this.activeReactionId.set(jid, `${messageId}:${reactionId}`);
        } else {
          logger.warn({ jid }, 'Reaction added but no reaction_id in response');
        }
      } catch (err) {
        logger.warn({ jid, err }, 'Failed to add typing reaction');
      }
    } else {
      const active = this.activeReactionId.get(jid);
      if (!active) return;
      const [messageId, reactionId] = active.split(':');
      this.activeReactionId.delete(jid);
      try {
        await this.client.request({
          method: 'DELETE',
          url: `/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`,
        });
      } catch (err) {
        logger.warn({ jid, err }, 'Failed to remove typing reaction');
      }
    }
  }

  // --- Internal ---

  private async fetchBotInfo(): Promise<void> {
    try {
      const resp = await this.client.request<{
        bot?: { open_id?: string; app_name?: string };
      }>({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });
      if (resp?.bot?.open_id) {
        this.botOpenId = resp.bot.open_id;
        logger.info(
          { botOpenId: this.botOpenId, name: resp.bot.app_name },
          'Feishu bot info fetched',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch Feishu bot info');
    }
  }

  private async handleMessage(data: {
    sender: {
      sender_id?: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      sender_type: string;
    };
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      create_time: string;
      mentions?: Array<{
        key: string;
        id: { union_id?: string; user_id?: string; open_id?: string };
        name: string;
      }>;
    };
  }): Promise<void> {
    const { message, sender } = data;
    if (!message || !sender) return;

    const messageId = message.message_id;
    if (this.isDuplicate(messageId)) return;

    // Parse message content (JSON string)
    let text = '';
    try {
      const content = JSON.parse(message.content);
      if (message.message_type === 'text') {
        text = content.text || '';
      } else if (message.message_type === 'post') {
        text = this.extractPostText(content);
      }
    } catch {
      logger.debug(
        { messageId, type: message.message_type },
        'Failed to parse Feishu message content',
      );
      return;
    }

    if (!text.trim()) return;

    const senderOpenId = sender.sender_id?.open_id || '';
    const chatType = message.chat_type; // 'p2p' | 'group'
    const jid =
      chatType === 'group'
        ? `feishu:${message.chat_id}`
        : `feishu:${senderOpenId}`;

    this.lastReceivedMessageId.set(jid, messageId);

    const timestamp = new Date(
      parseInt(message.create_time, 10),
    ).toISOString();

    // Detect @bot mentions and transform text
    let isMentionBot = false;
    if (message.mentions && Array.isArray(message.mentions)) {
      for (const mention of message.mentions) {
        if (mention.id?.open_id === this.botOpenId) {
          isMentionBot = true;
          text = text.replace(mention.key, '').trim();
        }
      }
    }

    // In groups, translate @bot mention into the trigger format
    if (isMentionBot && chatType === 'group') {
      text = `@${ASSISTANT_NAME} ${text}`;
    }

    const senderName = senderOpenId || 'Unknown';

    // Resolve chat name for group chats (for discovery)
    let chatName: string | undefined;
    if (chatType === 'group') {
      chatName = await this.getChatName(message.chat_id);
    }

    this.opts.onChatMetadata(jid, timestamp, chatName);

    const groups = this.opts.registeredGroups();

    // Auto-register p2p chats so private messages trigger the agent
    if (chatType === 'p2p' && !groups[jid] && this.opts.autoRegisterChat) {
      this.opts.autoRegisterChat(jid, senderName || senderOpenId);
    }

    if (groups[jid]) {
      this.opts.onMessage(jid, {
        id: messageId,
        chat_jid: jid,
        sender: senderOpenId,
        sender_name: senderName,
        content: text,
        timestamp,
        is_from_me: senderOpenId === this.botOpenId,
      });
    }
  }

  private extractPostText(content: Record<string, unknown>): string {
    const parts: string[] = [];
    const localeContent =
      (content.zh_cn as Record<string, unknown>) ||
      (content.en_us as Record<string, unknown>) ||
      content;
    const paragraphs = (localeContent as Record<string, unknown>)?.content;
    if (!Array.isArray(paragraphs)) return '';

    for (const paragraph of paragraphs) {
      if (!Array.isArray(paragraph)) continue;
      for (const el of paragraph) {
        if (el.tag === 'text' && el.text) {
          parts.push(el.text as string);
        } else if (el.tag === 'at' && el.user_name) {
          parts.push(`@${el.user_name}`);
        }
      }
      parts.push('\n');
    }
    return parts.join('').trim();
  }

  private isDuplicate(messageId: string): boolean {
    const now = Date.now();

    // Prune expired entries when cache is full
    if (this.processedMessageIds.size >= DEDUP_MAX_SIZE) {
      for (const [id, ts] of this.processedMessageIds) {
        if (now - ts > DEDUP_TTL_MS) {
          this.processedMessageIds.delete(id);
        }
      }
    }

    if (this.processedMessageIds.has(messageId)) return true;
    this.processedMessageIds.set(messageId, now);
    return false;
  }

  private async getChatName(
    chatId: string,
  ): Promise<string | undefined> {
    const cached = this.chatNameCache.get(chatId);
    if (cached && Date.now() < cached.expireAt) return cached.value;

    try {
      const resp = await this.client.im.chat.get({
        path: { chat_id: chatId },
      });
      const name = resp.data?.name;
      if (name) {
        this.chatNameCache.set(chatId, {
          value: name,
          expireAt: Date.now() + CHAT_NAME_CACHE_TTL_MS,
        });
      }
      return name;
    } catch (err) {
      logger.debug({ chatId, err }, 'Failed to get Feishu chat name');
      return undefined;
    }
  }

  /**
   * Convert standard markdown to Feishu card markdown (JSON 2.0).
   * JSON 2.0 natively supports # headers and > blockquotes, so minimal conversion needed.
   */
  private toFeishuMarkdown(text: string): string {
    return text;
  }

  /**
   * Try to parse text as a JSON 2.0 card. Returns the parsed card object if valid, null otherwise.
   */
  private tryParseCard(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        obj.schema === '2.0' &&
        obj.body &&
        typeof obj.body === 'object' &&
        Array.isArray((obj.body as Record<string, unknown>).elements)
      ) {
        return obj;
      }
    } catch {
      // Not valid JSON, fall through
    }
    return null;
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex <= 0) splitIndex = maxLength;
      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).replace(/^\n/, '');
    }
    return chunks;
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.outgoingQueue.length === 0) return;
    logger.info(
      { count: this.outgoingQueue.length },
      'Flushing Feishu outgoing queue',
    );
    const queue = [...this.outgoingQueue];
    this.outgoingQueue = [];
    for (const item of queue) {
      await this.sendMessage(item.jid, item.text);
    }
  }
}
