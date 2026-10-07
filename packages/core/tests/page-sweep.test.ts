import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { buildPageSweep } from '../src/discovery/page-sweep.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { server } from '../../../fixtures/test-app/server.js';

/** An AI with nothing useful to say: everything below comes from the page sweep alone. */
class SilentAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[], _options?: AICompletionOptions): Promise<string> {
    return JSON.stringify({ flows: [] });
  }
}

describe('Page sweep', () => {
  const PORT = 3507;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-page-sweep');

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('finds all four defects planted in the fixture, with no journey planned at all', async () => {
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'fixture',
      outputDir: path.join(outputDir, 'discovery'),
      aiProvider: new SilentAI(),
    });
    const sweep = buildPageSweep(draft);

    // Never a form's submit button.
    const tried = sweep.flatMap((tc) => tc.steps.filter((s) => s.action === 'click').map((s) => s.name));
    expect(tried).toContain('Try “Trigger Console Error”');
    expect(tried).not.toContain('Try “Save”');
    expect(tried).not.toContain('Try “Sign In”');

    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'fixture',
      specTestCases: sweep,
      outputDir: path.join(outputDir, 'run'),
      breakpoints: ['375px', '1440px'],
      recordVideo: false,
    });
    const titles = report.findings.map((f) => `${f.where.breakpoint} ${f.title}`);

    expect(
      titles.some(
        (t) =>
          t.includes('Console Error') &&
          report.findings.some((f) => f.expectedVsActual.actual.includes('Simulated Unhandled Runtime Bug'))
      )
    ).toBe(true);
    expect(titles.some((t) => t.includes('HTTP 500 on GET') && t.includes('/api/failing-endpoint'))).toBe(true);
    expect(titles.some((t) => t.includes('Dead End Page'))).toBe(true);
    expect(titles.some((t) => t.startsWith('375px') && /touch target/i.test(t))).toBe(true);
    // Controls that aren't there at some width are skipped, never reported as broken steps.
    expect(report.findings.some((f) => f.title.startsWith('Step failed'))).toBe(false);
  }, 120000);
});
