import {
  SiAmazonwebservices,
  SiC,
  SiCplusplus,
  SiCss3,
  SiDjango,
  SiDocker,
  SiDotnet,
  SiFastapi,
  SiGit,
  SiGnubash,
  SiGo,
  SiGooglecloud,
  SiHtml5,
  SiJavascript,
  SiKotlin,
  SiKubernetes,
  SiNestjs,
  SiNextdotjs,
  SiNodedotjs,
  SiOpenjdk,
  SiPhp,
  SiPostgresql,
  SiPython,
  SiReact,
  SiRuby,
  SiRubyonrails,
  SiRust,
  SiSpringboot,
  SiSwift,
  SiTerraform,
  SiTypescript,
} from '@icons-pack/react-simple-icons';

// Reuse the library's own icon type so `exactOptionalPropertyTypes` doesn't fight us.
type IconComponent = typeof SiJavascript;

// Skill IDs from apps/worker/src/skills-seed.ts. Missing brand logos (Java, C#, generic SQL/Shell)
// route to the closest neutral (OpenJDK for Java, .NET for C#, Postgres for SQL, Bash for shell).
const ICON_MAP: Record<string, IconComponent> = {
  js: SiJavascript,
  ts: SiTypescript,
  python: SiPython,
  go: SiGo,
  rust: SiRust,
  ruby: SiRuby,
  java: SiOpenjdk,
  kotlin: SiKotlin,
  swift: SiSwift,
  c: SiC,
  cpp: SiCplusplus,
  csharp: SiDotnet,
  php: SiPhp,
  sql: SiPostgresql,
  shell: SiGnubash,
  html: SiHtml5,
  css: SiCss3,
  react: SiReact,
  nextjs: SiNextdotjs,
  nodejs: SiNodedotjs,
  nestjs: SiNestjs,
  django: SiDjango,
  fastapi: SiFastapi,
  rails: SiRubyonrails,
  spring: SiSpringboot,
  docker: SiDocker,
  kubernetes: SiKubernetes,
  terraform: SiTerraform,
  git: SiGit,
  aws: SiAmazonwebservices,
  gcp: SiGooglecloud,
};

interface Props {
  skillId: string;
  size?: number;
  className?: string;
  /** 'brand' uses simple-icons default colour; 'muted' uses currentColor (theme tone). */
  tone?: 'brand' | 'muted';
  title?: string;
}

/**
 * Render the canonical logo for a skill ID. Returns `null` when the ID has no mapped icon
 * so callers can fall back to their own visual (initials, generic dot, empty slot).
 */
export function SkillIcon({ skillId, size = 18, className, tone = 'brand', title }: Props) {
  const Cmp = ICON_MAP[skillId];
  if (!Cmp) return null;
  const color = tone === 'brand' ? 'default' : 'currentColor';
  const props: Record<string, unknown> = { size, color };
  if (className) props.className = className;
  if (title) props.title = title;
  return <Cmp {...(props as Parameters<typeof Cmp>[0])} />;
}

/** True if a given skill ID has a mapped brand logo. Cheap lookup for conditional rendering. */
export function hasSkillIcon(skillId: string): boolean {
  return skillId in ICON_MAP;
}
