import type { AIProvider } from '../ai-provider.js';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';

export class MockAIProvider implements AIProvider {
  readonly providerType: AIProviderType = 'mock';

  private customResponses: Map<string, string> = new Map();

  setMockResponse(promptSubstring: string, response: string): void {
    this.customResponses.set(promptSubstring, response);
  }

  async generateText(messages: AIMessage[], _options?: AICompletionOptions): Promise<string> {
    const fullText = messages.map((m) => m.content).join(' ');

    for (const [key, val] of this.customResponses.entries()) {
      if (fullText.includes(key)) {
        return val;
      }
    }

    // The AI Planner's page requests: one test per page on its first safe button or tab, and a
    // check for every link listed, all built from the facts in the prompt.
    const pagesBlock = fullText.match(/Pages:\n(\[[\s\S]*?\])\n\nAnswer with ONLY/);
    if (pagesBlock) {
      const pages = JSON.parse(pagesBlock[1]) as Array<{
        urlPath: string;
        controls?: Array<{ role: string; name: string; selector: string; inForm?: boolean; disabled?: boolean }>;
        links?: Array<{ selector: string; name: string; to: string }>;
      }>;
      return JSON.stringify({
        pages: pages.map((p) => {
          const control = (p.controls || []).find(
            (c) =>
              ['button', 'tab', 'switch'].includes(c.role) &&
              !c.inForm &&
              !c.disabled &&
              !/delete|remove|pay|buy|sign ?out|log ?out|reset|trigger/i.test(c.name)
          );
          return {
            urlPath: p.urlPath,
            tests: control
              ? [
                  {
                    name: `Pressing “${control.name}” keeps the page working`,
                    steps: [{ action: 'click', selector: control.selector, name: `Press “${control.name}”` }],
                    expect: {},
                  },
                ]
              : [],
            links: (p.links || []).map((l) => ({
              selector: l.selector,
              name: `“${l.name}” opens ${l.to}`,
              expect: 'The page opens',
            })),
          };
        }),
      });
    }
    // The AI Planner's shared-menu request.
    const linksBlock = fullText.match(/Links:\n(\[[\s\S]*?\])\n\nAnswer with ONLY/);
    if (linksBlock) {
      const links = JSON.parse(linksBlock[1]) as Array<{
        selector: string;
        name: string;
        to: string;
        destination?: string;
      }>;
      return JSON.stringify({
        links: links.map((l) => ({
          selector: l.selector,
          name: `Menu: “${l.name}” opens ${l.to}`,
          expect: l.destination ? `The “${l.destination}” page` : 'The page opens',
        })),
      });
    }

    // Default mock response when analyzing pages or generating flows
    if (
      fullText.includes('discover_flows') ||
      fullText.includes('discovered_flows') ||
      fullText.includes('synthesizing application flows') ||
      fullText.includes('DiscoveredFlow')
    ) {
      return JSON.stringify({
        flows: [
          {
            id: 'FLOW-001',
            name: 'Create Invoice',
            role: 'manager',
            description: 'Navigate to invoice form and submit valid details',
            startPage: '/invoices/new',
            steps: [
              { action: 'fill', selector: '[data-testid="customer-field"]', value: 'Acme Corp', name: 'Fill Customer' },
              { action: 'fill', selector: '[data-testid="amount-field"]', value: '1200', name: 'Fill Amount' },
              { action: 'click', selector: '[data-testid="save-btn"]', name: 'Submit Invoice' },
            ],
            inferredRules: ['Amount must be a positive integer', 'Customer is required'],
            candidateExpectations: {
              url: { pattern: '/invoices/*' },
              text: { contains: 'Invoice created successfully' },
            },
          },
        ],
        inferredRules: ['Invoices require authenticated manager role', 'Dashboard tracks system telemetry'],
      });
    }

    return 'Mock AI Provider analysis complete.';
  }
}
