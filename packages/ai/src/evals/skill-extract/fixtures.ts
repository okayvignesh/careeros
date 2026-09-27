// C-P1.4b: 20+ human-labeled fixtures for the `job-skill-extract` prompt.
//
// Each fixture is a realistic (short) JD or resume paragraph, 80-200 words.
// `expected.skills` are the canonical IDs a well-behaved model should return.
// The catalogue below is the union of ESCO-lite seed IDs
// (apps/worker/src/skills-seed.ts) plus a small eval-only extension for
// terms the seed does not yet cover (graphql, kafka, postgres, ios, android,
// devops, sre). The extended catalogue is fed to the prompt at eval time.

export interface SkillExtractFixture {
  id: string;
  description: string;
  expected: { skills: string[] };
  tags?: string[]; // e.g. 'tricky:acronym', 'tricky:competitor', 'tricky:soft-skill'
}

/**
 * Eval catalogue: ESCO-lite seed + eval-only extensions. IDs match
 * apps/worker/src/skills-seed.ts where they exist; the extras (kafka,
 * graphql, postgres, ios, android, devops, sre) are seeded here so
 * fixtures can label them explicitly. Real production runs use the seed
 * catalogue; expected sets in this file are a superset for pinning drift.
 */
export const EVAL_SKILL_CATALOGUE: ReadonlyArray<{ id: string; name: string }> = [
  // Languages
  { id: 'js', name: 'JavaScript' },
  { id: 'ts', name: 'TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'go', name: 'Go' },
  { id: 'rust', name: 'Rust' },
  { id: 'ruby', name: 'Ruby' },
  { id: 'java', name: 'Java' },
  { id: 'kotlin', name: 'Kotlin' },
  { id: 'swift', name: 'Swift' },
  { id: 'c', name: 'C' },
  { id: 'cpp', name: 'C++' },
  { id: 'csharp', name: 'C#' },
  { id: 'php', name: 'PHP' },
  { id: 'sql', name: 'SQL' },
  { id: 'shell', name: 'Shell scripting' },
  { id: 'html', name: 'HTML' },
  { id: 'css', name: 'CSS' },
  // Frameworks
  { id: 'react', name: 'React' },
  { id: 'nextjs', name: 'Next.js' },
  { id: 'nodejs', name: 'Node.js' },
  { id: 'nestjs', name: 'NestJS' },
  { id: 'django', name: 'Django' },
  { id: 'fastapi', name: 'FastAPI' },
  { id: 'rails', name: 'Ruby on Rails' },
  { id: 'spring', name: 'Spring Boot' },
  // Tools + infra
  { id: 'docker', name: 'Docker' },
  { id: 'kubernetes', name: 'Kubernetes' },
  { id: 'terraform', name: 'Terraform' },
  { id: 'git', name: 'Git' },
  { id: 'aws', name: 'AWS' },
  { id: 'gcp', name: 'GCP' },
  // Practices
  { id: 'system-design', name: 'System design' },
  { id: 'code-review', name: 'Code review' },
  // Eval-only extensions (documented above)
  { id: 'kafka', name: 'Apache Kafka' },
  { id: 'graphql', name: 'GraphQL' },
  { id: 'postgres', name: 'PostgreSQL' },
  { id: 'ios', name: 'iOS development' },
  { id: 'android', name: 'Android development' },
  { id: 'devops', name: 'DevOps' },
  { id: 'sre', name: 'Site reliability engineering' },
];

export function renderEvalCatalogue(): string {
  return EVAL_SKILL_CATALOGUE.map((s) => `- ${s.id} (${s.name})`).join('\n');
}

export const SKILL_EXTRACT_FIXTURES: SkillExtractFixture[] = [
  // ---------- Core coverage: one fixture per required area ----------
  {
    id: 'javascript-frontend',
    description: [
      'We are hiring a frontend engineer to own our marketing site and internal',
      'admin console. Your day-to-day: writing modern JavaScript (ES2022+),',
      'converting Figma designs into responsive HTML and CSS, integrating with',
      'REST APIs, and shipping A/B tests behind feature flags. You will pair',
      'with product on funnel experiments and instrument events for the growth',
      'team. Comfortable with browser devtools, git-based workflows, and code',
      'review culture. Nice to have: some familiarity with a component library,',
      'exposure to accessibility auditing, and experience running Lighthouse',
      'against production builds.',
    ].join(' '),
    expected: { skills: ['js', 'html', 'css', 'git', 'code-review'] },
  },
  {
    id: 'typescript-nextjs-app',
    description: [
      'Product engineer for a Next.js application backed by a Node.js API.',
      'You will write TypeScript end to end, model REST endpoints, and',
      'implement server components alongside client hydration. Expect to touch',
      'the App Router, React Server Components, edge middleware, and image',
      'optimization. You will also review PRs from three teammates weekly and',
      'help maintain the shared UI package. Solid understanding of React state',
      'management, TypeScript generics, and testing with Vitest expected.',
    ].join(' '),
    expected: { skills: ['ts', 'react', 'nextjs', 'nodejs', 'code-review'] },
  },
  {
    id: 'python-fastapi-backend',
    description: [
      'Backend engineer needed for our data-ingest platform. You will build',
      'FastAPI services in Python 3.12, model schemas with Pydantic, and stream',
      'events through Kafka topics. Postgres is our primary store; you will',
      'write SQL migrations with Alembic and tune queries on multi-hundred-GB',
      'tables. All services ship as Docker images and run on a shared',
      'Kubernetes cluster. On-call rotation is one week per month. Comfortable',
      'with async Python, connection pooling, and profiling hot paths.',
    ].join(' '),
    expected: {
      skills: ['python', 'fastapi', 'kafka', 'postgres', 'sql', 'docker', 'kubernetes'],
    },
  },
  {
    id: 'go-microservices',
    description: [
      'Senior Go engineer for a payments platform. You will design and ship',
      'services in Golang, own gRPC contracts across teams, and drive latency',
      'budgets for a hot checkout path serving 20k RPS. Expect deep work in',
      'goroutine scheduling, connection reuse, and Postgres query planning.',
      'The platform runs on AWS behind Envoy; infra is managed with Terraform.',
      'You will also mentor two mid-level engineers and review architecture',
      'proposals in weekly design reviews.',
    ].join(' '),
    expected: { skills: ['go', 'postgres', 'sql', 'aws', 'terraform', 'system-design', 'code-review'] },
  },
  {
    id: 'java-spring-enterprise',
    description: [
      'Backend engineer for our order-management platform. Java 21, Spring',
      'Boot, and Kafka are the core stack; PostgreSQL is the system of record.',
      'You will build REST endpoints, write JUnit tests, package services as',
      'Docker images, and deploy through our GitLab CI pipeline to a Kubernetes',
      'cluster on AWS. Comfortable with JVM tuning, thread-pool sizing, and',
      'reading a heap dump. We expect strong system-design instincts for',
      'multi-tenant workloads.',
    ].join(' '),
    expected: {
      skills: ['java', 'spring', 'kafka', 'postgres', 'sql', 'docker', 'kubernetes', 'aws', 'system-design'],
    },
  },
  {
    id: 'kubernetes-platform-engineer',
    description: [
      'Platform engineer to own our Kubernetes fleet across three regions on',
      'AWS EKS. You will curate base images, own admission controllers, write',
      'operators in Go, and manage cluster upgrades. Terraform is the source',
      'of truth for infra; Helm charts and Kustomize overlays layer on top.',
      'Expect deep involvement in cost optimization, node autoscaling, and',
      'network policy design. On-call for cluster incidents; runbooks live in',
      'git and are reviewed like code.',
    ].join(' '),
    expected: { skills: ['kubernetes', 'aws', 'terraform', 'go', 'git', 'sre'] },
  },
  {
    id: 'aws-solutions-architect',
    description: [
      'Solutions architect for a data-heavy AWS practice. You will design',
      'multi-account landing zones, review Terraform modules, and pair with',
      'app teams on migrations from on-prem PostgreSQL to Aurora. Expect deep',
      'work with IAM, VPC design, S3 lifecycle rules, and Lambda cold-start',
      'tuning. Python is the scripting language of choice for glue code and',
      'runbook automation. Prior consulting experience helpful.',
    ].join(' '),
    expected: { skills: ['aws', 'terraform', 'postgres', 'sql', 'python'] },
  },
  {
    id: 'terraform-iac-lead',
    description: [
      'Infrastructure engineer to own our Terraform monorepo. You will refactor',
      'shared modules, gate changes with tflint and OPA policies, and roll out',
      'provider version bumps across ~40 stacks. Environments run on both AWS',
      'and GCP; your job is to keep parity where it matters and diverge where',
      'it does not. Comfortable writing Go for occasional provider patches and',
      'Bash for pipeline glue.',
    ].join(' '),
    expected: { skills: ['terraform', 'aws', 'gcp', 'go', 'shell'] },
  },
  {
    id: 'react-senior-frontend',
    description: [
      'Senior React engineer for a dashboard product. You will lead the',
      'migration from CRA to Next.js, own the design-system package, and',
      'drive the TypeScript strict-mode rollout. Expect to spend time on state',
      'management (Zustand / React Query), rendering performance, and writing',
      'component tests with Testing Library. You will also do PR review for',
      'three junior engineers and run weekly frontend guild sessions.',
    ].join(' '),
    expected: { skills: ['react', 'nextjs', 'ts', 'code-review'] },
  },
  {
    id: 'nodejs-api-backend',
    description: [
      'Backend engineer for a Node.js API powering our mobile apps. Stack:',
      'NestJS on Node 20, TypeScript, PostgreSQL via Prisma, and Redis for',
      'session cache. You will design GraphQL schemas, write resolvers, and',
      'own the CI pipeline. All services run in Docker containers on a small',
      'ECS cluster on AWS. Nice to have: experience with observability tooling',
      'and structured logging.',
    ].join(' '),
    expected: {
      skills: ['nodejs', 'nestjs', 'ts', 'postgres', 'sql', 'graphql', 'docker', 'aws'],
    },
  },
  {
    id: 'postgres-database-engineer',
    description: [
      'Database engineer specializing in PostgreSQL. You will own our primary',
      'RDS clusters on AWS, tune indexes on 5TB+ tables, and design partitioning',
      'strategies for time-series data. Expect deep work in query plans, VACUUM',
      'tuning, replication topologies, and connection-pool sizing (PgBouncer).',
      'You will also write shell scripts for backup verification and pair with',
      'app teams on schema reviews.',
    ].join(' '),
    expected: { skills: ['postgres', 'sql', 'aws', 'shell'] },
  },
  {
    id: 'sql-analytics-engineer',
    description: [
      'Analytics engineer to own our warehouse layer. Primary tools: dbt on',
      'Snowflake, with heavy day-to-day SQL work. You will design fact and',
      'dimension tables, write tested transformations, and pair with the data',
      'science team on feature definitions. Python is used for ad-hoc analysis',
      'and DAG orchestration in Airflow. Expect stakeholder-facing work with',
      'product and finance teams.',
    ].join(' '),
    expected: { skills: ['sql', 'python'] },
  },
  {
    id: 'graphql-api-engineer',
    description: [
      'API engineer to lead our GraphQL federation project. You will design',
      'subgraph boundaries, own the router config, and drive the migration',
      'from a monolithic REST API written in Node.js. Stack: TypeScript,',
      'Apollo Server, and PostgreSQL. Expect performance work on N+1 patterns,',
      'DataLoader batching, and persisted queries. Comfortable with schema',
      'design and backward-compatibility rules.',
    ].join(' '),
    expected: { skills: ['graphql', 'ts', 'nodejs', 'postgres', 'sql'] },
  },
  {
    id: 'docker-container-platform',
    description: [
      'Container platform engineer. You will curate our base Docker images,',
      'own the internal registry, and drive supply-chain hardening (SBOM,',
      'signed images, provenance attestations). Expect Go work on custom',
      'admission controllers, shell scripting for pipeline glue, and pairing',
      'with app teams on Dockerfile reviews. Kubernetes on AWS is the target',
      'runtime for every workload we support.',
    ].join(' '),
    expected: { skills: ['docker', 'kubernetes', 'aws', 'go', 'shell'] },
  },
  {
    id: 'kafka-streaming-platform',
    description: [
      'Streaming platform engineer. You will own our Kafka clusters across',
      'three environments, tune broker configs for a 200-topic footprint, and',
      'drive the migration to KRaft. Expect Java work on custom Connect',
      'plugins, Python for tooling, and heavy use of the AWS MSK APIs.',
      'Terraform manages every cluster. On-call rotation is shared with the',
      'wider data-platform team.',
    ].join(' '),
    expected: { skills: ['kafka', 'java', 'python', 'aws', 'terraform'] },
  },
  {
    id: 'rust-systems-engineer',
    description: [
      'Systems engineer to work on our high-throughput proxy in Rust. You will',
      'own the async runtime code paths (Tokio), tune allocations, and profile',
      'against production traffic replays. Some C++ is still in the codebase',
      'for legacy plugins; you may need to touch it occasionally. Deployment',
      'is on bare-metal via Kubernetes. Comfortable with unsafe blocks when',
      'warranted, and with lock-free data structures.',
    ].join(' '),
    expected: { skills: ['rust', 'cpp', 'kubernetes'] },
  },
  {
    id: 'ios-swift-engineer',
    description: [
      'Senior iOS engineer for our consumer app. You will ship features in',
      'Swift and SwiftUI, own the CI pipeline (Fastlane, Xcode Cloud), and',
      'pair with the backend team on GraphQL contracts. Expect deep work in',
      'concurrency (Swift async/await), Instruments-based profiling, and',
      'App Store release automation. Comfortable reviewing pull requests and',
      'mentoring two junior engineers.',
    ].join(' '),
    expected: { skills: ['swift', 'ios', 'graphql', 'code-review'] },
  },
  {
    id: 'android-kotlin-engineer',
    description: [
      'Android engineer for a fintech app. Stack: Kotlin with Jetpack Compose,',
      'Coroutines, and Hilt. You will own the payments feature module, write',
      'instrumentation tests, and drive the migration off legacy Java code',
      'paths. The backend is a GraphQL API; the CI runs on GitHub Actions and',
      'ships to internal testers via Firebase. Comfortable pairing with',
      'designers and doing rigorous PR review.',
    ].join(' '),
    expected: { skills: ['kotlin', 'android', 'java', 'graphql', 'git', 'code-review'] },
  },
  {
    id: 'devops-cicd-engineer',
    description: [
      'DevOps engineer to own our developer experience. You will maintain the',
      'GitHub Actions pipelines across ~30 repos, drive test flakiness down,',
      'and own our Terraform modules for AWS. Expect Docker and Kubernetes',
      'work on the platform team, plus Bash and Python for automation. Prior',
      'experience with supply-chain hardening (SLSA, cosign) is a strong plus.',
    ].join(' '),
    expected: {
      skills: ['devops', 'docker', 'kubernetes', 'terraform', 'aws', 'shell', 'python', 'git'],
    },
  },
  {
    id: 'sre-observability',
    description: [
      'Site reliability engineer for our core platform. You will own SLOs for',
      'a Kubernetes-based payments system on AWS, drive incident-response',
      'process, and build observability tooling in Go. Expect deep work on',
      'Prometheus, alert-quality reviews, and postmortem facilitation.',
      'Terraform is the source of truth for our monitoring stack. On-call is',
      'shared across a six-person rotation.',
    ].join(' '),
    expected: { skills: ['sre', 'kubernetes', 'aws', 'go', 'terraform'] },
  },
  {
    id: 'python-django-fullstack',
    description: [
      'Full-stack engineer for our internal tooling. You will write Django',
      'backends in Python and lightweight React frontends in TypeScript. The',
      'stack runs on PostgreSQL, ships as Docker images, and deploys to GCP.',
      'You will also cover on-call for internal apps and pair with data teams',
      'on schema changes. Comfortable with Django ORM query tuning and',
      'writing focused unit tests.',
    ].join(' '),
    expected: {
      skills: ['python', 'django', 'react', 'ts', 'postgres', 'sql', 'docker', 'gcp'],
    },
  },

  // ---------- Tricky cases (>= 3) ----------
  {
    id: 'tricky-acronym-k8s',
    tags: ['tricky:acronym'],
    description: [
      'Cloud platform engineer to own our K8s fleet. Day-to-day: writing',
      'Helm charts, tuning HPA/VPA behaviour, and rolling out cluster',
      'upgrades. We run on AWS EKS with Terraform-managed infra. Bash and',
      'Python cover most of our runbook automation. Expect on-call for',
      'cluster incidents and pairing with app teams on Dockerfile reviews.',
      'Prior experience with GitOps tooling (Argo CD, Flux) is a plus.',
    ].join(' '),
    expected: { skills: ['kubernetes', 'aws', 'terraform', 'shell', 'python', 'docker'] },
  },
  {
    id: 'tricky-competitor-rails-in-js-role',
    tags: ['tricky:competitor'],
    description: [
      'Frontend engineer for our marketing site. Stack: TypeScript, React,',
      'Next.js, and a Node.js BFF layer. We migrated off Ruby on Rails last',
      'year and no longer maintain any Rails code; do not apply if Rails is',
      'the only stack you know. Day-to-day: shipping product pages, writing',
      'component tests, and pairing with design on animation work. Solid Git',
      'workflow and code-review habits expected.',
    ].join(' '),
    expected: { skills: ['ts', 'react', 'nextjs', 'nodejs', 'git', 'code-review'] },
    // note: 'rails' explicitly must NOT be extracted despite the mention.
  },
  {
    id: 'tricky-soft-skill-leadership',
    tags: ['tricky:soft-skill'],
    description: [
      'Engineering manager for a backend team of six. Strong leadership,',
      'communication, and mentorship skills are essential; you will run 1:1s,',
      'own performance reviews, and drive team-level planning. Technical',
      'background: Python, PostgreSQL, and AWS. You will still spend ~20%',
      'time in code review and system-design discussions but will not be a',
      'primary IC. We value emotional intelligence and conflict-resolution',
      'experience as much as depth in any single technology.',
    ].join(' '),
    expected: { skills: ['python', 'postgres', 'sql', 'aws', 'code-review', 'system-design'] },
    // note: 'leadership', 'communication', 'mentorship' are soft skills and
    // must NOT be extracted (catalogue has no soft-skill entries).
  },
];

// Sanity: fixture count must clear the "20+" spec bar. Enforced at import.
if (SKILL_EXTRACT_FIXTURES.length < 20) {
  throw new Error(
    `skill-extract fixtures: need >= 20, have ${SKILL_EXTRACT_FIXTURES.length}`,
  );
}
