Naukri job-alert HTML fixtures. Default sender: `mailer@naukri.com`;
override per-fixture in `.meta.json` for `alerts@naukri.com`. Naukri URLs
appear either as SEO slugs (`naukri.com/job-listings-...`) or as
`nma.naukri.com/dem/mail/redirect?url=<encoded>` tracker wrappers — the
parser unwraps the tracker before dedup.
