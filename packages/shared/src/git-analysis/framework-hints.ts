// Framework / tool / infra detection from filename and path signals. Pure
// function. Returns zero or more skill hints per path so a single file
// (e.g. `k8s/production/deployment.yaml`) can raise both "kubernetes" AND
// "yaml".
//
// ponytail: no file-content parsing here — only path + basename. Content
// parsing (peek `package.json` for `next` dep, peek `requirements.txt` for
// `django==`) is the AST-adjacent upgrade path. Keeping this pure means the
// worker doesn't have to read every file; it can raise a framework hint from
// a `git ls-tree` alone.
import { basename } from './language-detect.js';

export interface FrameworkHint {
  skillId: string;
  reason: string; // short label for evidence.detail
}

/**
 * Filename-based hints. Case-insensitive. One filename can raise MULTIPLE
 * skills (e.g. `package.json` → nodejs).
 */
const FILENAME_HINTS: Record<string, FrameworkHint[]> = {
  'package.json': [{ skillId: 'nodejs', reason: 'package.json present' }],
  'package-lock.json': [{ skillId: 'nodejs', reason: 'npm lockfile' }],
  'pnpm-lock.yaml': [{ skillId: 'nodejs', reason: 'pnpm lockfile' }],
  'yarn.lock': [{ skillId: 'nodejs', reason: 'yarn lockfile' }],
  'bun.lockb': [{ skillId: 'nodejs', reason: 'bun lockfile' }],
  'next.config.js': [{ skillId: 'nextjs', reason: 'next.config present' }],
  'next.config.mjs': [{ skillId: 'nextjs', reason: 'next.config present' }],
  'next.config.ts': [{ skillId: 'nextjs', reason: 'next.config present' }],
  'nest-cli.json': [{ skillId: 'nestjs', reason: 'nest-cli present' }],
  'nuxt.config.ts': [{ skillId: 'vue', reason: 'nuxt.config present' }],
  'astro.config.mjs': [{ skillId: 'astro', reason: 'astro.config present' }],
  'svelte.config.js': [{ skillId: 'svelte', reason: 'svelte.config present' }],

  // Python
  'requirements.txt': [{ skillId: 'python', reason: 'requirements.txt' }],
  'pyproject.toml': [{ skillId: 'python', reason: 'pyproject.toml' }],
  'setup.py': [{ skillId: 'python', reason: 'setup.py' }],
  'setup.cfg': [{ skillId: 'python', reason: 'setup.cfg' }],
  'poetry.lock': [{ skillId: 'python', reason: 'poetry lockfile' }],
  'pipfile': [{ skillId: 'python', reason: 'Pipfile' }],
  'pipfile.lock': [{ skillId: 'python', reason: 'Pipfile.lock' }],
  'manage.py': [{ skillId: 'django', reason: 'django manage.py' }],

  // Rust
  'cargo.toml': [{ skillId: 'rust', reason: 'Cargo.toml' }],
  'cargo.lock': [{ skillId: 'rust', reason: 'Cargo.lock' }],

  // Go
  'go.mod': [{ skillId: 'go', reason: 'go.mod' }],
  'go.sum': [{ skillId: 'go', reason: 'go.sum' }],

  // Ruby
  'gemfile': [{ skillId: 'ruby', reason: 'Gemfile' }],
  'gemfile.lock': [{ skillId: 'ruby', reason: 'Gemfile.lock' }],
  'config.ru': [{ skillId: 'rails', reason: 'config.ru (rack)' }],

  // Java / JVM
  'pom.xml': [{ skillId: 'java', reason: 'maven pom.xml' }],
  'build.gradle': [{ skillId: 'java', reason: 'gradle build' }],
  'build.gradle.kts': [{ skillId: 'kotlin', reason: 'gradle kotlin build' }],
  'settings.gradle': [{ skillId: 'java', reason: 'gradle settings' }],

  // .NET
  'nuget.config': [{ skillId: 'csharp', reason: 'nuget config' }],

  // Swift / iOS
  'package.swift': [{ skillId: 'swift', reason: 'swiftpm manifest' }],
  'podfile': [{ skillId: 'swift', reason: 'CocoaPods Podfile' }],

  // Infra
  'dockerfile': [{ skillId: 'docker', reason: 'Dockerfile' }],
  'dockerfile.dev': [{ skillId: 'docker', reason: 'Dockerfile.dev' }],
  'dockerfile.prod': [{ skillId: 'docker', reason: 'Dockerfile.prod' }],
  'docker-compose.yml': [{ skillId: 'docker', reason: 'docker-compose' }],
  'docker-compose.yaml': [{ skillId: 'docker', reason: 'docker-compose' }],
  '.dockerignore': [{ skillId: 'docker', reason: '.dockerignore' }],

  // CI/CD
  '.gitlab-ci.yml': [{ skillId: 'ci-cd', reason: 'gitlab-ci pipeline' }],
  'jenkinsfile': [{ skillId: 'ci-cd', reason: 'Jenkinsfile' }],
  'bitbucket-pipelines.yml': [{ skillId: 'ci-cd', reason: 'bitbucket-pipelines' }],
  '.circleci': [{ skillId: 'ci-cd', reason: 'circleci config dir' }],
  '.travis.yml': [{ skillId: 'ci-cd', reason: 'travis config' }],
  'buildkite.yml': [{ skillId: 'ci-cd', reason: 'buildkite pipeline' }],

  // Terraform / IaC
  'terraform.tfvars': [{ skillId: 'terraform', reason: 'terraform tfvars' }],
  '.terraform.lock.hcl': [{ skillId: 'terraform', reason: 'terraform lockfile' }],

  // Kubernetes / Helm
  'chart.yaml': [{ skillId: 'kubernetes', reason: 'Helm Chart.yaml' }],
  'values.yaml': [{ skillId: 'kubernetes', reason: 'Helm values.yaml' }],
  'kustomization.yaml': [{ skillId: 'kubernetes', reason: 'kustomize manifest' }],
  'kustomization.yml': [{ skillId: 'kubernetes', reason: 'kustomize manifest' }],
  'skaffold.yaml': [{ skillId: 'kubernetes', reason: 'skaffold config' }],

  // Serverless
  'serverless.yml': [{ skillId: 'aws', reason: 'serverless framework' }],
  'template.yaml': [{ skillId: 'aws', reason: 'AWS SAM template' }],
};

