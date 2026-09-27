import { describe, expect, it } from 'vitest';
import { classifySeniority } from './classify-seniority';

describe('classifySeniority (C-P3.3)', () => {
  it('Intern in title → intern', () => {
    const r = classifySeniority('Software Engineering Intern');
    expect(r.level).toBe('intern');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('"Summer 2027 Co-op" → intern', () => {
    expect(classifySeniority('Summer 2027 Co-op, Backend').level).toBe('intern');
  });

  it('Junior in title → junior', () => {
    expect(classifySeniority('Junior Frontend Developer').level).toBe('junior');
  });

  it('"New Grad Software Engineer" → junior', () => {
    expect(classifySeniority('New Grad Software Engineer').level).toBe('junior');
  });

  it('"Sr." abbreviation → senior', () => {
    expect(classifySeniority('Sr. Backend Engineer').level).toBe('senior');
  });

  it('Full "Senior" → senior', () => {
    expect(classifySeniority('Senior Data Scientist').level).toBe('senior');
  });

  // Trickies from the ticket.
  it('"Senior QA" → senior (not manager)', () => {
    const r = classifySeniority('Senior QA Engineer');
    expect(r.level).toBe('senior');
  });

  it('"Senior Manager, Platform" → manager (specific-wins)', () => {
    expect(classifySeniority('Senior Manager, Platform Engineering').level).toBe('manager');
  });

  it('"Staff Software Engineer" → staff', () => {
    expect(classifySeniority('Staff Software Engineer').level).toBe('staff');
  });

  it('"Principal Engineer" → principal', () => {
    expect(classifySeniority('Principal Engineer').level).toBe('principal');
  });

  it('"Tech Lead" → lead', () => {
    expect(classifySeniority('Tech Lead, Data Platform').level).toBe('lead');
  });

  it('"Engineering Manager" → manager', () => {
    expect(classifySeniority('Engineering Manager, Infra').level).toBe('manager');
  });

  it('"Director of Engineering" → director', () => {
    expect(classifySeniority('Director of Engineering').level).toBe('director');
  });

  it('"Head of Product" → director', () => {
    expect(classifySeniority('Head of Product').level).toBe('director');
  });

  it('"VP of Engineering" → vp', () => {
    expect(classifySeniority('VP of Engineering').level).toBe('vp');
  });

  it('"Chief Technology Officer" → cxo', () => {
    expect(classifySeniority('Chief Technology Officer').level).toBe('cxo');
  });

  it('"CTO" → cxo', () => {
    expect(classifySeniority('CTO, Platform').level).toBe('cxo');
  });

  it('plain "Software Engineer" (no title signal) → mid, low confidence', () => {
    const r = classifySeniority('Software Engineer');
    expect(r.level).toBe('mid');
    expect(r.confidence).toBeLessThan(0.4);
  });

  it('YOE signal upgrades bare title: "Software Engineer" + "8+ years" → senior', () => {
    const r = classifySeniority(
      'Software Engineer',
      'We are hiring a backend engineer. 8+ years of experience required. You will build our platform.'
    );
    expect(r.level).toBe('senior');
    expect(r.reasons.some((x) => x.includes('YOE'))).toBe(true);
  });

  it('YOE signal upgrades to staff: "5+ years" + mgmt language → staff', () => {
    const r = classifySeniority(
      'Backend Engineer',
      '5+ years experience. You will manage a team of 4 engineers and own the roadmap for our billing platform.'
    );
    expect(r.level).toBe('staff');
    expect(r.reasons.some((x) => x.includes('management-language'))).toBe(true);
  });

  it('YOE + title: takes the higher rank ("Senior" + "12 years" → staff)', () => {
    const r = classifySeniority(
      'Senior Software Engineer',
      'You will lead technical direction. 12 years of experience required.'
    );
    expect(r.level).toBe('staff');
  });

  it('YOE alone with no title lookup: "3-5 years" → mid', () => {
    const r = classifySeniority(
      'Backend Developer',
      'Looking for a developer with 3-5 years of hands-on experience.'
    );
    expect(r.level).toBe('mid');
  });

  it('reasons array is populated (mutation smoke: silent classifier is broken)', () => {
    const r = classifySeniority('Senior Backend Engineer');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('confidence in [0,1]', () => {
    const r = classifySeniority('Senior Engineer');
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('description beyond 500 chars is ignored (no YOE spillover)', () => {
    const filler = 'lorem ipsum '.repeat(50); // ~600 chars of filler first
    const r = classifySeniority('Software Engineer', filler + '10+ years required.');
    // The "10+ years" sits after char 500 so it should NOT bump to staff.
    expect(r.level).toBe('mid');
  });
});
