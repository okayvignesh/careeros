import { describe, expect, it } from 'vitest';
import { allPrompts, renderPrompt } from './registry';
import './index'; // side-effect: register every runtime prompt

/**
 * P2b: region/role/market targeting variables on the runtime registry.
 * `renderPrompt` throws on a missing placeholder (registry.ts), so these tests
 * pin both the placeholders and the version bumps the API call sites rely on.
 */
const RESUME_VARS = {
  jobTitle: 'Staff Engineer',
  jobCompany: 'Globex',
  targetRole: 'Site Reliability Engineer',
  targetMarket: 'Germany',
  region: 'europe',
  jobDescription: '<untrusted source="job-description">x</untrusted>',
  facts: '- id=f1 kind=employment SRE @ Acme',
  candidateSkills: 'typescript, terraform',
};

const COVER_VARS = { ...RESUME_VARS, tone: 'professional' };

describe('targeting prompt variables', () => {
  it('tailored-resume-writer renders targetRole / targetMarket / region', () => {
    const r = renderPrompt('tailored-resume-writer', RESUME_VARS);
    expect(r.version).toBe('2.0.0');
    expect(r.user).toContain('Target role (frame the resume for this role): Site Reliability Engineer');
    expect(r.user).toContain('Target market: Germany');
    expect(r.user).toContain('Target region: europe');
    expect(r.user).not.toContain('{{');
    // MUTATION-SMOKE: drop one placeholder from the template and the service
    // call site still compiles but this `toContain` fails.
  });

  it('cover-letter-writer renders targetRole / targetMarket / region / tone', () => {
    const r = renderPrompt('cover-letter-writer', COVER_VARS);
    expect(r.version).toBe('2.0.0');
    expect(r.user).toContain('Target role (frame the letter for this role): Site Reliability Engineer');
    expect(r.user).toContain('Target market: Germany');
    expect(r.user).toContain('Target region: europe');
    expect(r.user).toContain('Tone: professional');
    expect(r.user).not.toContain('{{');
  });

  it('renderPrompt throws when a targeting placeholder is absent (no literal ships)', () => {
    const { targetRole: _omit, ...missing } = RESUME_VARS;
    void _omit;
    expect(() => renderPrompt('tailored-resume-writer', missing)).toThrow(
      /missing variable '\{\{targetRole\}\}'/,
    );
  });

  it('registry exposes the v2 targeting prompt versions', () => {
    const versionById = new Map(allPrompts().map((p) => [p.id, p.version]));
    expect(versionById.get('tailored-resume-writer')).toBe('2.0.0');
    expect(versionById.get('cover-letter-writer')).toBe('2.0.0');
  });
});
