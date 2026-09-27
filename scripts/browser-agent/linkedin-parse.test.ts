/**
 * D.5b: fixture-based tests for `parseJobCard`.
 *
 * Each fixture is a real-shape LinkedIn job-card HTML fragment. Tests
 * assert the parser returns a well-formed `RawJob` (or null for the
 * broken/expired cases). Mutation smoke: change `SELECTORS.jobTitle`
 * in linkedin-selectors.ts to a bogus selector — most of the "returns
 * a RawJob" tests here go red immediately.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJobCard } from './lib/linkedin-parse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '__fixtures__', 'linkedin');
const load = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, name), 'utf-8');

// Fixed clock so relative-date parsing is deterministic.
const NOW = new Date('2026-09-27T12:00:00Z');

describe('parseJobCard (D.5b)', () => {
  it('parses a regular job card into RawJob shape', () => {
    const job = parseJobCard(load('regular-job.html'), NOW);
    expect(job).not.toBeNull();
    expect(job!.sourceId).toBe('linkedin:3891234567');
    expect(job!.sourceName).toBe('linkedin');
    expect(job!.title).toBe('Senior Backend Engineer');
    expect(job!.company).toBe('Acme Corp');
    expect(job!.location).toBe('San Francisco, CA');
    expect(job!.remote).toBe(false);
    expect(job!.canonicalUrl).toBe(
      'https://www.linkedin.com/jobs/view/3891234567/?refId=abc',
    );
    expect(job!.sourcePostedAt?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(job!.fetchedAt).toEqual(NOW);
  });

  it('detects remote when location text contains "Remote"', () => {
    const job = parseJobCard(load('remote-job.html'), NOW);
    expect(job).not.toBeNull();
    expect(job!.remote).toBe(true);
    expect(job!.location).toMatch(/remote/i);
    // Href was relative, must resolve to absolute linkedin.com.
    expect(job!.canonicalUrl).toBe(
      'https://www.linkedin.com/jobs/view/3900000001/',
    );
  });

  it('flags easy-apply cards in payload', () => {
    const job = parseJobCard(load('easy-apply-badge.html'), NOW);
    expect(job).not.toBeNull();
    expect((job!.payload as { easyApply: boolean }).easyApply).toBe(true);
    expect((job!.payload as { promoted: boolean }).promoted).toBe(false);
  });

  it('flags promoted listings in payload', () => {
    const job = parseJobCard(load('promoted-listing.html'), NOW);
    expect(job).not.toBeNull();
    expect((job!.payload as { promoted: boolean }).promoted).toBe(true);
    // "1 week ago" relative parse. Fixed clock => 2026-09-20.
    expect(job!.sourcePostedAt?.toISOString().slice(0, 10)).toBe('2026-09-20');
  });

  it('parses expired listings but flags them in payload', () => {
    const job = parseJobCard(load('expired-job.html'), NOW);
    expect(job).not.toBeNull();
    expect((job!.payload as { expired: boolean }).expired).toBe(true);
    expect(job!.company).toBe('Old Corp');
  });

  it('returns null when required company field is missing', () => {
    const job = parseJobCard(load('missing-company.html'), NOW);
    expect(job).toBeNull();
  });

  it('handles unicode characters in company + location', () => {
    const job = parseJobCard(load('unicode-company.html'), NOW);
    expect(job).not.toBeNull();
    expect(job!.company).toContain('Zürich');
    expect(job!.location).toContain('Zürich');
    // Em dash from raw LinkedIn HTML is preserved in scraped input;
    // downstream normalizer strips it before persisting.
    expect(job!.title).toMatch(/Software Engineer/);
  });

  it('returns null on broken/unparseable markup', () => {
    const job = parseJobCard(load('broken-html.html'), NOW);
    expect(job).toBeNull();
  });

  it('returns null on empty or non-string input', () => {
    expect(parseJobCard('', NOW)).toBeNull();
    expect(parseJobCard(null as unknown as string, NOW)).toBeNull();
  });

  it('populates fetchedAt with provided clock', () => {
    const t = new Date('2020-01-01T00:00:00Z');
    const job = parseJobCard(load('regular-job.html'), t);
    expect(job!.fetchedAt).toEqual(t);
  });
});
