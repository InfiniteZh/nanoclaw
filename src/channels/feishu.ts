import * as lark from '@larksuiteoapi/node-sdk';

import { ASSISTANT_NAME } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const DEDUP_TTL_MS = 30 * 60 * 1000;
const DEDUP_MAX_SIZE = 1000;
const CHAT_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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
  private appId: string;
  private appSecret: string;
  private domain: lark.Domain;

  constructor(
    config: { appId: string; appSecret: string; domain: 'feishu' | 'lark' },
    opts: FeishuChannelOpts,
  ) {
    this.opts = opts;
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.domain =
      config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: this.domain,
    });
  }

  async connect(): Promise<void> {
    await this.fetchBotInfo();

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
      appId: this.appId,
      appSecret: this.appSecret,
      domain: this.domain,
      autoReconnect: true,
    });

    await this.wsClient.start({ eventDispatcher: dispatcher });
    this.connected = true;
    logger.info('Feishu WebSocket connected');

    await this.flushOutgoingQueue();
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

    const replyToId = this.replyTargetId.get(jid);
    if (replyToId) this.replyTargetId.delete(jid);

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
        logger.warn(
          { jid, err },
          'Failed to send Feishu card passthrough, queued',
        );
      }
      return;
    }

    const feishuText = this.toFeishuMarkdown(text);
    const chunks = this.splitMessage(feishuText, MAX_MESSAGE_LENGTH);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      try {
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
        logger.info(
          { jid, length: chunk.length, isReply: i === 0 && Boolean(replyToId) },
          'Feishu card message sent',
        );
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
      return;
    }

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

    let text = '';
    try {
      const content = JSON.parse(message.content) as Record<string, unknown>;
      if (message.message_type === 'text') {
        text = (content.text as string) || '';
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
    const chatType = message.chat_type;
    const jid =
      chatType === 'group'
        ? `feishu:${message.chat_id}`
        : `feishu:${senderOpenId}`;

    this.lastReceivedMessageId.set(jid, messageId);

    const timestamp = new Date(
      Number.parseInt(message.create_time, 10),
    ).toISOString();

    let isMentionBot = false;
    if (message.mentions && Array.isArray(message.mentions)) {
      for (const mention of message.mentions) {
        if (mention.id?.open_id === this.botOpenId) {
          isMentionBot = true;
          text = text.replace(mention.key, '').trim();
        }
      }
    }

    if (isMentionBot && chatType === 'group') {
      text = `@${ASSISTANT_NAME} ${text}`;
    }

    const senderName = senderOpenId || 'Unknown';

    let chatName: string | undefined;
    if (chatType === 'group') {
      chatName = await this.getChatName(message.chat_id);
    }

    const groups = this.opts.registeredGroups();
    this.opts.onChatMetadata(
      jid,
      timestamp,
      chatName || senderName,
      'feishu',
      chatType === 'group',
    );

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
    const paragraphs = (localeContent as Record<string, unknown>).content;
    if (!Array.isArray(paragraphs)) return '';

    for (const paragraph of paragraphs) {
      if (!Array.isArray(paragraph)) continue;
      for (const el of paragraph) {
        if (
          el &&
          typeof el === 'object' &&
          'tag' in el &&
          el.tag === 'text' &&
          'text' in el &&
          typeof el.text === 'string'
        ) {
          parts.push(el.text);
        } else if (
          el &&
          typeof el === 'object' &&
          'tag' in el &&
          el.tag === 'at' &&
          'user_name' in el &&
          typeof el.user_name === 'string'
        ) {
          parts.push(`@${el.user_name}`);
        }
      }
      parts.push('\n');
    }
    return parts.join('').trim();
  }

  private isDuplicate(messageId: string): boolean {
    const now = Date.now();

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

  private async getChatName(chatId: string): Promise<string | undefined> {
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

  private toFeishuMarkdown(text: string): string {
    return text;
  }

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
      return null;
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

registerChannel('feishu', (opts: ChannelOpts) => {
  const envVars = readEnvFile([
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_DOMAIN',
  ]);
  const appId = process.env.FEISHU_APP_ID || envVars.FEISHU_APP_ID || '';
  const appSecret =
    process.env.FEISHU_APP_SECRET || envVars.FEISHU_APP_SECRET || '';
  const domain =
    (process.env.FEISHU_DOMAIN || envVars.FEISHU_DOMAIN || 'feishu') === 'lark'
      ? 'lark'
      : 'feishu';

  if (!appId || !appSecret) {
    logger.warn('Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set');
    return null;
  }

  return new FeishuChannel({ appId, appSecret, domain }, opts);
});
