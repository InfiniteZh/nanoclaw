import { describe, expect, it, vi } from 'vitest';

import type { ContainerOutput } from './container-runner.js';
import { forwardContainerOutputToChannel } from './index.js';

describe('forwardContainerOutputToChannel', () => {
  it('starts a stream once, forwards tool steps, then closes it with the final assistant reply', async () => {
    const channel = {
      sendStreamStart: vi.fn(),
      sendStreamStep: vi.fn(),
      sendStreamEnd: vi.fn(),
      sendMessage: vi.fn(async () => {}),
    };
    const state = { streamStarted: false, outputSentToUser: false };

    await forwardContainerOutputToChannel(
      channel,
      'web:test_session',
      {
        status: 'success',
        result: null,
        newSessionId: 'session-1',
        stepNumber: 1,
        stepType: 'tool_call',
        stepContent: '{"name":"Read","arguments":{"file_path":"README.md"}}',
      } as ContainerOutput,
      state,
    );

    await forwardContainerOutputToChannel(
      channel,
      'web:test_session',
      {
        status: 'success',
        result: null,
        newSessionId: 'session-1',
        stepNumber: 2,
        stepType: 'tool_result',
        stepContent:
          '{"tool_use_id":"toolu_1","content":"ok","is_error":false}',
      } as ContainerOutput,
      state,
    );

    await forwardContainerOutputToChannel(
      channel,
      'web:test_session',
      {
        status: 'success',
        result: 'final answer',
        newSessionId: 'session-1',
      } as ContainerOutput,
      state,
    );

    expect(channel.sendStreamStart).toHaveBeenCalledTimes(1);
    expect(channel.sendStreamStep).toHaveBeenNthCalledWith(
      1,
      'web:test_session',
      expect.objectContaining({
        stepNumber: 1,
        stepType: 'tool_call',
      }),
    );
    expect(channel.sendStreamStep).toHaveBeenNthCalledWith(
      2,
      'web:test_session',
      expect.objectContaining({
        stepNumber: 2,
        stepType: 'tool_result',
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith(
      'web:test_session',
      'final answer',
    );
    expect(channel.sendStreamEnd).not.toHaveBeenCalled();
    expect(state).toEqual({ streamStarted: false, outputSentToUser: true });
  });

  it('ends an active stream when the query completes without a final assistant message', async () => {
    const channel = {
      sendStreamStart: vi.fn(),
      sendStreamStep: vi.fn(),
      sendStreamEnd: vi.fn(),
      sendMessage: vi.fn(async () => {}),
    };
    const state = { streamStarted: true, outputSentToUser: false };

    await forwardContainerOutputToChannel(
      channel,
      'web:test_session',
      {
        status: 'success',
        result: null,
        newSessionId: 'session-1',
      } as ContainerOutput,
      state,
    );

    expect(channel.sendStreamEnd).toHaveBeenCalledWith('web:test_session');
    expect(state).toEqual({ streamStarted: false, outputSentToUser: false });
  });

  it('forwards assistant text emitted between tools as live stream steps instead of waiting for the final result', async () => {
    const channel = {
      sendStreamStart: vi.fn(),
      sendStreamStep: vi.fn(),
      sendStreamEnd: vi.fn(),
      sendMessage: vi.fn(async () => {}),
    };
    const state = { streamStarted: false, outputSentToUser: false };

    await forwardContainerOutputToChannel(
      channel,
      'web:test_session',
      {
        status: 'success',
        result: null,
        newSessionId: 'session-1',
        stepNumber: 3,
        stepType: 'assistant_text',
        stepContent: '先检查一下当前配置，再继续调用工具。',
      } as ContainerOutput,
      state,
    );

    expect(channel.sendStreamStart).toHaveBeenCalledTimes(1);
    expect(channel.sendStreamStep).toHaveBeenCalledWith(
      'web:test_session',
      expect.objectContaining({
        stepNumber: 3,
        stepType: 'assistant_text',
        content: '先检查一下当前配置，再继续调用工具。',
      }),
    );
    expect(channel.sendMessage).not.toHaveBeenCalled();
    expect(state).toEqual({ streamStarted: true, outputSentToUser: false });
  });
});
