import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryAnalysisView } from './RepositoryAnalysisView';
import { ActivityBars, LanguageBar } from './RepoDetail';
import { colorForIndex } from './analysis-format';
import { deriveViewState, type RepoAnalysis, type RepositoryAnalysisResponse } from './types';

const repo: RepoAnalysis = {
  repoId: '1',
  fullName: 'me/career-os',
  private: true,
  pushedAt: '2026-09-20T00:00:00.000Z',
  lastAnalyzedAt: '2026-10-04T04:12:00.000Z',
  totalBytes: 1000,
  commits: 128,
  languages: [
    { skillId: 'ts', name: 'TypeScript', bytes: 900, percent: 90 },
    { skillId: 'sql', name: 'SQL', bytes: 100, percent: 10 },
  ],
  skills: [
    { skillId: 'ts', name: 'TypeScript', cluster: 'language', evidenceCount: 12, strength: 4, lastSeenAt: '2026-10-01T00:00:00.000Z' },
    { skillId: 'nestjs', name: 'NestJS', cluster: 'framework', evidenceCount: 3, strength: 3, lastSeenAt: '2026-09-01T00:00:00.000Z' },
  ],
  aiAssist: { level: 'medium', meanConfidence: 0.42, flaggedCommits: 2 },
  activity: [
    { weekStart: '2026-09-21', commits: 3 },
    { weekStart: '2026-09-28', commits: 6 },
  ],
};

const data: RepositoryAnalysisResponse = {
  connected: true,
  login: 'me',
  repos: [repo],
  totals: { repos: 1, commits: 128, languages: repo.languages, skills: 2 },
};

const noop = () => {};

function render(overrides: Partial<Parameters<typeof RepositoryAnalysisView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(RepositoryAnalysisView, {
      data,
      loading: false,
      error: null,
      selectedRepo: repo,
      onSelect: noop,
      onRefresh: noop,
      onRetry: noop,
      refreshing: false,
      ...overrides,
    }),
  );
}

describe('deriveViewState', () => {
  it('walks loading → error → disconnected → no-data → ready', () => {
    expect(deriveViewState(true, null, null)).toBe('loading');
    expect(deriveViewState(false, 'boom', null)).toBe('error');
    expect(deriveViewState(false, null, { ...data, connected: false })).toBe('disconnected');
    expect(deriveViewState(false, null, { ...data, repos: [] })).toBe('no-data');
    expect(deriveViewState(false, null, data)).toBe('ready');
  });
});

describe('RepositoryAnalysisView', () => {
  it('renders the loading skeleton', () => {
    const html = render({ loading: true, data: null, selectedRepo: null });
    expect(html).toContain('data-testid="repo-analysis-skeleton"');
  });

  it('renders the error state with a retry control', () => {
    const html = render({ error: 'network down', data: null, selectedRepo: null });
    expect(html).toContain('data-testid="repo-analysis-error"');
    expect(html).toContain('data-testid="repo-analysis-retry"');
    expect(html).toContain('network down');
  });

  it('renders the disconnected state with a CTA to Integrations', () => {
    const html = render({ data: { ...data, connected: false, repos: [] }, selectedRepo: null });
    expect(html).toContain('data-testid="repo-analysis-connect"');
    expect(html).toContain('href="/settings/integrations"');
    expect(html).toContain('Connect GitHub');
  });

  it('renders the ready state with repo, language mix, skills and AI level', () => {
    const html = render();
    expect(html).toContain('me/career-os');
    expect(html).toContain('data-testid="repo-analysis-repo-1"');
    expect(html).toContain('data-testid="repo-analysis-open-github"');
    expect(html).toContain('TypeScript');
    expect(html).toContain('90%');
    expect(html).toContain('strength 4');
    expect(html).toContain('Medium');
    expect(html).toContain('128');
  });
});

describe('analysis chart parts', () => {
  it('LanguageBar renders an accessible stacked bar', () => {
    const html = renderToStaticMarkup(createElement(LanguageBar, { languages: repo.languages }));
    expect(html).toContain('role="img"');
    expect(html).toContain('Language mix: TypeScript 90%, SQL 10%');
  });

  it('LanguageBar explains the empty case', () => {
    const html = renderToStaticMarkup(createElement(LanguageBar, { languages: [] }));
    expect(html).toContain('No language data analysed');
  });

  it('ActivityBars labels the week window', () => {
    const html = renderToStaticMarkup(createElement(ActivityBars, { activity: repo.activity }));
    expect(html).toContain('role="img"');
    expect(html).toContain('Commits per week for the last 2 weeks');
  });

  it('cycles the chart palette stably', () => {
    expect(colorForIndex(0)).toBe(colorForIndex(6));
    expect(colorForIndex(1)).not.toBe(colorForIndex(2));
  });
});
