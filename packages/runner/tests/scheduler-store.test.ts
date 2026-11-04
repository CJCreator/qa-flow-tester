/**
 * ADR 0039: schedules live behind a store. Hosted copy: the audit store backend (Cloud Storage) key
 * `schedules/schedules.json`; local copy: `<dataDir>/schedules.json`. A failed read never reads as "no schedules".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { AuditStoreError, type AuditStoreBackend } from '@qa/core';
import {
  BackendScheduleStore,
  FileScheduleStore,
  SCHEDULES_KEY,
  SchedulerManager,
  type CheckupSchedule,
} from '../src/scheduler.js';
import { RunnerServer } from '../src/server.js';

function fakeBackend(): AuditStoreBackend & { objects: Map<string, unknown>; failReads: boolean; writes: string[] } {
  const objects = new Map<string, unknown>();
  const writes: string[] = [];
  const backend = {
    kind: 'gcs' as const,
    objects,
    failReads: false,
    writes,
    async getJson<T>(key: string): Promise<T | null> {
      if (backend.failReads) throw new AuditStoreError('unavailable', 'The audit store is not reachable.');
      return objects.has(key) ? (JSON.parse(JSON.stringify(objects.get(key))) as T) : null;
    },
    async putJson(key: string, value: unknown): Promise<void> {
      writes.push(key);
      objects.set(key, JSON.parse(JSON.stringify(value)));
    },
    async getBytes() {
      return null;
    },
    async putBytes() {},
    async list() {
      return [];
    },
    async deletePrefix() {},
  };
  return backend;
}

const input = {
  name: 'Nightly',
  targetUrl: 'https://example.com',
  cadence: 'daily' as const,
  hour: 2,
  preset: 'quick' as const,
  enabled: true,
};

describe('Schedules in the audit store backend', () => {
  it('add, pause and delete are written under schedules/schedules.json, and a second manager sees them', async () => {
    const backend = fakeBackend();
    const first = new SchedulerManager(new BackendScheduleStore(backend));
    const added = await first.addSchedule(input);
    expect(SCHEDULES_KEY).toBe('schedules/schedules.json');
    expect([...backend.objects.keys()]).toEqual([SCHEDULES_KEY]);

    const second = new SchedulerManager(new BackendScheduleStore(backend));
    expect((await second.loadSchedules()).map((s) => s.id)).toEqual([added.id]);

    await second.toggleSchedule(added.id, false);
    expect((await first.loadSchedules())[0].enabled).toBe(false);

    expect(await first.deleteSchedule(added.id)).toBe(true);
    expect(await second.loadSchedules()).toEqual([]);
  });

  it('a missing object reads as no schedules', async () => {
    expect(await new BackendScheduleStore(fakeBackend()).read()).toEqual([]);
  });

  it('a store that fails to read makes addSchedule reject and writes nothing (no wipe)', async () => {
    const backend = fakeBackend();
    const manager = new SchedulerManager(new BackendScheduleStore(backend));
    await manager.addSchedule(input);
    const before = JSON.stringify(backend.objects.get(SCHEDULES_KEY));
    backend.failReads = true;
    backend.writes.length = 0;
    await expect(manager.addSchedule({ ...input, name: 'Second' })).rejects.toThrow();
    await expect(manager.deleteSchedule('sched_x')).rejects.toThrow();
    expect(backend.writes).toEqual([]);
    expect(JSON.stringify(backend.objects.get(SCHEDULES_KEY))).toBe(before);
  });

  it('a tick over a failing store saves nothing and does not throw', async () => {
    const backend = fakeBackend();
    const manager = new SchedulerManager(new BackendScheduleStore(backend));
    await manager.addSchedule(input);
    backend.failReads = true;
    backend.writes.length = 0;
    const summary = await manager.tick(async () => true);
    expect(summary).toEqual({ started: 0, failed: 0, skipped: 0, busy: false });
    expect(backend.writes).toEqual([]);
  });
});

describe('Schedules in a local file', () => {
  const dir = path.join(process.cwd(), '.tmp-scheduler-store');
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('FileScheduleStore writes <dir>/schedules.json; the string constructor still works', async () => {
    const manager = new SchedulerManager(dir);
    const added = await manager.addSchedule(input);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'schedules.json'), 'utf8')) as CheckupSchedule[];
    expect(onDisk.map((s) => s.id)).toEqual([added.id]);
    expect(await new FileScheduleStore(dir).read()).toEqual(onDisk);
  });

  it('a missing or broken file reads as no schedules', async () => {
    expect(await new FileScheduleStore(dir).read()).toEqual([]);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'schedules.json'), 'not json', 'utf8');
    expect(await new FileScheduleStore(dir).read()).toEqual([]);
  });

  it('a server without a bucket keeps schedules in the file, across a second server on the same dataDir', async () => {
    const dataDir = path.join(dir, 'data');
    const make = (port: number) => new RunnerServer({ port, outputDir: path.join(dir, 'report'), dataDir });
    const a = make(3743);
    const baseA = await a.start();
    let id: string;
    try {
      const res = await fetch(`${baseA}/api/runner/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: 'https://example.com' }),
      });
      expect(res.status).toBe(201);
      id = ((await res.json()) as { id: string }).id;
    } finally {
      await a.stop();
    }
    const b = make(3744);
    const baseB = await b.start();
    try {
      const list = (await (await fetch(`${baseB}/api/runner/schedules`)).json()) as CheckupSchedule[];
      expect(list.map((s) => s.id)).toEqual([id]);
    } finally {
      await b.stop();
    }
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'schedules.json'), 'utf8'))).toHaveLength(1);
  });
});
