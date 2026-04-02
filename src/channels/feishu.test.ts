import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readEnvFileMock = vi.fn(() => ({}));

vi.mock('../env.js', () => ({
  readEnvFile: readEnvFileMock,
}));

vi.mock('@larksuiteoapi/node-sdk', () => {
  class Client {
    im = {
      message: {
        reply: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
      chat: {
        get: vi.fn(async () => ({ data: { name: 'Test Chat' } })),
      },
    };

    request = vi.fn(async () => ({ bot: { open_id: 'ou_bot' } }));
  }

  class WSClient {
    async start(): Promise<void> {}
    close(): void {}
  }

  class EventDispatcher {
    register(): void {}
  }

  return {
    Client,
    WSClient,
    EventDispatcher,
    Domain: {
      Lark: 'lark',
      Feishu: 'feishu',
    },
  };
});

describe('Feishu channel factory', () => {
  beforeEach(() => {
    vi.resetModules();
    readEnvFileMock.mockReturnValue({});
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_DOMAIN;
  });

  afterEach(() => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_DOMAIN;
  });

  it('returns null when credentials are missing', async () => {
    const registry = await import('./registry.js');
    await import('./feishu.js');

    const factory = registry.getChannelFactory('feishu');
    expect(factory).toBeDefined();

    const channel = factory!({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });

    expect(channel).toBeNull();
  });

  it('creates a connected channel when credentials are present', async () => {
    readEnvFileMock.mockReturnValue({
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'secret_test',
      FEISHU_DOMAIN: 'feishu',
    });

    const registry = await import('./registry.js');
    await import('./feishu.js');

    const factory = registry.getChannelFactory('feishu');
    expect(factory).toBeDefined();

    const channel = factory!({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
    });

    expect(channel).not.toBeNull();
    expect(channel!.name).toBe('feishu');
    expect(channel!.ownsJid('feishu:oc_test')).toBe(true);

    await channel!.connect();
    expect(channel!.isConnected()).toBe(true);

    await channel!.disconnect();
    expect(channel!.isConnected()).toBe(false);
  });

  it('accepts the optional autoRegisterChat callback in channel opts', async () => {
    readEnvFileMock.mockReturnValue({
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'secret_test',
      FEISHU_DOMAIN: 'feishu',
    });

    const registry = await import('./registry.js');
    await import('./feishu.js');

    const factory = registry.getChannelFactory('feishu');
    const autoRegisterChat = vi.fn();

    const channel = factory!({
      onMessage: () => {},
      onChatMetadata: () => {},
      registeredGroups: () => ({}),
      autoRegisterChat,
    });

    expect(channel).not.toBeNull();
    expect(autoRegisterChat).not.toHaveBeenCalled();
  });
});
