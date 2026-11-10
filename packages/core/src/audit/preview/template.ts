/**
 * Template fallback for the improved-homepage preview (ADR 0018, ADR 0042, T-81).
 * When AI cannot run (missing key, quota, timeout, provider failure), this builds preview HTML
 * directly from the findings and Page Content using ADR 0018 claim-free wording.
 */
import type { PreviewFacts } from './prompt.js';
import { stripClaimWords } from '../documents/wording.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strips any ADR 0018 prohibited claim words from untrusted text. */
function sanitizeClaimText(text: string): string {
  return stripClaimWords(text);
}

/**
 * Builds semantic HTML for the improved homepage from PreviewFacts without using AI.
 * Respects ADR 0018 wording: no release verdicts, no compliance claims.
 */
export function buildTemplateHtml(facts: PreviewFacts): string {
  const parts: string[] = [];

  // Header and navigation
  parts.push('<header>');
  if (facts.menu.length > 0) {
    parts.push('  <nav class="qa-preview-menu" aria-label="Site menu">');
    for (const link of facts.menu) {
      parts.push(`    <a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>`);
    }
    parts.push('  </nav>');
  }
  parts.push('</header>');

  // Main content
  parts.push('<main>');

  // Title / Hero
  const title = facts.title || (facts.headings.length > 0 ? facts.headings[0].text : 'Welcome');
  parts.push(`  <h1 id="top">${escapeHtml(sanitizeClaimText(title))}</h1>`);

  if (facts.description) {
    parts.push(`  <p class="qa-preview-lead">${escapeHtml(sanitizeClaimText(facts.description))}</p>`);
  }

  // Hero Image if available
  if (facts.images.length > 0) {
    const hero = facts.images[0];
    parts.push(`  <img src="${escapeHtml(hero.src)}" alt="${escapeHtml(sanitizeClaimText(hero.alt || title))}">`);
  }

  // Sections from Page Content
  for (const section of facts.sections) {
    parts.push(`  <section id="${escapeHtml(section.id)}">`);
    if (section.heading) {
      parts.push(`    <h2>${escapeHtml(sanitizeClaimText(section.heading))}</h2>`);
    }
    if (section.text) {
      parts.push(`    <p>${escapeHtml(sanitizeClaimText(section.text))}</p>`);
    }
    parts.push('  </section>');
  }

  // Calls to Action
  if (facts.ctas.length > 0) {
    parts.push('  <section id="qa-preview-actions">');
    parts.push('    <h2>Actions</h2>');
    parts.push('    <ul>');
    for (const cta of facts.ctas) {
      const text = escapeHtml(sanitizeClaimText(cta.text));
      if (cta.href) {
        parts.push(`      <li><a href="${escapeHtml(cta.href)}">${text}</a></li>`);
      } else {
        parts.push(`      <li><span>${text}</span></li>`);
      }
    }
    parts.push('    </ul>');
    parts.push('  </section>');
  }

  // Suggested Improvements from Audit Findings
  if (facts.findings.length > 0) {
    parts.push('  <section id="qa-preview-suggestions">');
    parts.push('    <h2>Suggested improvements</h2>');
    parts.push('    <ul>');
    for (const finding of facts.findings) {
      const fTitle = escapeHtml(sanitizeClaimText(finding.title));
      const fSuggestion = escapeHtml(sanitizeClaimText(finding.suggestion));
      parts.push(`      <li><strong>${fTitle}</strong>: ${fSuggestion}</li>`);
    }
    parts.push('    </ul>');
    parts.push('  </section>');
  }

  // Additional images
  if (facts.images.length > 1) {
    parts.push('  <section id="qa-preview-gallery">');
    for (const img of facts.images.slice(1)) {
      parts.push(`    <img src="${escapeHtml(img.src)}" alt="${escapeHtml(sanitizeClaimText(img.alt || ''))}">`);
    }
    parts.push('  </section>');
  }

  parts.push('</main>');

  // Footer
  parts.push('<footer>');
  if (facts.menu.length > 0) {
    parts.push('  <nav aria-label="Footer navigation">');
    for (const link of facts.menu) {
      parts.push(`    <a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>`);
    }
    parts.push('  </nav>');
  }
  parts.push('</footer>');

  return parts.join('\n');
}
