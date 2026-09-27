// C-P2.6a: hand-curated prerequisite DAG over the C-P1.3 ESCO skill catalog.
//
// Each entry maps a skill to its IMMEDIATE prerequisites (not full transitive
// closure). Full closure is derived by walking recursively at plan time so the
// data stays cheap to edit -- one truth per edge.
//
// Design choices worth calling out:
//   - Leaf skills (js, python, sql, css, html, linux, bash, git) list [] so
//     the topo sort has real roots and the recursive walk terminates cleanly.
//   - "Language before framework" is the primary axis (react needs js/html/css,
//     nestjs needs nodejs + ts, django needs python).
//   - "Runtime before its ecosystem" (nodejs before express/nestjs, aws before
//     aws-lambda/aws-s3, kubernetes before istio/helm).
//   - We intentionally KEEP the graph shallow. Reaching for "docker requires
//     containers-theory requires operating-systems" is the kind of over-modelling
//     that makes the quest generator produce 40-step trajectories. Two hops max
//     to get from any leaf to any target is the target depth.
//
// All skill IDs must exist in `apps/api/src/seed/esco.data.json`; the test
// validates every referenced id against the seed to catch typos on edit.
//
// ponytail: hand-curated is deliberate -- an LLM-derived prereq graph is
// non-deterministic garbage for a planning surface. Add an edge here when a
// quest plans a nonsensical order; that's how the graph earns growth.

export type SkillId = string;

/** Immediate prerequisites keyed by skill id. Leaves = []. */
export const PREREQ_GRAPH: Record<SkillId, SkillId[]> = {
  // -------- Language leaves + close cousins --------
  js: [],
  ts: ['js'],
  python: [],
  go: [],
  rust: [],
  java: [],
  kotlin: ['java'],
  swift: [],
  csharp: [],
  ruby: [],
  php: [],
  scala: ['java'],
  cpp: [],
  sql: [],
  bash: [],
  html: [],
  css: ['html'],
  graphql: ['rest-api'],

  // -------- Frontend --------
  react: ['js', 'html', 'css'],
  vue: ['js', 'html', 'css'],
  angular: ['ts', 'html', 'css'],
  svelte: ['js', 'html', 'css'],
  nextjs: ['react'],
  nuxt: ['vue'],
  remix: ['react'],
  redux: ['react'],
  tailwind: ['css'],
  sass: ['css'],
  storybook: ['react'],
  vite: ['js'],
  webpack: ['js'],
  'react-native': ['react'],

  // -------- Backend --------
  nodejs: ['js'],
  express: ['nodejs'],
  nestjs: ['nodejs', 'ts'],
  django: ['python'],
  flask: ['python'],
  fastapi: ['python'],
  rails: ['ruby'],
  laravel: ['php'],
  spring: ['java'],
  gin: ['go'],
  actix: ['rust'],
  'rest-api': [],
  openapi: ['rest-api'],
  grpc: ['rest-api'],

  // -------- Data / storage --------
  postgres: ['sql'],
  mysql: ['sql'],
  mongodb: [],
  redis: [],
  elasticsearch: [],
  kafka: [],
  rabbitmq: [],
  clickhouse: ['sql'],
  duckdb: ['sql'],
  bigquery: ['sql'],
  redshift: ['sql'],
  dynamodb: ['aws'],
  cassandra: [],
  snowflake: ['sql'],
  dbt: ['sql'],
  airflow: ['python'],
  spark: ['python'],

  // -------- Cloud --------
  aws: ['linux'],
  gcp: ['linux'],
  azure: ['linux'],
  'aws-lambda': ['aws'],
  'aws-s3': ['aws'],
  'aws-ec2': ['aws', 'linux'],
  'aws-rds': ['aws', 'sql'],
  'aws-ecs': ['aws', 'docker'],
  'aws-cloudformation': ['aws'],
  eks: ['aws', 'kubernetes'],
  gke: ['gcp', 'kubernetes'],
  aks: ['azure', 'kubernetes'],
  cloudflare: [],
  vercel: [],
  netlify: [],

  // -------- DevOps + platform --------
  linux: [],
  git: [],
  docker: ['linux'],
  kubernetes: ['docker', 'linux'],
  helm: ['kubernetes'],
  terraform: ['linux'],
  pulumi: ['ts'],
  ansible: ['linux', 'bash'],
  'ci-cd': ['git'],
  'github-actions': ['ci-cd'],
  'gitlab-ci': ['ci-cd'],
  jenkins: ['ci-cd'],
  circleci: ['ci-cd'],
  argocd: ['kubernetes'],
  nginx: ['linux'],
  'apache-httpd': ['linux'],
  istio: ['kubernetes'],
  envoy: ['kubernetes'],
  consul: ['linux'],
  vault: ['linux'],
  prometheus: ['linux'],
  grafana: ['prometheus'],
  datadog: [],
  sentry: [],
  opentelemetry: [],
  observability: ['prometheus'],
  sre: ['observability', 'linux'],
  'chaos-engineering': ['sre'],

  // -------- Testing --------
  jest: ['js'],
  vitest: ['js'],
  mocha: ['js'],
  cypress: ['js'],
  playwright: ['js'],
  pytest: ['python'],
  junit: ['java'],
  rspec: ['ruby'],
  tdd: [],
  bdd: ['tdd'],
  'property-testing': ['tdd'],

  // -------- ML / data science --------
  ml: ['python'],
  'deep-learning': ['ml'],
  nlp: ['ml'],
  llm: ['nlp'],
  tensorflow: ['ml'],
  pytorch: ['ml'],
  'scikit-learn': ['ml'],
  numpy: ['python'],
  pandas: ['numpy'],
  jupyter: ['python'],
  huggingface: ['llm'],
  langchain: ['llm'],
  rag: ['llm', 'vector-db'],
  'vector-db': [],
  pinecone: ['vector-db'],
  qdrant: ['vector-db'],
  weaviate: ['vector-db'],
  'openai-api': ['llm'],
  'anthropic-api': ['llm'],
  mlops: ['ml', 'ci-cd'],

  // -------- Mobile --------
  android: ['kotlin'],
  ios: ['swift'],
  swiftui: ['swift'],
  'jetpack-compose': ['kotlin'],
  flutter: [],

  // -------- Concepts + roles (soft prereqs kept minimal) --------
  algorithms: [],
  'data-structures': ['algorithms'],
  concurrency: [],
  'distributed-systems': ['concurrency'],
  microservices: ['rest-api', 'docker'],
  'event-driven': ['kafka'],
  ddd: [],
  'design-patterns': [],
  'clean-code': [],
  refactoring: ['clean-code'],
  'system-design': ['distributed-systems'],
  security: [],
  jwt: ['security'],
  oauth: ['security'],
  webauthn: ['security'],
  accessibility: ['html'],
  i18n: [],
  'performance-tuning': [],
  documentation: [],
  'code-review': [],
  'pair-programming': [],
  mentoring: [],
  agile: [],
  scrum: ['agile'],
  kanban: ['agile'],
  'incident-response': ['sre'],
};

