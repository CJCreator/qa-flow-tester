import type { TestCaseStep, RuleOrigin, TestCaseExpectations, ValidationRule } from './test-case.js';
import type { FallbackReason, PageLink, NarrowMenu, DraftPlan, DocSource, PlanIntent } from './plan.js';
import type { SignInFailureReason } from './signin.js';
import type { PageCoverage } from './route-telemetry.js';

/**
 * How far a crawl goes (REQ-002, Q-11). Depth counts link steps from the start address (the start page is
 * depth 0). Include and exclude paths are path prefixes such as "/blog"; the start page is always allowed.
 * A page outside the limits is a Skipped Page: `page-limit`, `depth-limit` or `excluded`.
 */
export interface CrawlLimits {
  /** Pages recorded at most (1 to 1000; default 200). */
  maxPages?: number;
  /** Link steps from the start address at most (0 to 100; default 8). */
  maxDepth?: number;
  /** When set, only pages whose path starts with one of these are recorded (the start page excepted). */
  includePaths?: string[];
  /** Pages whose path starts with one of these are not recorded. */
  excludePaths?: string[];
}

/** The bounds and defaults of `CrawlLimits`, shared by the validator, the wizard form and the crawl. */
export const CRAWL_LIMIT_BOUNDS = {
  minPages: 1,
  maxPages: 1000,
  defaultPages: 200,
  minDepth: 0,
  maxDepth: 100,
  defaultDepth: 8,
  /** Most include paths, and most exclude paths, one crawl takes. */
  maxPathPrefixes: 50,
  /** Longest path prefix, in characters. */
  maxPathPrefixChars: 200,
} as const;

export interface SensitiveAction {
  type: 'deletion' | 'payment' | 'external_communication' | 'admin_setting';
  elementSelector: string;
  elementText: string;
  urlPath: string;
  reason: string;
}

export interface AmbiguityQuestion {
  id: string; // e.g. "Q-001"
  targetElement?: string;
  urlPath: string;
  question: string;
  options: string[]; // e.g. ["Allow action for tests", "Skip permanently", "Use safe mock input"]
  selectedAnswer?: string;
  category: 'sensitive_action' | 'untested_form' | 'missing_permission' | 'unlinked_page' | 'unverified_step';
  /** The same for the same question on every run, so a site's answers can be remembered. */
  key?: string;
  /** The answer that sends nothing and deletes nothing, used when nobody answers. */
  safeAnswer?: string;
  /** The journey the question is about, when it is about one. */
  flowId?: string;
  /** Not asked in this site's last reviewed run. */
  isNew?: boolean;
  /** Every page the question covers, when the same form is on several (a search box in the header). */
  urlPaths?: string[];
}

/** One interactive element the crawler saw on a page. Plans may only target elements listed here. */
export interface ElementInventoryItem {
  /** ARIA role, explicit or implied by the tag: button, link, textbox, combobox, checkbox, tab, … */
  role: string;
  /** What a person or a screen reader would call it: its label, aria-label, visible text or placeholder. */
  name: string;
  /** Selector the runner can use: data-testid, then id, then name attribute, then role and name. */
  selector: string;
  tagName: string;
  testId?: string;
  id?: string;
  /** The HTML name attribute, for form controls. */
  nameAttribute?: string;
  /** For inputs: text, email, number, password, submit, … */
  inputType?: string;
  /** For links: the raw href attribute; absent or "#" when a script does the navigation. */
  href?: string;
  /** True when the element sits inside a form (a button there may submit it). */
  insideForm?: boolean;
  visible: boolean;
  enabled: boolean;
  /** The part of the page it sits in, when that's a header, menu or footer. */
  landmark?: 'header' | 'nav' | 'footer';
  /** It opens or closes something (aria-expanded, aria-haspopup or aria-controls), like a menu button. */
  toggles?: boolean;
  /** True when the element is marked transient or sits inside a data-transient container. */
  transient?: boolean;
}

