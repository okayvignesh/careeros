import { describe, it, expect } from 'vitest';
import { frameworkHints, aggregateHints } from './framework-hints';

describe('frameworkHints', () => {
  it('raises nodejs on package.json', () => {
    const hits = frameworkHints('package.json');
    expect(hits.map((h) => h.skillId)).toContain('nodejs');
  });

  it('raises nextjs on next.config', () => {
    expect(frameworkHints('apps/web/next.config.mjs').some((h) => h.skillId === 'nextjs')).toBe(
      true,
    );
  });

  it('raises rust on Cargo.toml', () => {
    expect(frameworkHints('services/core/Cargo.toml').some((h) => h.skillId === 'rust')).toBe(true);
  });

  it('raises python on requirements.txt AND pyproject.toml', () => {
    expect(frameworkHints('requirements.txt').some((h) => h.skillId === 'python')).toBe(true);
    expect(frameworkHints('a/pyproject.toml').some((h) => h.skillId === 'python')).toBe(true);
  });

  it('raises docker on Dockerfile (case insensitive)', () => {
    expect(frameworkHints('Dockerfile').some((h) => h.skillId === 'docker')).toBe(true);
    expect(frameworkHints('services/api/dockerfile').some((h) => h.skillId === 'docker')).toBe(true);
  });

  it('raises kubernetes on k8s path substring', () => {
    expect(frameworkHints('infra/k8s/prod/deployment.yaml').some((h) => h.skillId === 'kubernetes')).toBe(
      true,
    );
  });

  it('raises terraform on tfvars', () => {
    expect(frameworkHints('env/prod/terraform.tfvars').some((h) => h.skillId === 'terraform')).toBe(
      true,
    );
  });

  it('raises ci-cd on github actions workflow path', () => {
    expect(frameworkHints('.github/workflows/pr.yml').some((h) => h.skillId === 'ci-cd')).toBe(true);
  });

  it('returns empty for irrelevant paths', () => {
    expect(frameworkHints('README.md')).toEqual([]);
    expect(frameworkHints('src/index.ts')).toEqual([]);
  });

  it('dedupes skills on a single path', () => {
    // Dockerfile inside a k8s dir would not double-fire docker.
    const hits = frameworkHints('infra/k8s/Dockerfile');
    const skills = hits.map((h) => h.skillId);
    expect(new Set(skills).size).toBe(skills.length);
  });
});

describe('aggregateHints', () => {
  it('sums per-skill file counts across a batch', () => {
    const paths = [
      'infra/k8s/a.yaml',
      'infra/k8s/b.yaml',
      'services/core/Cargo.toml',
      'services/core/Cargo.lock',
      'Dockerfile',
      'docker-compose.yml',
    ];
    const agg = aggregateHints(paths);
    const bySkill = Object.fromEntries(agg.map((a) => [a.skillId, a.fileCount]));
    expect(bySkill['kubernetes']).toBe(2);
    expect(bySkill['rust']).toBe(2);
    expect(bySkill['docker']).toBe(2); // Dockerfile + docker-compose.yml
  });

  it('is empty for empty input', () => {
    expect(aggregateHints([])).toEqual([]);
  });
});
