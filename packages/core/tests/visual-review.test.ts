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

  it('clamps AI severity to Minor or Suggestion and marks every finding advisory', async () => {
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () =>
        JSON.stringify({
          issues: [
            { breakpoint: '375px', what: 'Broken layout', why: 'x', suggestedImprovement: 'y', severity: 'Blocker' },
          ],
        }),
    };
    const result = await reviewer.reviewScreens([mockScreens[0]], provider, { maxCalls: 5 });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(['Minor', 'Suggestion']).toContain(f.severity);
      expect(f.advisory).toBe(true);
    }
  });

  it('does not let advisory AI findings change the verdict', async () => {
    const { releaseVerdict } = await import('@qa/types');
    const ai = {
      severity: 'Blocker' as const,
      checker: 'ai-review' as const,
      advisory: true,
      title: '[AI Review] Looks odd',
    };
    expect(releaseVerdict([ai]).ready).toBe(true);
  });

  it('is partial when the AI fails part-way, even under the cap', async () => {
    let callCount = 0;
    const failingProvider: AIProvider = {
      providerType: 'mock',
      generateText: async () => {
        callCount++;
        if (callCount === 2) throw new Error('AI service connection dropped');
        return JSON.stringify({ issues: [] });
      },
    };

    const result = await reviewer.reviewScreens(mockScreens, failingProvider, { maxCalls: 10 });
    expect(result.status).toBe('partial');
    expect(result.reviewedCount).toBe(1);
    expect(result.remainingScreens).toHaveLength(2);
    expect(result.note).toContain('the rest can be finished from the report');
    expect(result.stoppedBy).toBeInstanceOf(Error);
  });

  it('does not count a screen as reviewed when AI answer is cut off (finishReason: length), keeping it in remainingScreens', async () => {
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () => '{"issues": [{"break',
      complete: async () => ({
        text: '{"issues": [{"break',
        finishReason: 'length',
      }),
    };
    const result = await reviewer.reviewScreens(mockScreens, provider, { maxCalls: 5 });
    expect(result.reviewedCount).toBe(0);
    expect(result.remainingScreens).toHaveLength(3);
    expect(result.remainingScreens[0].urlPath).toBe('/');
    expect(result.stoppedBy?.message).toBe("The AI's answer for this screen could not be read.");
  });

  it('does not count a screen as reviewed when AI answer is not valid JSON, keeping it in remainingScreens', async () => {
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () => 'Sorry, I cannot help with this.',
      complete: async () => ({
        text: 'Sorry, I cannot help with this.',
        finishReason: 'stop',
      }),
    };
    const result = await reviewer.reviewScreens(mockScreens, provider, { maxCalls: 5 });
    expect(result.reviewedCount).toBe(0);
    expect(result.remainingScreens).toHaveLength(3);
    expect(result.remainingScreens[0].urlPath).toBe('/');
    expect(result.stoppedBy?.message).toBe("The AI's answer for this screen could not be read.");
  });

  it('clamps issues to at most 3 findings per screen', async () => {
    const issues = [1, 2, 3, 4, 5].map((n) => ({
      breakpoint: '375px' as const,
      what: `Issue ${n}`,
      why: `Why ${n}`,
      suggestedImprovement: `Fix ${n}`,
      severity: 'Minor' as const,
    }));
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () => JSON.stringify({ issues }),
    };
    const result = await reviewer.reviewScreens([mockScreens[0]], provider, { maxCalls: 5 });
    expect(result.reviewedCount).toBe(1);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.title)).toEqual([
      '[AI Review] Issue 1',
      '[AI Review] Issue 2',
      '[AI Review] Issue 3',
    ]);
  });

  it('drops issues with missing what or invalid breakpoint (e.g. 2000px)', async () => {
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () =>
        JSON.stringify({
          issues: [
            {
              breakpoint: '2000px',
              what: 'Screen is too wide',
              why: 'Too much space',
              suggestedImprovement: 'Center content',
              severity: 'Minor',
            },
            {
              breakpoint: '375px',
              what: '   ',
              why: 'Empty what',
              suggestedImprovement: 'Fill what',
              severity: 'Minor',
            },
            {
              breakpoint: '768px',
              what: 'Valid issue',
              why: 'Legitimate reason',
              suggestedImprovement: 'Legitimate fix',
              severity: 'Minor',
            },
          ],
        }),
    };
    const result = await reviewer.reviewScreens([mockScreens[0]], provider, { maxCalls: 5 });
    expect(result.reviewedCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('[AI Review] Valid issue');
    expect(result.findings[0].where.breakpoint).toBe('768px');
  });

  it('counts a screen with an empty issues array as reviewed', async () => {
    const provider: AIProvider = {
      providerType: 'mock',
      generateText: async () => JSON.stringify({ issues: [] }),
    };
    const result = await reviewer.reviewScreens([mockScreens[0]], provider, { maxCalls: 5 });
    expect(result.status).toBe('completed');
    expect(result.reviewedCount).toBe(1);
    expect(result.findings).toHaveLength(0);
    expect(result.remainingScreens).toHaveLength(0);
  });
});
