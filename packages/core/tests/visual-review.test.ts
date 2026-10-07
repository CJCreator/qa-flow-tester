import { describe, it, expect } from 'vitest';
import { VisualReviewer, type VisualReviewItemInput } from '../src/ai/visual-review.js';
import type { AIProvider } from '../src/ai/ai-provider.js';

describe('AI Visual and Copy Review (visual-review.ts)', () => {
  const reviewer = new VisualReviewer();

  const mockScreens: VisualReviewItemInput[] = [
    {
      layoutGroup: 'layout-home',
      urlPath: '/',
      screenshots: [
        { breakpoint: '375px', base64Data: 'data:image/png;base64,abc' },
        { breakpoint: '768px', base64Data: 'data:image/png;base64,def' },
        { breakpoint: '1440px', base64Data: 'data:image/png;base64,ghi' },
      ],
    },
    {
      layoutGroup: 'layout-pricing',
      urlPath: '/pricing',
      screenshots: [
        { breakpoint: '375px', base64Data: 'data:image/png;base64,jkl' },
        { breakpoint: '768px', base64Data: 'data:image/png;base64,mno' },
        { breakpoint: '1440px', base64Data: 'data:image/png;base64,pqr' },
      ],
    },
    {
      layoutGroup: 'layout-blog',
      urlPath: '/blog',
      screenshots: [{ breakpoint: '375px', base64Data: 'data:image/png;base64,stu' }],
    },
  ];

  it('gracefully skips visual review when no AI provider is provided', async () => {
    const result = await reviewer.reviewScreens(mockScreens, undefined);
    expect(result.status).toBe('skipped');
    expect(result.reviewedCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.note).toContain('no AI API key configured');
  });

  it('runs full visual review when budget covers all screens', async () => {
    const mockProvider: AIProvider = {
      providerType: 'mock',
      generateText: async () =>
        JSON.stringify({
          issues: [
            {
              breakpoint: '375px',
              what: 'Heading wraps onto three lines awkwardly',
              why: 'Pushes call to action button below viewport fold',
              suggestedImprovement: 'Reduce heading font-size to 1.5rem on mobile',
              severity: 'Minor',
            },
          ],
        }),
    };

    const result = await reviewer.reviewScreens(mockScreens, mockProvider, { maxCalls: 5 });
    expect(result.status).toBe('completed');
    expect(result.reviewedCount).toBe(3);
    expect(result.findings.length).toBe(3);
    expect(result.findings[0].checker).toBe('ai-review');
    expect(result.remainingScreens).toHaveLength(0);
  });

  it('handles partial visual review when budget is limited, and finishes remaining screens later', async () => {
    const mockProvider: AIProvider = {
      providerType: 'mock',
      generateText: async () =>
        JSON.stringify({
          issues: [
            {
              breakpoint: '768px',
              what: 'Table borders are clipping',
              why: 'Visual clutter',
              suggestedImprovement: 'Add overflow-x auto',
              severity: 'Minor',
            },
          ],
        }),
    };

    // Run with maxCalls = 1 (Partial)
    const partialResult = await reviewer.reviewScreens(mockScreens, mockProvider, { maxCalls: 1 });
    expect(partialResult.status).toBe('partial');
    expect(partialResult.reviewedCount).toBe(1);
    expect(partialResult.totalCount).toBe(3);
    expect(partialResult.remainingScreens).toHaveLength(2);
    expect(partialResult.note).toContain('The AI looked at 1 of 3 screens; the rest can be finished from the report.');

    // Finish remaining screens later
    const finishResult = await reviewer.reviewScreens(partialResult.remainingScreens, mockProvider, { maxCalls: 5 });
    expect(finishResult.status).toBe('completed');
    expect(finishResult.reviewedCount).toBe(2);
    expect(finishResult.remainingScreens).toHaveLength(0);
  });

  it('doesn’t count a screen whose screenshot can’t be read as looked at, and asks the AI nothing for it', async () => {
    let asked = 0;
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () => {
        asked++;
        return JSON.stringify({ issues: [] });
      },
    };
    const result = await reviewer.reviewScreens(
      [
        {
          layoutGroup: 'gone',
          urlPath: '/gone',
          screenshots: [{ breakpoint: '1440px', imagePath: 'no/such/screenshot.png' }],
        },
        mockScreens[0],
      ],
      provider,
      { maxCalls: 5 }
    );
    expect(asked).toBe(1);
    expect(result.reviewedCount).toBe(1);
    expect(result.remainingScreens).toEqual([]);
  });
});
