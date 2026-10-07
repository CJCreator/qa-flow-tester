import { promises as fs } from 'fs';
import path from 'path';
import type { SourceLocation } from '@qa/types';

export class SourceLocator {
  private repoRoot: string;
  private cache = new Map<string, SourceLocation | null>();

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  async findByTestId(testId: string): Promise<SourceLocation | undefined> {
    if (this.cache.has(testId)) {
      const cached = this.cache.get(testId);
      return cached ?? undefined;
    }

    const result = await this.scanDirectory(this.repoRoot, testId);
    this.cache.set(testId, result || null);
    return result;
  }

  private async scanDirectory(dir: string, testId: string, depth = 0): Promise<SourceLocation | undefined> {
    if (depth > 8) return undefined;

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === 'build' ||
        entry === 'coverage' ||
        entry === '.qa-report'
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const found = await this.scanDirectory(fullPath, testId, depth + 1);
        if (found) return found;
      } else if (/\.(tsx|jsx|ts|js|vue|svelte|html)$/.test(entry)) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const regex = new RegExp(`data-testid=["']${testId}["']`, 'g');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const relativePath = path.relative(this.repoRoot, fullPath).replace(/\\/g, '/');
              return {
                file: relativePath,
                line: i + 1,
                matchSnippet: lines[i].trim(),
              };
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    return undefined;
  }
}
