/**
 * REQ-049 / DEC-002: one run slot for every kind of run (Check-up, Competitive Benchmark, Website Audit).
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DefaultRunSlot, type RunKind } from '../src/session/run-slot.js';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('RunSlot kinds', () => {
  it('is free at first and reports which kind holds it', () => {
    const slot = new DefaultRunSlot();
    expect(slot.kind).toBeNull();
    expect(slot.begin('bench-1', 'https://a.example/', 'benchmark')).toBe(true);
    expect(slot.kind).toBe('benchmark');
    slot.release();
    expect(slot.kind).toBeNull();
    expect(slot.begin('audit-1', 'https://a.example/', 'audit')).toBe(true);
    expect(slot.kind).toBe('audit');
    slot.release();
    expect(slot.begin('run-1', 'https://a.example/')).toBe(true);
    expect(slot.kind).toBe('checkup');
  });

  it('AC-1: refuses an audit (and a benchmark) while a Check-up holds the slot', () => {
    const slot = new DefaultRunSlot();
    expect(slot.begin('run-1', 'https://a.example/')).toBe(true);
    expect(slot.begin('audit-1', 'https://a.example/', 'audit')).toBe(false);
    expect(slot.begin('bench-1', 'https://a.example/', 'benchmark')).toBe(false);
    expect(slot.kind).toBe('checkup');
    expect(slot.runId).toBe('run-1');
  });

  it('a Check-up awaiting Plan Review can be replaced by a Check-up only', () => {
    const slot = new DefaultRunSlot();
    slot.begin('run-1', 'https://a.example/');
    slot.setPhase('awaiting-review');
    expect(slot.begin('audit-1', 'https://a.example/', 'audit')).toBe(false);
    expect(slot.begin('bench-1', 'https://a.example/', 'benchmark')).toBe(false);
    expect(slot.phase).toBe('awaiting-review');
    expect(slot.runId).toBe('run-1');
    expect(slot.begin('run-2', 'https://b.example/', 'checkup')).toBe(true);
    expect(slot.runId).toBe('run-2');
    expect(slot.kind).toBe('checkup');
  });

  it('AC-2: refuses a Check-up (default kind) and any other start while an audit holds the slot', () => {
    const slot = new DefaultRunSlot();
    expect(slot.begin('audit-1', 'https://a.example/', 'audit')).toBe(true);
    expect(slot.begin('run-1', 'https://a.example/')).toBe(false);
    expect(slot.begin('bench-1', 'https://a.example/', 'benchmark')).toBe(false);
    expect(slot.begin('audit-2', 'https://a.example/', 'audit')).toBe(false);
    expect(slot.kind).toBe('audit');
    expect(slot.isRunning).toBe(false);
  });

  it('AC-3: refuses a Check-up or an audit while a benchmark holds the slot', () => {
    const slot = new DefaultRunSlot();
    expect(slot.begin('bench-1', 'https://a.example/', 'benchmark')).toBe(true);
    expect(slot.begin('run-1', 'https://a.example/')).toBe(false);
    expect(slot.begin('audit-1', 'https://a.example/', 'audit')).toBe(false);
    expect(slot.kind).toBe('benchmark');
  });

  it("a benchmark or audit leaves the last Check-up's phase and run id alone, and so does its release", () => {
    const slot = new DefaultRunSlot();
    slot.begin('run-1', 'https://a.example/');
    slot.setPhase('done');
    const generation = slot.generation;
    expect(slot.begin('bench-1', 'https://b.example/', 'benchmark')).toBe(true);
    expect(slot.phase).toBe('done');
    expect(slot.runId).toBe('run-1');
    expect(slot.generation).toBe(generation);
    slot.release();
    expect(slot.kind).toBeNull();
    expect(slot.phase).toBe('done');
    expect(slot.runId).toBe('run-1');
  });

  it('AC-4: of two starts of different kinds issued together, exactly one claims the slot', async () => {
    const kinds: RunKind[] = ['checkup', 'benchmark', 'audit'];
    for (const first of kinds) {
      for (const second of kinds) {
        if (first === second) continue;
        const slot = new DefaultRunSlot();
        // Each start yields once (as a request handler would) and then claims synchronously.
        const start = async (kind: RunKind) => {
          await Promise.resolve();
          return slot.begin(`${kind}-1`, 'https://a.example/', kind);
        };
        const results = await Promise.all([start(first), start(second)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(slot.kind).toBe(first);
      }
    }
  });

  it('AC-5: benchmarkBusy does not appear anywhere in packages/runner/src', async () => {
    const hits: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if ((await fs.readFile(full, 'utf8')).includes('benchmarkBusy')) hits.push(full);
      }
    };
    await walk(srcDir);
    expect(hits).toEqual([]);
  });
});