export interface PageInventoryItem {
  urlPath: string;
  title: string;
  interactiveElementsCount: number;
  formsCount: number;
  outOfScope?: boolean;
  /** The interactive elements found on the page (absent in drafts written before this was recorded). */
  elements?: ElementInventoryItem[];
  /** The page has a password field: a sign-in form. */
  hasSignInForm?: boolean;
  /** Who reached this page while exploring: 'visitor' (signed out) and/or role names. */
  reachedBy?: string[];
  /** Pages built from the same template share a group, e.g. "layout-2" for every product page. */
  layoutGroup?: string;
  /** A small screenshot of the page, relative to the report folder. */
  screenshotPath?: string;
  /** Not found in this site's last reviewed run. */
  isNew?: boolean;
  /** Where the page's links and navigation buttons go (absent in drafts written before this was recorded). */
  links?: PageLink[];
  /** Menu buttons that narrow screens hide this page's links behind. */
  narrowMenus?: NarrowMenu[];
  /** A fingerprint of the page's controls: the same on the next run when the page hasn't changed. */
  contentKey?: string;
  /** Facts about a list-and-edit page, from its structure only (never from submitting anything). */
  crud?: {
    list?: boolean;
    add?: string;
    editFromRow?: boolean;
    /** True: asking to delete shows a confirm. False: none appeared. Absent: not probed. */
    deleteConfirm?: boolean;
  };
}

export interface DiscoveredFlow {
  id: string;
  /** What the journey checks (ADR 0024). Absent means Works. */
  intent?: PlanIntent;
  name: string;
  role: string;
  description: string;
  startPage: string;
  steps: TestCaseStep[];
  /** Rules the AI inferred. Always AI guesses: they never fail a site until someone confirms them. */
  inferredRules?: string[];
  candidateExpectations?: TestCaseExpectations;
  candidateValidationRules?: ValidationRule[];
  outOfScope?: boolean;
  /**
   * Why this flow can't run as planned, e.g. a step aimed at an element the crawler never found.
   * A flow needing help is not run until someone fixes it in the plan review.
   */
  needsHelp?: string[];
  /** It sends a form or presses something that changes data: on a live site it stays in the plan but isn't run. */
  needsTestCopy?: boolean;
  /** Who planned it: the AI, the fixed rules used when there's no AI, or the user. */
  source?: 'ai' | 'fallback' | 'user';
  /** Why fixed rules planned it, when they did. */
  fallbackReason?: FallbackReason;
  /**
   * Business rules the user added in plain words. A checkable rule becomes its own test: the
   * journey's steps with the rule's check. Others are listed in the report for a person to check.
   */
  userRules?: Array<{ text: string; origin: RuleOrigin; checkable: boolean; check?: TestCaseExpectations }>;
  /** Not in this site's last reviewed run, or its steps changed since. */
  isNew?: boolean;
  /** The Product Context document, section and requirement this journey came from (ADR 0020). */
  docSource?: DocSource;
}

export interface DiscoveryDraft {
  version: string;
  productId: string;
  targetUrl: string;
  timestamp: string;
  pages: PageInventoryItem[];
  flows: DiscoveredFlow[];
  sensitiveActions: SensitiveAction[];
  ambiguityQuestions: AmbiguityQuestion[];
  rawContextSummary?: string;
  /** True when AI-driven flow synthesis failed and flows were generated by the generic template fallback instead. */
  usedFallbackSynthesis?: boolean;
  /** Who explored the site, and what couldn't be reached. */
  exploration?: {
    /** Roles whose sign-in worked and that explored the site signed in. */
    signedInAs: string[];
    /** Roles whose sign-in didn't work. */
    signInFailed: string[];
    /** Why each of those roles could not sign in (a fixed reason, never page text). */
    signInFailures?: Record<string, SignInFailureReason>;
    /** Pages with a sign-in form. */
    signInPages: string[];
    /** Pages that asked for a sign-in nobody could get past. */
    notReached: string[];
    /** Pages found, how many were reached, and why the rest were skipped. */
    pageCoverage?: PageCoverage;
    /** Plain sentences for the report, e.g. "Pages behind the sign-in were not reached." */
    notes: string[];
  };
  /** Site category: 'shop' | 'SaaS' | 'content' | 'booking' | 'app' | 'other' */
  siteType?: 'shop' | 'SaaS' | 'content' | 'booking' | 'app' | 'other';
  /** Form fields and submit buttons the crawler found. Plan steps may use their selectors too. */
  forms?: Array<{
    urlPath: string;
    inputs: Array<{
      selector: string;
      /** Facts read from the field's attributes; absent when the page does not set them. */
      type?: string;
      label?: string;
      required?: boolean;
      pattern?: string;
      min?: string;
      max?: string;
      minLength?: number;
      maxLength?: number;
    }>;
    submitButtonSelector?: string;
    /** Steps that open the form first (a tab, drawer or dialog); recorded by the Spider. */
    opening?: TestCaseStep[];
    /** How the form is sent: GET only fetches a page (a search); anything else sends data. */
    method?: string;
  }>;
  /** True when this plan runs read-only because the site isn't a test copy. */
  readOnly?: boolean;
  /** The complete Plan's pages and Navigation Checks (ADR 0009). Journeys stay in `flows`. */
  plan?: DraftPlan;
}
