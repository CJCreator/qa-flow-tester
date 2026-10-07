import type { Breakpoint, Finding, FindingSeverity } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';
import { completeWith, type AIProvider } from './ai-provider.js';

export interface VisualReviewItemInput {
  layoutGroup: string;
  urlPath: string;
  screenshots: Array<{
    breakpoint: Breakpoint;
    imagePath?: string;
    base64Data?: string;
  }>;
}

export interface VisualReviewIssue {
  breakpoint: Breakpoint;
  selector?: string;
  what: string;
  why: string;
  suggestedImprovement: string;
  severity: FindingSeverity;
}

export interface VisualReviewResult {
  status: 'completed' | 'partial' | 'skipped';
  reviewedCount: number;
  totalCount: number;
  findings: Finding[];
  remainingScreens: VisualReviewItemInput[];
  note?: string;
  aiModel?: string;
  /** Why it stopped before the end: the AI Request Budget ran out, or the service failed. */
  stoppedBy?: Error;
}

export class VisualReviewer {
  /**
   * Conduct AI visual and copy review per layout group.
   */
  async reviewScreens(
    screens: VisualReviewItemInput[],
    aiProvider?: AIProvider,
    options?: { maxCalls?: number; model?: string }
  ): Promise<VisualReviewResult> {
    const totalCount = screens.length;

    // Graceful skip if no AI provider / key available
    if (!aiProvider || (aiProvider.providerType === 'mock' && !process.env.TEST_MOCK_AI)) {
      // In production without real key, or mock when not testing mock
      if (!aiProvider) {
        return {
          status: 'skipped',
          reviewedCount: 0,
          totalCount,
          findings: [],
          remainingScreens: screens,
          note: 'AI visual review skipped — no AI API key configured',
        };
      }
    }

    const maxCalls = options?.maxCalls ?? 10;
    const toReview = screens.slice(0, maxCalls);
    const remaining = screens.slice(maxCalls);
    const findings: Finding[] = [];
    let reviewedCount = 0;
    /** Why the review stopped early, when it did. */
    let stoppedBy: Error | undefined;
    /** Screens whose screenshots couldn't be read: dropped, as they never will be. */
    let unreadable = 0;

    for (const screen of toReview) {
      try {
        const issues = await this.reviewSingleScreen(screen, aiProvider, options?.model);
        // No screenshot could be read: nothing was looked at, so it doesn't count as reviewed.
        if (issues === null) {
          unreadable++;
          continue;
        }
        for (let i = 0; i < issues.length; i++) {
          const issue = issues[i];
          findings.push({
            id: `F-AI-VISUAL-${screen.layoutGroup}-${i + 1}`,
            testCaseId: `TC-VISUAL-${screen.layoutGroup}`,
            severity: issue.severity,
            checker: 'ai-review',
            title: `[AI Review] ${issue.what}`,
            where: {
              urlPath: screen.urlPath,
              role: 'visitor',
              breakpoint: issue.breakpoint,
              cssSelector: issue.selector,
            },
            expectedVsActual: {
              expected: issue.suggestedImprovement,
              actual: issue.why,
            },
            stepsToReproduce: [
              `Visit ${screen.urlPath} at screen width ${issue.breakpoint}`,
              `Observe layout in section "${screen.layoutGroup}": ${issue.what}`,
            ],
            evidence: {
              screenshotPath: screen.screenshots.find((s) => s.breakpoint === issue.breakpoint)?.imagePath,
            },
            resolution: issue.suggestedImprovement,
          });
        }
        reviewedCount++;
      } catch (err) {
        // The AI Request Budget ran out or the service failed: what's left can be finished later.
        stoppedBy = err instanceof Error ? err : new Error(String(err));
        console.warn(`[VisualReviewer] Stopped at ${screen.urlPath}: ${stoppedBy.message.slice(0, 300)}`);
        break;
      }
    }

    const looked = reviewedCount + unreadable;
    const isPartial = looked < totalCount && remaining.length > 0;
    const note = isPartial
      ? `The AI looked at ${reviewedCount} of ${totalCount} screens; the rest can be finished from the report.`
      : `The AI looked at ${reviewedCount} of ${totalCount} screens.`;

    return {
      status: isPartial ? 'partial' : 'completed',
      reviewedCount,
      totalCount,
      findings,
      remainingScreens: screens.slice(looked),
      stoppedBy,
      note,
    };
  }

  private async reviewSingleScreen(
    screen: VisualReviewItemInput,
    aiProvider: AIProvider,
    model?: string
  ): Promise<VisualReviewIssue[] | null> {
    const images: string[] = [];
    for (const s of screen.screenshots) {
      if (s.base64Data) images.push(s.base64Data);
      else if (s.imagePath) {
        const data = await fs.readFile(s.imagePath).catch(() => null);
        const type = path.extname(s.imagePath).toLowerCase() === '.png' ? 'png' : 'jpeg';
        if (data) images.push(`data:image/${type};base64,${data.toString('base64')}`);
      }
    }
    // Nothing to look at: not worth a request.
    if (images.length === 0) return null;

    const prompt = `You are a design and typography reviewer. Inspect the provided layout group "${screen.layoutGroup}" on page "${screen.urlPath}" at responsive breakpoints (375px mobile, 768px tablet, 1440px desktop).
Identify any awkward text wrapping, unaligned elements, cramped padding, or copy clarity problems. Report at most 3 issues, the most important first.
Respond ONLY with a JSON object:
{
  "issues": [
    {
      "breakpoint": "375px" | "768px" | "1440px",
      "selector": "optional CSS selector",
      "what": "one clear sentence describing what looks wrong",
      "why": "why it impairs readability or visual quality",
      "suggestedImprovement": "specific concrete design fix",
      "severity": "Minor" | "Suggestion"
    }
  ]
}`;

    const { text: response } = await completeWith(
      aiProvider,
      [
        { role: 'system', content: 'You are an expert UX and visual design auditor. Output valid JSON only.' },
        { role: 'user', content: prompt, images: images.length > 0 ? images : undefined },
      ],
      { model, responseFormat: 'json', temperature: 0.1, stage: 'visual-review' }
    );

    try {
      const parsed = JSON.parse(
        response
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim()
      );
      return Array.isArray(parsed?.issues) ? parsed.issues : [];
    } catch {
      return [];
    }
  }
}
