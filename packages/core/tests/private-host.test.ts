import { describe, it, expect } from 'vitest';
import { isPrivateHost } from '../src/competitive/safe-crawler.js';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'host.docker.internal',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '172.20.0.1',
    '[::1]',
    '::1',
    '169.254.169.254',
    '169.254.1.1',
    '0.0.0.0',
    '100.64.0.1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('%s is private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '10.example.com'])('%s is public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});
