// Realistic Ashby application.create response fixtures (approximated from
// https://developers.ashbyhq.com/reference/applicationcreate). Fields match
// the Ashby public API envelope { success, results, errors }.
//
// Keep this list minimal: one happy, one terminal failure. Not an enumeration
// of every HTTP status; the adapter unit tests cover the retry-classification
// matrix via mocked fetch.

export const ASHBY_APPLICATION_CREATE_URL = 'https://api.ashbyhq.com/application.create';

export const ashbySuccess = {
  success: true,
  errors: [],
  results: {
    application: {
      id: 'd5a7bd26-7a12-4d55-9b70-9d1f2c0a3cf7',
      createdAt: '2026-10-01T12:00:00.000Z',
      status: 'Active',
      applicationUrl:
        'https://app.ashbyhq.com/applications/d5a7bd26-7a12-4d55-9b70-9d1f2c0a3cf7',
      candidate: {
        id: 'c7f0a2c9-02d2-4f41-bc55-8d6b8c1b7001',
        name: 'Jane Candidate',
        primaryEmailAddress: {
          value: 'jane@example.com',
          type: 'personal',
          isPrimary: true,
        },
      },
      jobPosting: {
        id: 'job-xyz',
        title: 'Senior Software Engineer',
      },
    },
  },
} as const;

// Ashby returns 400 with `{ success: false, errors: [...] }` for most input
// errors; shape taken from their published error examples.
export const ashbyFailure = {
  success: false,
  errors: ['jobPostingId is not open for applications'],
  results: null,
} as const;

export const ashbyRateLimited = {
  success: false,
  errors: ['Rate limit exceeded. Retry after 60 seconds.'],
  results: null,
} as const;
