import type http from 'http';
import { describe, it, expect, vi } from 'vitest';
import { AuditRecordError, AuditStoreError, emptyOverlay, type AuditStore } from '@qa/core';
import type { AuditResult, Finding } from '@qa/types';
import {
  EDITS_NAME,
  pitchScreenshots,
  readEdits,
  refuseStoreFailure,
  versionQuery,
} from '../src/routes/audit-common.js';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';

const at = (query: string) => new URL(`http://localhost/api/audits/audit_00001${query}`);

class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';

  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    if (headers) this.headers = { ...headers };
  }

  end(chunk?: string) {
    if (chunk) this.body += chunk;
  }

  json(): any {
    return JSON.parse(this.body);
  }
}

describe('versionQuery', () => {
  it('is undefined without a version', () => {
    expect(versionQuery(at(''))).toBeUndefined();
  });
  it('reads a whole number from 1', () => {
    expect(versionQuery(at('?version=1'))).toBe(1);
    expect(versionQuery(at('?version=1234567'))).toBe(1234567);
  });
  it("is 'invalid' for anything else", () => {
    for (const bad of ['0', '01', '-1', '1.5', 'abc', '', '12345678']) {
      expect(versionQuery(at(`?version=${bad}`)), bad).toBe('invalid');
    }
  });
});

describe('refuseStoreFailure', () => {
  const text = {
    notFound: 'This Website Audit was not found.',
    failed: 'The operation failed. Try again.',
  };

  it('turns a record not-found error into 404 with custom notFound text and ERR_AUDIT_NOT_FOUND', () => {
    const res = new FakeResponse();
    refuseStoreFailure(
      res as unknown as http.ServerResponse,
      new AuditRecordError('not-found', 'internal message'),
      text
    );
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'This Website Audit was not found.',
      code: 'ERR_AUDIT_NOT_FOUND',
    });
  });

  it('turns other record errors into 400 with "The request is not valid." and ERR_INVALID_REQUEST', () => {
    const res = new FakeResponse();
    refuseStoreFailure(
      res as unknown as http.ServerResponse,
      new AuditRecordError('invalid-input', 'malformed parameter details'),
      text
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'The request is not valid.',
      code: 'ERR_INVALID_REQUEST',
    });
  });

  it('turns store invalid-key errors into 400 with "The request is not valid." and ERR_INVALID_REQUEST', () => {
    const res = new FakeResponse();
    refuseStoreFailure(
      res as unknown as http.ServerResponse,
      new AuditStoreError('invalid-key', 'secret-key-path-detail'),
      text
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'The request is not valid.',
      code: 'ERR_INVALID_REQUEST',
    });
  });

  it('turns unknown errors into 500 with custom failed text and no secrets/internals leaked', () => {
    const res = new FakeResponse();
    refuseStoreFailure(
      res as unknown as http.ServerResponse,
      new Error('postgresql://user:super_secret@localhost:5432/db'),
      text
    );
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'The operation failed. Try again.',
    });
    expect(res.body).not.toContain('super_secret');
  });

  it('uses default notFound and failed text when omitted', () => {
    const res404 = new FakeResponse();
    refuseStoreFailure(res404 as unknown as http.ServerResponse, new AuditRecordError('not-found', 'not there'));
    expect(res404.statusCode).toBe(404);
    expect(res404.json().error).toBe('This Website Audit was not found. It may have been deleted.');

    const res500 = new FakeResponse();
    refuseStoreFailure(res500 as unknown as http.ServerResponse, new Error('unexpected'));
    expect(res500.statusCode).toBe(500);
    expect(res500.json().error).toBe('The saved audits could not be read or changed. Try again.');
  });
});

describe('readEdits', () => {
  it('readEdits returns an empty overlay when nothing was saved', async () => {
    const store = {
      readVersionJson: vi.fn().mockResolvedValue(null),
    } as unknown as AuditStore;
    const res = await readEdits(store, 'audit_00001', 2);
    expect(res).toEqual(emptyOverlay());
  });

  it('readEdits asks for the edits file', async () => {
    const readVersionJson = vi.fn().mockResolvedValue(null);
    const store = { readVersionJson } as unknown as AuditStore;
    await readEdits(store, 'audit_00001', 2);
    expect(readVersionJson).toHaveBeenCalledWith('audit_00001', 2, EDITS_NAME);
  });
});

describe('pitchScreenshots', () => {
  it('pitchScreenshots embeds a small png and skips the rest', async () => {
    const smallPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // 4 bytes PNG
    const largePng = Buffer.alloc(3_000_001); // Over 3 MB
    const getVersionFile = vi.fn().mockImplementation((auditId: string, version: number, name: string) => {
      if (name === 'shot1.png') return Promise.resolve(smallPng);
      if (name === 'shot2.png') return Promise.resolve(largePng);
      if (name === 'shot3.png') return Promise.reject(new Error('refused'));
      return Promise.resolve(null);
    });

    const store = { getVersionFile } as unknown as AuditStore;
    const baseResult = auditDocResult();
    const findings = [
      { ...baseResult.findings[0]!, id: 'F1', screenshotPath: 'shot1.png' },
      { ...baseResult.findings[1]!, id: 'F2', screenshotPath: 'shot2.png' },
      { ...baseResult.findings[2]!, id: 'F3', screenshotPath: 'shot3.png' },
      ...baseResult.findings.slice(3),
    ];

    const shots = await pitchScreenshots(store, {
      auditId: 'audit_00001',
      version: 1,
      result: { ...baseResult, findings },
      contents: auditDocContents(),
      edits: emptyOverlay(),
    });

    expect(shots['shot1.png']).toBe(`data:image/png;base64,${smallPng.toString('base64')}`);
    expect(shots['shot2.png']).toBeUndefined();
    expect(shots['shot3.png']).toBeUndefined();
  });

  it('pitchScreenshots ignores a file with an unknown type', async () => {
    const getVersionFile = vi.fn();
    const store = { getVersionFile } as unknown as AuditStore;
    const baseResult = auditDocResult();
    const findings = [
      { ...baseResult.findings[0]!, id: 'F1', screenshotPath: 'vector.svg' },
      ...baseResult.findings.slice(1),
    ];

    const shots = await pitchScreenshots(store, {
      auditId: 'audit_00001',
      version: 1,
      result: { ...baseResult, findings },
      contents: auditDocContents(),
      edits: emptyOverlay(),
    });

    expect(shots['vector.svg']).toBeUndefined();
    expect(getVersionFile).not.toHaveBeenCalled();
  });
});
