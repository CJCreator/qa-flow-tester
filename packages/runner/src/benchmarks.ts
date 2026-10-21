import path from 'path';
import { promises as fs } from 'fs';
import type { AIProvider } from '@qa/core';
import { BenchmarkingEngine, SafePublicCrawler, UXGapSynthesizer, isPrivateHost, writeJsonAtomic } from '@qa/core';
import type { BenchmarkJob } from '@qa/types';

/** How many finished comparisons are kept. Older ones are deleted by themselves. */
const KEEP = 10;
const FLOW_TYPES = ['checkout', 'signup', 'onboarding', 'search', 'custom'];
const INDEX_FILE = '_index.json';

/** A finished comparison without its full result: what the list shows. */
type BenchmarkSummary = Omit<BenchmarkJob, 'result'>;

interface BenchmarkIndex {
  /** The comparison files in the folder, by file name, sorted. */
  names: string[];
  /** Their headlines, newest first. */
  jobs: BenchmarkSummary[];
}

function summaryOf(job: BenchmarkJob): BenchmarkSummary {
  const { result: _result, ...summary } = job;
  return summary;
}

/** A short word for a site, for the report: its host, or what was typed when that isn't an address. */
export function siteName(address: string, given?: string): string {
  if (given?.trim()) return given.trim();
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

export function cleanFlowType(flowType: string | undefined): string {
  return flowType && FLOW_TYPES.includes(flowType) ? flowType : 'custom';
}

/**
 * The finished comparisons, one JSON file each, newest first. `_index.json` holds their headlines, so a list
 * reads one file instead of every comparison.
 */
export class BenchmarkStore {
  constructor(private dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, '_')}.json`);
  }

  async save(job: BenchmarkJob): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(job.id), JSON.stringify(job, null, 2), 'utf8');
    await this.patchIndex(job.id, job);
    await this.prune();
  }

  async get(id: string): Promise<BenchmarkJob | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as BenchmarkJob;
    } catch {
      return null;
    }
  }

  /**
   * Newest first, without the full result (the list only needs the headline). The index is used while the folder
   * still has the same files; otherwise every comparison is read again and the index is rebuilt.
   */
  async list(): Promise<BenchmarkJob[]> {
    const names = await this.fileNames();
    const index = await this.readIndex();
    if (index && index.names.length === names.length && index.names.every((n, i) => n === names[i])) return index.jobs;
    const jobs = (await Promise.all(names.map((n) => this.get(n.replace(/\.json$/, '')))))
      .filter((j): j is BenchmarkJob => !!j)
      .map(summaryOf)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (index || names.length > 0) await this.writeIndex({ names, jobs });
    return jobs;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await fs.rm(this.file(id));
    } catch {
      return false;
    }
    await this.patchIndex(id);
    return true;
  }

  private async prune(): Promise<void> {
    const all = await this.list();
    for (const old of all.slice(KEEP)) await this.remove(old.id);
  }

  private async fileNames(): Promise<string[]> {
    try {
      return (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json') && n !== INDEX_FILE).sort();
    } catch {
      return [];
    }
  }

  private async readIndex(): Promise<BenchmarkIndex | null> {
    try {
      const index = JSON.parse(await fs.readFile(path.join(this.dir, INDEX_FILE), 'utf8')) as BenchmarkIndex;
      return Array.isArray(index.names) && Array.isArray(index.jobs) ? index : null;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: BenchmarkIndex): Promise<void> {
    await writeJsonAtomic(path.join(this.dir, INDEX_FILE), index);
  }

  /** Adds the comparison (when a job is given) or drops it from the index. With no index yet, the next list builds it. */
  private async patchIndex(id: string, job?: BenchmarkJob): Promise<void> {
    const index = await this.readIndex();
    if (!index) return;
    const file = path.basename(this.file(id));
    const names = [...index.names.filter((n) => n !== file), ...(job ? [file] : [])].sort();
    const jobs = [...index.jobs.filter((j) => j.id !== id), ...(job ? [summaryOf(job)] : [])].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt)
    );
    await this.writeIndex({ names, jobs });
  }
}

export interface ComparisonOptions {
  ourUrl: string;
  ourName: string;
  refUrl: string;
  refName: string;
  flowType: string;
  /** Where each side's screenshots go. */
  outputDir: string;
  /** Maps an address to the one to connect to (a host alias, or localhost seen from a container). */
  resolveUrl: (address: string) => string;
  /** Text model for the improvement ideas; without one, fixed rules write them. */
  ai?: AIProvider;
  onStage: (stage: string) => void;
}

/** Visits both sites for real, scores each, and compares them. Nothing is sent or changed on either site. */
export async function compareSites(
  options: ComparisonOptions
): Promise<{ result: NonNullable<BenchmarkJob['result']>; aiUsed: boolean }> {
  const crawler = new SafePublicCrawler();
  const engine = new BenchmarkingEngine();

  options.onStage(`Visiting ${options.ourName}…`);
  const ourFlow = await crawler.crawl({
    entryUrl: options.resolveUrl(options.ourUrl),
    flowName: options.ourName,
    outputDir: path.join(options.outputDir, 'ours'),
    // Your own site often tells every crawler to stay out; that file is for other people's sites.
    respectRobots: false,
    onStepStarted: (n) => options.onStage(`Looking at ${options.ourName}: step ${n}…`),
  });

  options.onStage(`Visiting ${options.refName}, looking only…`);
  const refFlow = await crawler.crawl({
    entryUrl: options.resolveUrl(options.refUrl),
    flowName: options.refName,
    outputDir: path.join(options.outputDir, 'reference'),
    // Another site's robots.txt is honored unless that site is on this computer or network.
    respectRobots: !isPrivateHost(safeHost(options.refUrl)),
    onStepStarted: (n) => options.onStage(`Looking at ${options.refName}: step ${n}…`),
  });

  options.onStage('Comparing the two…');
  const ourScore = engine.calculateScorecard(ourFlow);
  const refScore = engine.calculateScorecard(refFlow);

  options.onStage(options.ai ? 'Writing improvement ideas…' : 'Working out improvement ideas…');
  const recommendations = await new UXGapSynthesizer().synthesize(ourFlow, refFlow, ourScore, refScore, options.ai);
  const result = engine.compareFlows(options.flowType, ourFlow, refFlow, recommendations);
  return { result, aiUsed: !!options.ai };
}

function safeHost(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return '';
  }
}
