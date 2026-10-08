import { describe, it, expect } from 'vitest';
import { classifyAddress, isPublicAddress, isPrivateTextHost } from '../src/address-class.js';

describe('Address classes (isTestHost on a shared machine, ADR 0014)', () => {
  it('isTestHost refuses loopback 127.0.0.1 and ::1', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('127.255.255.255')).toBe('loopback');
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('[::1]')).toBe('loopback');
  });

  it('isTestHost refuses 10.0.0.4, 172.16.0.1 and 192.168.1.1, with the 172 edges', () => {
    expect(classifyAddress('10.0.0.4')).toBe('private');
    expect(classifyAddress('172.16.0.1')).toBe('private');
    expect(classifyAddress('172.31.255.255')).toBe('private');
    expect(classifyAddress('192.168.1.1')).toBe('private');
    expect(classifyAddress('172.15.255.255')).toBeNull();
    expect(classifyAddress('172.32.0.1')).toBeNull();
    expect(isPublicAddress('172.32.0.1')).toBe(true);
  });

  it('isTestHost refuses link-local 169.254.1.1 and fe80::1', () => {
    expect(classifyAddress('169.254.1.1')).toBe('link-local');
    expect(classifyAddress('fe80::1')).toBe('link-local');
    expect(classifyAddress('febf::1')).toBe('link-local');
    expect(classifyAddress('fe80::1%eth0')).toBe('link-local');
  });

  it('isTestHost refuses the cloud metadata addresses', () => {
    expect(classifyAddress('169.254.169.254')).toBe('metadata');
    expect(classifyAddress('fd00:ec2::254')).toBe('metadata');
    expect(classifyAddress('fd00:ec2:0:0:0:0:0:254')).toBe('metadata');
    expect(classifyAddress('fd12:3456::1')).toBe('unique-local');
    expect(classifyAddress('fc00::1')).toBe('unique-local');
  });

  it('isTestHost refuses IPv4-mapped IPv6 addresses', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:7f00:1')).toBe('loopback');
    expect(classifyAddress('::ffff:a9fe:a9fe')).toBe('metadata');
    expect(classifyAddress('::ffff:10.0.0.1')).toBe('private');
    expect(classifyAddress('::ffff:8.8.8.8')).toBeNull();
    // IPv4-compatible
    expect(classifyAddress('::127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::a00:1')).toBe('private');
  });

  it('isTestHost refuses 0.0.0.0 and ::', () => {
    expect(classifyAddress('0.0.0.0')).toBe('unspecified');
    expect(classifyAddress('0.1.2.3')).toBe('unspecified');
    expect(classifyAddress('::')).toBe('unspecified');
  });

  it('classifies carrier NAT, multicast and NAT64 as not public', () => {
    expect(classifyAddress('100.64.0.1')).toBe('carrier-nat');
    expect(classifyAddress('100.127.255.255')).toBe('carrier-nat');
    expect(classifyAddress('100.128.0.1')).toBeNull();
    expect(classifyAddress('224.0.0.1')).toBe('multicast-reserved');
    expect(classifyAddress('240.0.0.1')).toBe('multicast-reserved');
    expect(classifyAddress('255.255.255.255')).toBe('multicast-reserved');
    expect(classifyAddress('ff02::1')).toBe('multicast-reserved');
    expect(classifyAddress('64:ff9b::7f00:1')).toBe('loopback');
    expect(classifyAddress('64:ff9b::a00:1')).toBe('private');
    expect(classifyAddress('64:ff9b::808:808')).toBeNull();
  });

  it('public addresses are not refused', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(classifyAddress(a), a).toBeNull();
      expect(isPublicAddress(a), a).toBe(true);
    }
  });

  it('text that is not an IP address is not public and has no class', () => {
    for (const a of ['example.com', '', '999.1.1.1', '1.2.3', '::g', '1:2:3:4:5:6:7:8:9', ':::']) {
      expect(classifyAddress(a), a).toBeNull();
      expect(isPublicAddress(a), a).toBe(false);
    }
  });

  it('knows the names that mean this machine', () => {
    expect(isPrivateTextHost('localhost')).toBe(true);
    expect(isPrivateTextHost('app.localhost')).toBe(true);
    expect(isPrivateTextHost('host.docker.internal')).toBe(true);
    expect(isPrivateTextHost('example.com')).toBe(false);
    expect(isPrivateTextHost('localhost.evil.com')).toBe(false);
  });
});