/**
 * Path-substring hints. Each entry runs `path.toLowerCase().includes(needle)`.
 * More conservative than filename hints because substrings match anywhere.
 */
const PATH_SUBSTRING_HINTS: Array<{ needle: string; hints: FrameworkHint[] }> = [
  { needle: '.github/workflows/', hints: [{ skillId: 'ci-cd', reason: 'github actions workflow' }] },
  { needle: '.circleci/config', hints: [{ skillId: 'ci-cd', reason: 'circleci config' }] },
  { needle: 'terraform/', hints: [{ skillId: 'terraform', reason: 'terraform dir' }] },
  { needle: '/k8s/', hints: [{ skillId: 'kubernetes', reason: 'k8s manifests dir' }] },
  { needle: '/kubernetes/', hints: [{ skillId: 'kubernetes', reason: 'kubernetes manifests dir' }] },
  { needle: '/helm/', hints: [{ skillId: 'kubernetes', reason: 'helm chart dir' }] },
  { needle: '/manifests/', hints: [{ skillId: 'kubernetes', reason: 'manifests dir' }] },
  { needle: '/migrations/', hints: [{ skillId: 'sql', reason: 'db migrations dir' }] },
];

/**
 * Returns hints for a single file path. Empty array = no signals.
 *
 * A path can raise zero, one, or many hints — matching all applicable
 * filename + substring rules.
 */
export function frameworkHints(path: string): FrameworkHint[] {
  const base = basename(path).toLowerCase();
  const lowered = path.toLowerCase();
  const out: FrameworkHint[] = [];

  const byName = FILENAME_HINTS[base];
  if (byName) out.push(...byName);

  for (const { needle, hints } of PATH_SUBSTRING_HINTS) {
    if (lowered.includes(needle)) out.push(...hints);
  }

  // Dedupe by skillId — a path can trip both `.github/workflows/` and a
  // filename rule; the reason from the first match wins.
  const seen = new Set<string>();
  return out.filter((h) => {
    if (seen.has(h.skillId)) return false;
    seen.add(h.skillId);
    return true;
  });
}

/**
 * Batch variant. Runs frameworkHints() over every path, aggregates by skill,
 * counts how many files raised each hint. Useful for repo-level rollups where
 * "5 files matched terraform" is stronger evidence than one .tf file.
 */
export function aggregateHints(paths: string[]): Array<FrameworkHint & { fileCount: number }> {
  const acc = new Map<string, { reason: string; count: number }>();
  for (const p of paths) {
    for (const h of frameworkHints(p)) {
      const cur = acc.get(h.skillId);
      if (cur) cur.count += 1;
      else acc.set(h.skillId, { reason: h.reason, count: 1 });
    }
  }
  return [...acc.entries()].map(([skillId, v]) => ({
    skillId,
    reason: v.reason,
    fileCount: v.count,
  }));
}
