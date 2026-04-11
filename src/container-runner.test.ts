import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';

const { readEnvFileMock, onecliApplyContainerConfigMock } = vi.hoisted(() => ({
  readEnvFileMock: vi.fn(() => ({})),
  onecliApplyContainerConfigMock: vi.fn().mockResolvedValue(true),
}));

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  ONECLI_URL: 'http://localhost:10254',
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./env.js', () => ({
  readEnvFile: readEnvFileMock,
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  hostGatewayArgs: () => [],
  readonlyMountArgs: (h: string, c: string) => ['-v', `${h}:${c}:ro`],
  stopContainer: vi.fn(),
}));

// Mock OneCLI SDK
vi.mock('@onecli-sh/sdk', () => ({
  OneCLI: class {
    applyContainerConfig = onecliApplyContainerConfigMock;
    createAgent = vi.fn().mockResolvedValue({ id: 'test' });
    ensureAgent = vi
      .fn()
      .mockResolvedValue({ name: 'test', identifier: 'test', created: true });
  },
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';
import fs from 'fs';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    vi.clearAllMocks();
    readEnvFileMock.mockReturnValue({});
    onecliApplyContainerConfigMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_HOST;
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('passes through streamed tool step markers to onOutput callbacks', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: null,
      newSessionId: 'session-stream',
      stepNumber: 1,
      stepType: 'tool_call',
      stepContent:
        '{"name":"Read","arguments":{"file_path":"/workspace/group/package.json"}}',
    } as ContainerOutput);

    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;

    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        newSessionId: 'session-stream',
        stepType: 'tool_call',
        stepNumber: 1,
      }),
    );
  });

  it('passes .env auth credentials into the container when OneCLI is unavailable', async () => {
    onecliApplyContainerConfigMock.mockResolvedValue(false);
    readEnvFileMock.mockReturnValue({
      ANTHROPIC_AUTH_TOKEN: 'auth-token-from-env',
      ANTHROPIC_BASE_URL: 'https://anthropic-proxy.example.com',
    });

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).toContain('-e');
    expect(spawnArgs).toContain('ANTHROPIC_AUTH_TOKEN=auth-token-from-env');
    expect(spawnArgs).toContain('-e');
    expect(spawnArgs).toContain(
      'ANTHROPIC_BASE_URL=https://anthropic-proxy.example.com',
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'ok',
      newSessionId: 'session-auth',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });

  it('passes model configuration into the container from .env', async () => {
    readEnvFileMock.mockReturnValue({
      ANTHROPIC_MODEL: 'glm-5',
    });

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).toContain('-e');
    expect(spawnArgs).toContain('ANTHROPIC_MODEL=glm-5');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'ok',
      newSessionId: 'session-model',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });

  it('passes approved tool API keys into the container from .env', async () => {
    readEnvFileMock.mockReturnValue({
      SERPAPI_API_KEY: 'serp-key',
      TAVILY_API_KEY: 'tavily-key',
      MINIMAX_API_KEY: 'minimax-key',
      MINIMAX_API_HOST: 'https://api.minimaxi.com',
    });

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).toContain('SERPAPI_API_KEY=serp-key');
    expect(spawnArgs).toContain('TAVILY_API_KEY=tavily-key');
    expect(spawnArgs).toContain('MINIMAX_API_KEY=minimax-key');
    expect(spawnArgs).toContain('MINIMAX_API_HOST=https://api.minimaxi.com');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'ok',
      newSessionId: 'session-tools',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });

  it('merges MiniMax MCP config into existing group settings', async () => {
    readEnvFileMock.mockReturnValue({
      MINIMAX_API_KEY: 'minimax-key',
      MINIMAX_API_HOST: 'https://api.minimaxi.com',
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (filePath: fs.PathLike) =>
        String(filePath) ===
        '/tmp/nanoclaw-test-data/sessions/test-group/.claude/settings.json',
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        env: {
          EXISTING_ENV: '1',
        },
        mcpServers: {
          Existing: {
            command: 'existing-command',
          },
        },
      }),
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const settingsWrite = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find(
        ([filePath]) =>
          String(filePath) ===
          '/tmp/nanoclaw-test-data/sessions/test-group/.claude/settings.json',
      );
    expect(settingsWrite).toBeDefined();

    const writtenJson = JSON.parse(String(settingsWrite?.[1]));
    expect(writtenJson.env).toMatchObject({
      EXISTING_ENV: '1',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    });
    expect(writtenJson.mcpServers.Existing).toEqual({
      command: 'existing-command',
    });
    expect(writtenJson.mcpServers.MiniMax).toEqual({
      command: 'uvx',
      args: ['minimax-coding-plan-mcp', '-y'],
      env: {
        MINIMAX_API_KEY: 'minimax-key',
        MINIMAX_API_HOST: 'https://api.minimaxi.com',
      },
    });

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'ok',
      newSessionId: 'session-settings',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });

  it('prefers process env for MiniMax MCP server env when available', async () => {
    process.env.MINIMAX_API_KEY = 'process-minimax-key';
    process.env.MINIMAX_API_HOST = 'https://process.minimaxi.com';
    readEnvFileMock.mockReturnValue({
      MINIMAX_API_KEY: 'env-file-key',
      MINIMAX_API_HOST: 'https://env-file.minimaxi.com',
    });

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    const settingsWrite = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find(
        ([filePath]) =>
          String(filePath) ===
          '/tmp/nanoclaw-test-data/sessions/test-group/.claude/settings.json',
      );
    expect(settingsWrite).toBeDefined();

    const writtenJson = JSON.parse(String(settingsWrite?.[1]));
    expect(writtenJson.mcpServers.MiniMax.env).toEqual({
      MINIMAX_API_KEY: 'process-minimax-key',
      MINIMAX_API_HOST: 'https://process.minimaxi.com',
    });

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'ok',
      newSessionId: 'session-minimax-env',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });
});
