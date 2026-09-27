// Runnable self-check for the Remotive mapper.
// Run: pnpm --filter @careeros/job-pipeline exec tsx src/adapters/remotive.demo.ts
import assert from 'node:assert/strict';
import { RawJobSchema } from '../types';
import { mapRemotive, type RemotiveJob } from './remotive';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

const FIXTURE: RemotiveJob = {
  id: 1839272,
  url: 'https://remotive.com/remote-jobs/software-dev/senior-full-stack-engineer-1839272',
  title: 'Senior Full-Stack Engineer',
  company_name: 'Acme Remote Co',
  candidate_required_location: 'Worldwide',
  publication_date: '2026-09-24T14:12:00',
  description: '<p>Build things.</p>',
  job_type: 'full_time',
  salary: '$120k - $160k',
  category: 'Software Development',
};

label('mapRemotive produces a RawJob that validates against the schema', () => {
  const raw = mapRemotive(FIXTURE);
  const parsed = RawJobSchema.parse(raw);
  assert.equal(parsed.sourceId, '1839272');
  assert.equal(parsed.sourceName, 'remotive');
  assert.equal(parsed.canonicalUrl, FIXTURE.url);
  assert.equal(parsed.title, FIXTURE.title);
  assert.equal(parsed.company, FIXTURE.company_name);
  assert.equal(parsed.location, 'Worldwide');
  assert.equal(parsed.remote, true);
});

label('mapRemotive: empty location string becomes null', () => {
  const raw = mapRemotive({ ...FIXTURE, candidate_required_location: '' });
  assert.equal(raw.location, null);
});

label('mapRemotive: unparseable publication_date becomes null (no throw)', () => {
  const raw = mapRemotive({ ...FIXTURE, publication_date: 'nonsense' });
  assert.equal(raw.sourcePostedAt, null);
});

label('mapRemotive: sourceId is always a string, even from numeric API id', () => {
  const raw = mapRemotive({ ...FIXTURE, id: 42 });
  assert.equal(raw.sourceId, '42');
  assert.equal(typeof raw.sourceId, 'string');
});

label('mapRemotive: original payload preserved for provenance', () => {
  const raw = mapRemotive(FIXTURE);
  assert.deepEqual(raw.payload, FIXTURE);
});

// eslint-disable-next-line no-console
console.log('\nall remotive mapper checks passed');