/** Immediate prerequisites for a skill. Unknown skill = []. */
export function getPrereqs(skillId: SkillId): SkillId[] {
  return PREREQ_GRAPH[skillId] ?? [];
}

/**
 * Immediate unmet prerequisites for a target skill given a mastered set.
 * Callers wanting the full transitive frontier should walk recursively.
 */
export function getUnmetPrereqs(
  target: SkillId,
  mastered: Set<SkillId>,
): SkillId[] {
  return getPrereqs(target).filter((p) => !mastered.has(p));
}

/**
 * Kahn topological sort restricted to the transitive prereq closure of
 * `targets` minus anything in `mastered`. Result is a legal learning order
 * (each skill appears AFTER all its unmet prereqs).
 *
 * Throws on cycles. Our curated DAG has none; the test asserts this. If a
 * future edit introduces one, we want a loud failure, not a silent partial
 * plan.
 */
export function topoSortForLearning(
  targets: Iterable<SkillId>,
  mastered: Set<SkillId>,
): SkillId[] {
  // 1. Walk the closure, collecting nodes to schedule + their edges.
  const nodes = new Set<SkillId>();
  const stack: SkillId[] = [];
  for (const t of targets) {
    if (!mastered.has(t)) stack.push(t);
  }
  while (stack.length > 0) {
    const cur = stack.pop() as SkillId;
    if (nodes.has(cur)) continue;
    nodes.add(cur);
    for (const p of getPrereqs(cur)) {
      if (!mastered.has(p) && !nodes.has(p)) stack.push(p);
    }
  }

  // 2. Build in-degree over the restricted subgraph.
  const inDeg = new Map<SkillId, number>();
  for (const n of nodes) inDeg.set(n, 0);
  for (const n of nodes) {
    for (const p of getPrereqs(n)) {
      if (nodes.has(p)) inDeg.set(n, (inDeg.get(n) ?? 0) + 1);
    }
  }

  // 3. Kahn queue. Sort roots by id for a deterministic order (matters for
  //    snapshot-style tests + a stable UI).
  const ready: SkillId[] = [];
  for (const [n, d] of inDeg) if (d === 0) ready.push(n);
  ready.sort();

  const out: SkillId[] = [];
  while (ready.length > 0) {
    const n = ready.shift() as SkillId;
    out.push(n);
    // Any node that lists `n` as a prereq loses one in-edge.
    const next: SkillId[] = [];
    for (const m of nodes) {
      if (getPrereqs(m).includes(n)) {
        const d = (inDeg.get(m) ?? 0) - 1;
        inDeg.set(m, d);
        if (d === 0) next.push(m);
      }
    }
    next.sort();
    ready.push(...next);
  }

  if (out.length !== nodes.size) {
    throw new Error(
      `topoSortForLearning: cycle detected in prereq graph (visited ${out.length}/${nodes.size} nodes)`,
    );
  }
  return out;
}
