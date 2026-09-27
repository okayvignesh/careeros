LinkedIn job-alert HTML fixtures. Every `.html` file has a peer
`.expected.json` describing the `ParsedEmail` shape the parser should yield
(with `receivedAt` fixed to `2026-01-01T09:00:00Z` and `from` set to
`jobs-noreply@linkedin.com` unless the fixture name says otherwise).

The `.meta.json` (optional) lets a fixture override `from` / `subject` /
`receivedAt`. Absent -> defaults from the loader in `linkedin.test.ts`.
