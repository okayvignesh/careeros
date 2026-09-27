import { describe, expect, it } from 'vitest';
import { classifyRole } from './classify-role';

describe('classifyRole (C-P3.3)', () => {
  it('"Frontend Engineer" → frontend', () => {
    expect(classifyRole('Frontend Engineer').family).toBe('frontend');
  });

  it('"Backend Engineer" → backend', () => {
    expect(classifyRole('Backend Engineer').family).toBe('backend');
  });

  it('"Full-stack Developer" → fullstack', () => {
    expect(classifyRole('Full-stack Developer').family).toBe('fullstack');
  });

  it('title-only "iOS Developer" → mobile', () => {
    expect(classifyRole('iOS Developer').family).toBe('mobile');
  });

  it('"React Native Engineer" → mobile', () => {
    expect(classifyRole('React Native Engineer').family).toBe('mobile');
  });

  it('"DevOps Engineer" → devops', () => {
    expect(classifyRole('DevOps Engineer').family).toBe('devops');
  });

  it('"Site Reliability Engineer" → sre', () => {
    expect(classifyRole('Site Reliability Engineer').family).toBe('sre');
  });

  it('"SRE" → sre', () => {
    expect(classifyRole('SRE').family).toBe('sre');
  });

  it('"Data Engineer" → data', () => {
    expect(classifyRole('Data Engineer').family).toBe('data');
  });

  it('"Machine Learning Engineer" → ml', () => {
    expect(classifyRole('Machine Learning Engineer').family).toBe('ml');
  });

  it('"Security Engineer" → security', () => {
    expect(classifyRole('Security Engineer').family).toBe('security');
  });

  it('"Product Manager" → pm', () => {
    expect(classifyRole('Product Manager').family).toBe('pm');
  });

  it('"Senior Product Designer" → design', () => {
    expect(classifyRole('Senior Product Designer').family).toBe('design');
  });

  it('"Engineering Manager" → manager', () => {
    expect(classifyRole('Engineering Manager').family).toBe('manager');
  });

  it('description-only signal upgrades a vague title', () => {
    const r = classifyRole(
      'Software Engineer',
      'Build our React and TypeScript frontend. Own the design system.'
    );
    expect(r.family).toBe('frontend');
  });

  it('backend title + backend desc → backend (higher confidence)', () => {
    const r = classifyRole(
      'Backend Engineer',
      'Node.js, PostgreSQL, and Kafka experience required. Build our REST API.'
    );
    expect(r.family).toBe('backend');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('frontend+backend desc, generic title → fullstack override', () => {
    const r = classifyRole(
      'Software Engineer',
      'You will work on React frontends AND Node.js APIs backed by PostgreSQL.'
    );
    expect(r.family).toBe('fullstack');
  });

  it('empty title + empty description → backend @ 0.2 (default)', () => {
    const r = classifyRole('', '');
    expect(r.family).toBe('backend');
    expect(r.confidence).toBeCloseTo(0.2, 5);
  });

  it('confidence stays within [0,1]', () => {
    const r = classifyRole('Senior Backend Engineer', 'Node.js, PostgreSQL, Kafka, gRPC.');
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('reasons populated on any match (mutation smoke)', () => {
    const r = classifyRole('Data Engineer');
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.some((x) => x.includes('data'))).toBe(true);
  });
});
