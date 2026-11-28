import { Readable } from 'node:stream';
import type http from 'http';
import { describe, expect, it } from 'vitest';
import { BODY_TOO_LARGE_MESSAGE, BodyTooLargeError, readJsonBody, refuseBadBody } from '../src/routes/body.js';

function fakeRes() {
  const out = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      out.status = status;
    },
    end(chunk?: string) {
      out.body += chunk ?? '';
    },
  };
  return { out, res: res as unknown as http.ServerResponse };
}

const req = (text: string) => Readable.from([text]) as unknown as http.IncomingMessage;

describe('request body errors', () => {
  it('throws BodyTooLargeError past the limit, and a SyntaxError for bad JSON', async () => {
    await expect(readJsonBody(req('{"a":"' + 'x'.repeat(50) + '"}'), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readJsonBody(req('{nope'), 100)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('answers 413 with the fixed sentence when too large', () => {
    const { out, res } = fakeRes();
    refuseBadBody(res, new BodyTooLargeError());
    expect(out.status).toBe(413);
    expect(JSON.parse(out.body)).toEqual({ error: BODY_TOO_LARGE_MESSAGE });
  });

  it('answers 400 for anything else, with the given reply or the default', () => {
    const a = fakeRes();
    refuseBadBody(a.res, new SyntaxError('x'));
    expect(a.out.status).toBe(400);
    expect(JSON.parse(a.out.body)).toEqual({ error: 'Invalid JSON body' });
    const b = fakeRes();
    refuseBadBody(b.res, new Error('x'), { error: 'mine', code: 'ERR_X' });
    expect(JSON.parse(b.out.body)).toEqual({ error: 'mine', code: 'ERR_X' });
  });
});
