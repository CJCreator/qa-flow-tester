import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BrowserContext } from 'playwright';
import { installRequestGuard, BrowserManager, setBrowserPolicy, WEBRTC_NO_DIRECT_UDP } from '../src/browser.js';

const mockLaunch = vi.fn();
vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
  webkit: {
    launch: vi.fn(),
  },
  firefox: {
    launch: vi.fn(),
  },
}));

interface FakeWebSocketRoute {
  url: () => string;
  connectToServer: () => void;
  close: (options: { code?: number; reason?: string }) => void;
}

function createFakeContext() {
  let wsHandler: ((ws: FakeWebSocketRoute) => Promise<void>) | undefined;

  const context = {
    route: vi.fn().mockResolvedValue(undefined),
    routeWebSocket: vi
      .fn()
      .mockImplementation(async (_pattern: RegExp | string, handler: (ws: FakeWebSocketRoute) => Promise<void>) => {
        wsHandler = handler;
      }),
  } as unknown as BrowserContext;

  const triggerWebSocket = async (url: string) => {
    if (!wsHandler) throw new Error('No WebSocket route installed');
    const calls = {
      connected: false,
      closed: null as { code?: number; reason?: string } | null,
    };
    const ws: FakeWebSocketRoute = {
      url: () => url,
      connectToServer: () => {
        calls.connected = true;
      },
      close: (opts) => {
        calls.closed = opts;
      },
    };
    await wsHandler(ws);
    return calls;
  };

  return { context, triggerWebSocket };
}

describe('WebSocket routing and service worker security in browser guard', () => {
  afterEach(() => {
    setBrowserPolicy(null);
    vi.clearAllMocks();
  });

  it('exports WEBRTC_NO_DIRECT_UDP Chromium flag', () => {
    expect(WEBRTC_NO_DIRECT_UDP).toBe('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  describe('installRequestGuard with WebSockets', () => {
    it('allows a public address WebSocket connection', async () => {
      const { context, triggerWebSocket } = createFakeContext();
      const guard = vi.fn().mockResolvedValue(true);

      await installRequestGuard(context, guard);

      const result = await triggerWebSocket('wss://public.example.com/socket');
      expect(guard).toHaveBeenCalledWith('wss://public.example.com/socket', false);
      expect(result.connected).toBe(true);
      expect(result.closed).toBeNull();
    });

    it('closes a refused WebSocket with code 1008 and reason', async () => {
      const { context, triggerWebSocket } = createFakeContext();
      const guard = vi.fn().mockResolvedValue(false);

      await installRequestGuard(context, guard);

      const result = await triggerWebSocket('ws://127.0.0.1:8080/feed');
      expect(guard).toHaveBeenCalledWith('ws://127.0.0.1:8080/feed', false);
      expect(result.connected).toBe(false);
      expect(result.closed).toEqual({
        code: 1008,
        reason: 'Blocked: not a public address',
      });
    });

    it('fails closed when the guard throws an error', async () => {
      const { context, triggerWebSocket } = createFakeContext();
      const guard = vi.fn().mockRejectedValue(new Error('lookup failed'));

      await installRequestGuard(context, guard);

      const result = await triggerWebSocket('wss://error.example.com/socket');
      expect(result.connected).toBe(false);
      expect(result.closed).toEqual({
        code: 1008,
        reason: 'Blocked: not a public address',
      });
    });

    it('asks all guards when multiple guards are installed on the context and refuses if one rejects', async () => {
      const { context, triggerWebSocket } = createFakeContext();
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(false);

      await installRequestGuard(context, guard1);
      await installRequestGuard(context, guard2);

      // Only one routeWebSocket should be registered on the context
      expect(context.routeWebSocket).toHaveBeenCalledTimes(1);

      const result = await triggerWebSocket('wss://example.com/socket');
      expect(guard1).toHaveBeenCalledWith('wss://example.com/socket', false);
      expect(guard2).toHaveBeenCalledWith('wss://example.com/socket', false);
      expect(result.connected).toBe(false);
      expect(result.closed).toEqual({
        code: 1008,
        reason: 'Blocked: not a public address',
      });
    });

    it('connects when all installed guards approve', async () => {
      const { context, triggerWebSocket } = createFakeContext();
      const guard1 = vi.fn().mockResolvedValue(true);
      const guard2 = vi.fn().mockResolvedValue(true);

      await installRequestGuard(context, guard1);
      await installRequestGuard(context, guard2);

      const result = await triggerWebSocket('wss://approved.example.com/socket');
      expect(result.connected).toBe(true);
      expect(result.closed).toBeNull();
    });
  });

  describe('BrowserManager launch args and createContext options', () => {
    it('adds WEBRTC_NO_DIRECT_UDP to Chromium launch args when browserPolicy guard is set', async () => {
      setBrowserPolicy({ guard: vi.fn().mockResolvedValue(true) });
      const fakeBrowser = {
        isConnected: () => true,
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockLaunch.mockResolvedValue(fakeBrowser);

      const manager = new BrowserManager();
      await manager.launch('chromium');

      expect(mockLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining([WEBRTC_NO_DIRECT_UDP]),
        })
      );
    });

    it('omits WEBRTC_NO_DIRECT_UDP from Chromium launch args when browserPolicy is not set', async () => {
      setBrowserPolicy(null);
      const fakeBrowser = {
        isConnected: () => true,
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockLaunch.mockResolvedValue(fakeBrowser);

      const manager = new BrowserManager();
      await manager.launch('chromium');

      const launchArgs = mockLaunch.mock.calls[0][0].args;
      expect(launchArgs).not.toContain(WEBRTC_NO_DIRECT_UDP);
    });

    it('sets serviceWorkers: "block" on BrowserManager.createContext', async () => {
      const mockNewContext = vi.fn().mockResolvedValue({
        route: vi.fn().mockResolvedValue(undefined),
        routeWebSocket: vi.fn().mockResolvedValue(undefined),
      });
      const fakeBrowser = {
        isConnected: () => true,
        newContext: mockNewContext,
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockLaunch.mockResolvedValue(fakeBrowser);

      const manager = new BrowserManager();
      await manager.createContext();

      expect(mockNewContext).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceWorkers: 'block',
        })
      );
    });
  });
});
