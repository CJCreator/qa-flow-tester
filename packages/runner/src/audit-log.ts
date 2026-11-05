/**
 * Structured stderr logging for Website Audit failures (T-85, ADR 0042).
 * Cloud Logging collects stderr lines starting with `[Website Audit]`.
 * Every failure logs exactly one line with JSON payload containing:
 * code, stage, message, and url (redacted).
 */
import { redactUrl } from '@qa/core';

export interface AuditFailureLogEntry {
  code: string;
  stage: string;
  message: string;
  url: string;
}

export type AuditLogWriter = (line: string) => void;

const defaultStderrWriter: AuditLogWriter = (line: string) => {
  process.stderr.write(`${line}\n`);
};

export function formatAuditFailureLog(entry: AuditFailureLogEntry): string {
  const payload = {
    code: entry.code,
    stage: entry.stage,
    message: entry.message,
    url: redactUrl(entry.url),
  };
  return `[Website Audit] ${JSON.stringify(payload)}`;
}

export function logAuditFailure(entry: AuditFailureLogEntry, writer: AuditLogWriter = defaultStderrWriter): void {
  try {
    writer(formatAuditFailureLog(entry));
  } catch {
    // Logging to stderr must never fail the audit run.
  }
}
