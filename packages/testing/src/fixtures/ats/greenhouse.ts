// Realistic Greenhouse Harvest POST /v1/candidates response fixtures,
// approximated from https://developers.greenhouse.io/harvest.html#post-add-candidate.
//
// Greenhouse Harvest doesn't do multipart for candidate create - resume
// attachments go inline as `attachments: [{ filename, type, content, content_type }]`
// where `content` is base64 of the file bytes. The adapter encodes before send;
// the fixture here is the POST response, not the request body.

export const GREENHOUSE_CANDIDATES_URL = 'https://harvest.greenhouse.io/v1/candidates';

export const greenhouseSuccess = {
  id: 17681345007,
  first_name: 'Jane',
  last_name: 'Candidate',
  company: null,
  title: null,
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  last_activity: '2026-10-01T12:00:00.000Z',
  is_private: false,
  photo_url: null,
  attachments: [
    {
      filename: 'resume.pdf',
      url:
        'https://prod-heroku.s3.amazonaws.com/person_attachments/resume.pdf?signature=redacted',
      type: 'resume',
      created_at: '2026-10-01T12:00:00.000Z',
    },
  ],
  application_ids: [52837201003],
  phone_numbers: [],
  addresses: [],
  email_addresses: [
    { value: 'jane@example.com', type: 'personal' },
  ],
  website_addresses: [],
  social_media_addresses: [],
  recruiter: null,
  coordinator: null,
  can_email: true,
  tags: [],
  applications: [
    {
      id: 52837201003,
      candidate_id: 17681345007,
      prospect: false,
      applied_at: '2026-10-01T12:00:00.000Z',
      rejected_at: null,
      last_activity_at: '2026-10-01T12:00:00.000Z',
      source: { id: 1, public_name: 'Direct Application' },
      status: 'active',
      jobs: [{ id: 12345, name: 'Senior Software Engineer' }],
      current_stage: { id: 999, name: 'Application Review' },
      url: 'https://app.greenhouse.io/people/17681345007?application_id=52837201003',
    },
  ],
} as const;

// Greenhouse 422 shape: `{ errors: [{ field, message }] }`.
export const greenhouseFailure = {
  errors: [
    {
      field: 'applications/0/job_id',
      message: 'Must be a valid Greenhouse job id',
    },
  ],
} as const;

export const greenhouseRateLimited = {
  message: 'You have exceeded the rate limit. Please retry.',
  errors: [],
} as const;
