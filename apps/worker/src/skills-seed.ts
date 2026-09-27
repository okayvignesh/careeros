// Hand-crafted ESCO-lite: a curated tech-skill baseline. Full ESCO import is a slice-2b concern.
// Skill IDs are stable slugs. GitHub language names map to these IDs via GH_LANGUAGE_TO_SKILL.
import type { PrismaClient } from '@prisma/client';

export interface SeedSkill {
  id: string;
  name: string;
  cluster: 'language' | 'framework' | 'tool' | 'domain' | 'practice';
  aliases: string[];
}

export const ESCO_LITE_SKILLS: SeedSkill[] = [
  // Languages
  { id: 'js', name: 'JavaScript', cluster: 'language', aliases: ['ECMAScript', 'ES6', 'ES2020'] },
  { id: 'ts', name: 'TypeScript', cluster: 'language', aliases: [] },
  { id: 'python', name: 'Python', cluster: 'language', aliases: ['Python3', 'CPython'] },
  { id: 'go', name: 'Go', cluster: 'language', aliases: ['Golang'] },
  { id: 'rust', name: 'Rust', cluster: 'language', aliases: [] },
  { id: 'ruby', name: 'Ruby', cluster: 'language', aliases: [] },
  { id: 'java', name: 'Java', cluster: 'language', aliases: [] },
  { id: 'kotlin', name: 'Kotlin', cluster: 'language', aliases: [] },
  { id: 'swift', name: 'Swift', cluster: 'language', aliases: [] },
  { id: 'c', name: 'C', cluster: 'language', aliases: [] },
  { id: 'cpp', name: 'C++', cluster: 'language', aliases: ['Cpp', 'CPP'] },
  { id: 'csharp', name: 'C#', cluster: 'language', aliases: ['CSharp', 'DotNet'] },
  { id: 'php', name: 'PHP', cluster: 'language', aliases: [] },
  { id: 'sql', name: 'SQL', cluster: 'language', aliases: ['PL/SQL', 'T-SQL'] },
  { id: 'shell', name: 'Shell scripting', cluster: 'language', aliases: ['Bash', 'Zsh'] },
  { id: 'html', name: 'HTML', cluster: 'language', aliases: ['HTML5'] },
  { id: 'css', name: 'CSS', cluster: 'language', aliases: ['CSS3', 'Sass', 'SCSS'] },
  // Frameworks (populated in slice 2b from package.json / requirements.txt / etc.)
  { id: 'react', name: 'React', cluster: 'framework', aliases: ['ReactJS'] },
  { id: 'nextjs', name: 'Next.js', cluster: 'framework', aliases: ['Next'] },
  { id: 'nodejs', name: 'Node.js', cluster: 'framework', aliases: ['Node'] },
  { id: 'nestjs', name: 'NestJS', cluster: 'framework', aliases: ['Nest'] },
  { id: 'django', name: 'Django', cluster: 'framework', aliases: [] },
  { id: 'fastapi', name: 'FastAPI', cluster: 'framework', aliases: [] },
  { id: 'rails', name: 'Ruby on Rails', cluster: 'framework', aliases: ['RoR', 'Rails'] },
  { id: 'spring', name: 'Spring Boot', cluster: 'framework', aliases: ['Spring'] },
  // Tools + infra
  { id: 'docker', name: 'Docker', cluster: 'tool', aliases: ['Dockerfile', 'Docker Compose'] },
  { id: 'kubernetes', name: 'Kubernetes', cluster: 'tool', aliases: ['K8s'] },
  { id: 'terraform', name: 'Terraform', cluster: 'tool', aliases: ['HCL'] },
  { id: 'git', name: 'Git', cluster: 'tool', aliases: [] },
  { id: 'aws', name: 'AWS', cluster: 'tool', aliases: ['Amazon Web Services'] },
  { id: 'gcp', name: 'GCP', cluster: 'tool', aliases: ['Google Cloud'] },
  // Practices (targeted by system-design + code-review assessments)
  { id: 'system-design', name: 'System design', cluster: 'practice', aliases: ['SysDes', 'HLD'] },
  { id: 'code-review', name: 'Code review', cluster: 'practice', aliases: ['PR review'] },
];

// GitHub's `languages` endpoint returns names like "JavaScript", "TypeScript", "HCL", etc.
// Keys must match GitHub exactly (case-sensitive). Unknown languages are dropped silently.
export const GH_LANGUAGE_TO_SKILL: Record<string, string> = {
  JavaScript: 'js',
  TypeScript: 'ts',
  Python: 'python',
  Go: 'go',
  Rust: 'rust',
  Ruby: 'ruby',
  Java: 'java',
  Kotlin: 'kotlin',
  Swift: 'swift',
  C: 'c',
  'C++': 'cpp',
  'C#': 'csharp',
  PHP: 'php',
  SQL: 'sql',
  Shell: 'shell',
  HTML: 'html',
  CSS: 'css',
  SCSS: 'css',
  Sass: 'css',
  Dockerfile: 'docker',
  HCL: 'terraform',
};

/** Idempotent. Safe to run on every worker boot. */
export async function seedSkills(prisma: PrismaClient): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const s of ESCO_LITE_SKILLS) {
    const before = await prisma.skill.findUnique({ where: { id: s.id }, select: { id: true } });
    await prisma.skill.upsert({
      where: { id: s.id },
      create: s,
      update: { name: s.name, cluster: s.cluster, aliases: s.aliases },
    });
    if (!before) inserted++;
  }
  return { inserted, total: ESCO_LITE_SKILLS.length };
}
