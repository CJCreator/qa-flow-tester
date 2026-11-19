import { isIP } from 'node:net';
import { isOwnSubdomain } from '@qa/checkers';
import { classifyAddress, isPrivateTextHost } from './address-class.js';

/** The host without a leading "www.", lower-cased, so example.com and www.example.com match. */
function withoutWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * True when two hosts are one site: identical, or one is the other's www twin (example.com and
 * www.example.com). Ports must match, and any other subdomain (app.example.com) is another site.
 */
export function isSameSite(host: string, siteHost: string): boolean {
  return withoutWww(host) === withoutWww(siteHost);
}

/**
 * The full address of a Plan's start page or `navigate` step, or null when it leaves the checked App:
 * http or https only, no user name or password in it, on the target's site (its www twin included) or a host
 * on the Domain Allowlist.
 */
export function onSiteAddress(value: string, targetUrl: string, allowedHosts: string[] = []): string | null {
  try {
    const target = new URL(targetUrl);
    const u = new URL(value, target);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    const host = u.host.toLowerCase();
    const allowed = isSameSite(host, target.host) || allowedHosts.some((h) => isSameSite(host, h.toLowerCase()));
    return allowed ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A Plan path on the site itself: starts with one `/` and names no other host (`//x`, `/\x` do). */
export function isSitePath(value: string | undefined): boolean {
  if (!value || !value.startsWith('/')) return false;
  try {
    return new URL(value, 'http://site.invalid').host === 'site.invalid';
  } catch {
    return false;
  }
}

/** True for this machine or a private network: `localhost`, `*.localhost`, or a non-public IP literal. */
function isPrivateHost(hostname: string): boolean {
  return isPrivateTextHost(hostname) || classifyAddress(hostname) !== null;
}

/**
 * True when a public host shares the site's registrable domain: `api.app.com` and `cdn.app.com` for `www.app.com`
 * (owner decision 2026-11-19). Uses the checkers' registrable-domain helper. IP literals and single-label hosts never match.
 */
function isSameRegistrableDomain(hostname: string, siteHostname: string): boolean {
  const plain = (h: string) => h.toLowerCase().replace(/^\[|\]$/g, '');
  const a = plain(hostname);
  const b = plain(siteHostname);
  if (isIP(a) || isIP(b) || !a.includes('.') || !b.includes('.') || isPrivateHost(a) || isPrivateHost(b)) return false;
  return isOwnSubdomain(a, b);
}

/**
 * The Domain Allowlist as a check on any address (T-424): the site's host (its `www` twin included) and
 * every host the person ticked. A Test Copy on this computer or a private network also reaches its other
 * private hosts, such as an API on another port. Anything that is not http or https is not on it.
 */
export function inDomainAllowlist(url: URL, siteUrl: string, allowedHosts: string[] = []): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return false;
  }
  const host = url.host.toLowerCase();
  if (isSameSite(host, site.host) || allowedHosts.some((h) => isSameSite(host, h.toLowerCase()))) return true;
  if (isSameRegistrableDomain(url.hostname, site.hostname)) return true;
  return isPrivateHost(site.hostname) && isPrivateHost(url.hostname);
}
