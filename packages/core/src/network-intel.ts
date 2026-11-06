/**
 * API & Network Traffic Intelligence Analyzer
 * Reference: G14
 */

export interface NetworkRequestEvent {
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  error?: string;
  timestamp: number;
  isApi: boolean;
  sizeBytes?: number;
}

export interface NetworkIntelSummary {
  totalRequests: number;
  apiRequests: number;
  failedRequests: number;
  slowRequests: number;
  avgApiLatencyMs: number;
  errorRate: number;
  endpointsWithErrors: Array<{ url: string; status?: number; error?: string }>;
}

export class NetworkIntelCollector {
  private events: NetworkRequestEvent[] = [];

  record(event: NetworkRequestEvent): void {
    this.events.push(event);
  }

  isApiUrl(urlStr: string): boolean {
    try {
      const u = new URL(urlStr);
      return (
        u.pathname.startsWith('/api') ||
        u.pathname.startsWith('/v1') ||
        u.pathname.startsWith('/v2') ||
        u.pathname.startsWith('/graphql') ||
        u.pathname.endsWith('.json')
      );
    } catch {
      return false;
    }
  }

  summarize(slowThresholdMs = 1500): NetworkIntelSummary {
    const totalRequests = this.events.length;
    const apiEvents = this.events.filter((e) => e.isApi);
    const apiRequests = apiEvents.length;

    const failedEvents = this.events.filter((e) => (e.status && e.status >= 400) || !!e.error);
    const slowEvents = this.events.filter((e) => e.durationMs >= slowThresholdMs);

    const totalApiDuration = apiEvents.reduce((acc, e) => acc + e.durationMs, 0);
    const avgApiLatencyMs = apiRequests > 0 ? Math.round(totalApiDuration / apiRequests) : 0;
    const errorRate = totalRequests > 0 ? Math.round((failedEvents.length / totalRequests) * 100) : 0;

    const endpointsWithErrors = failedEvents.slice(0, 10).map((e) => ({
      url: e.url,
      status: e.status,
      error: e.error,
    }));

    return {
      totalRequests,
      apiRequests,
      failedRequests: failedEvents.length,
      slowRequests: slowEvents.length,
      avgApiLatencyMs,
      errorRate,
      endpointsWithErrors,
    };
  }

  clear(): void {
    this.events = [];
  }
}
