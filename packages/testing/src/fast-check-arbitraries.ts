// Pre-baked fast-check arbitraries for the domain shapes property tests
// hit most: Skill, NormalizedJob, User, ResumeDoc. Kept intentionally loose
// (matches the real schemas without importing them, so this file stays
// dependency-free of every downstream package).
//
// Consumers refine per-test via `.filter` or `.map` rather than adding a
// new arbitrary per case.
import fc from 'fast-check';

// A trimmed non-empty string, so schema `.min(1).trim()` shapes hold.
const nonEmptyString = fc.string({ minLength: 1, maxLength: 120 }).map((s) => s.trim()).filter((s) => s.length > 0);

export const skill = fc.record({
  id: fc.uuid(),
  name: nonEmptyString,
  proficiency: fc.integer({ min: 0, max: 100 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  historicalDemonstrated: fc.integer({ min: 0, max: 1000 }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
});

export const normalizedJob = fc.record({
  id: fc.uuid(),
  title: nonEmptyString,
  company: nonEmptyString,
  location: fc.option(nonEmptyString, { nil: null }),
  remote: fc.boolean(),
  canonicalUrl: fc
    .webUrl()
    .map((u) => u.replace(/\?.*$/, '').replace(/#.*$/, '')),
  sourceId: fc.constantFrom('ashby', 'greenhouse', 'arbeitnow', 'remotive'),
  postedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  description: fc.string({ maxLength: 5000 }),
});

export const user = fc.record({
  id: fc.uuid(),
  email: fc
    .tuple(fc.stringMatching(/^[a-z0-9]{3,12}$/), fc.stringMatching(/^[a-z0-9]{3,12}$/))
    .map(([local, domain]) => `${local}@${domain}.test`),
  displayName: nonEmptyString,
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
});

const resumeSection = fc.record({
  heading: nonEmptyString,
  bullets: fc.array(nonEmptyString, { minLength: 0, maxLength: 8 }),
});

export const resumeDoc = fc.record({
  version: fc.constant(1),
  contact: fc.record({
    name: nonEmptyString,
    email: user.map((u) => u.email),
    location: fc.option(nonEmptyString, { nil: null }),
  }),
  sections: fc.array(resumeSection, { minLength: 1, maxLength: 6 }),
});
