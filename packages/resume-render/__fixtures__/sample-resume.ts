import type { ResumePdfProps } from '../src/templates/ats-first';

/**
 * Fixed model used by the render + ATS-lint tests. Any change to this fixture
 * intentionally invalidates the byte snapshot; regenerate the snapshot in the
 * same commit as the fixture change.
 */
export const SAMPLE_RESUME: ResumePdfProps = {
  roleTarget: 'Senior Backend Engineer',
  jobCompany: 'Acme Robotics',
  content: {
    summary:
      'Backend engineer with eight years across payments, search, and observability. Ships in TypeScript and Go.',
    sections: [
      {
        heading: 'Experience',
        bullets: [
          { text: 'Led migration of billing service from monolith to three bounded contexts, cutting p99 by 42 percent.' },
          { text: 'Owned rollout of OpenTelemetry across 60 services and trained 20 engineers on trace-first debugging.' },
          { text: 'Designed idempotent webhook retry with signed replay tokens, reducing duplicate charges to zero.' },
        ],
      },
      {
        heading: 'Skills',
        bullets: [
          { text: 'TypeScript, Go, PostgreSQL, Redis, Kafka, Kubernetes, Terraform.' },
          { text: 'Distributed tracing, event sourcing, chaos testing, SLO engineering.' },
        ],
      },
      {
        heading: 'Education',
        bullets: [
          { text: 'BS Computer Science, University of Waterloo, 2017.' },
        ],
      },
    ],
  },
};

/** Flat list of every bullet in the fixture — for round-trip assertions. */
export function allBullets(props: ResumePdfProps): string[] {
  return props.content.sections.flatMap((s) => s.bullets.map((b) => b.text));
}

/** Flat list of every section heading (as it should appear in the PDF, uppercased by the template). */
export function allHeadings(props: ResumePdfProps): string[] {
  return ['Summary', ...props.content.sections.map((s) => s.heading)];
}
