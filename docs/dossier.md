# Company Dossier

Per-company briefing assembled from operator-configured RSS feeds and
review-site URLs. Grounded synthesis via the same fact/claim guard the
resume-variant and cover-letter services use.

Phase reference: `plan/phase-4-the-hunt.md` (task set C-P4).

## Endpoints

Namespace: `/me/dossier`. Session cookie + CSRF token required.

- `POST /me/dossier/:companyId/refresh` &rarr; `202` with
  `{ jobId, status, dossier }`. Runs the six-stage assembler synchronously
  today; the response shape is job-shaped so a future BullMQ-backed
  refresher can swap in without a client change.
- `GET /me/dossier/:companyId` &rarr; `200` with the cached `DossierDto`,
  or `404` if none exists yet. Never triggers assembly.

Controller: `apps/api/src/modules/dossier/dossier.controller.ts`.
Service: `apps/api/src/modules/dossier/dossier.service.ts`.

## The DossierDto

```
identity      { website, linkedinUrl, employeeCount, hq }
techSignals   { stackHints[], engineeringBlogPosts[] }
reviews       { ambitionbox?, comparably?, reddit? }
interviews    { leetcodeDiscuss?, glassdoorScraped? }
recentEvents  { fundingRounds[], layoffs[], productLaunches[], acquisitions[] }
synthesis     grounded narrative string
factRefs[]    ids of facts the synthesis is bound to
staleAfter    ISO timestamp; refresh returns cache before this
```

All JSON shapes are versioned only implicitly: fields are added, never
renamed. A stale row from an earlier schema still deserialises.

## Six-stage assembly

`DossierService.assembleFor(userId, companyId)` runs these in order; each
stage catches its own errors and audits `dossier.stage.failed` so one bad
fetch never nukes the whole run:

1. `identity` &mdash; the operator-configured `/about` page.
2. `techSignals` &mdash; engineering-blog RSS + stack keyword extraction.
3. `reviews` &mdash; AmbitionBox / Comparably / a Reddit thread search.
4. `interviews` &mdash; LeetCode Discuss + scraped Glassdoor interview signals.
5. `recentEvents` &mdash; RSS news feed classified into funding / layoff /
   launch / acquisition.
6. `synthesize` &mdash; LLM narrative bound to a fact list, then
   `runFactCheck` drops every claim that is not supported.

Freshness ceiling: `STALE_MS = 30 days` (see `plan/phase-4-the-hunt.md:81`).
A cached row inside its window is returned as-is; anything older
re-triggers the pipeline.

## Source hints

Per-company URLs are supplied via `DossierService.registerHints(...)`.
Today the registry is an in-memory map seeded at boot; the ponytail note
on `CompanySourceHints` calls out the upgrade path to a
`company_source_hints` DB table once the operator manages more than a few
companies.

## Grounded synthesis

Facts are `{ id, content, sourceUrl, sourceKind }`. The LLM is asked for a
`{ narrative, claims: [{ text, factRefs }] }` and the response is passed
through `runFactCheck` from `@careeros/ai`; claims whose text is not
supported by their cited facts are dropped, and the surviving `factRefs`
land on the row so the FE can render citations.

## Employer-confidential redaction

If the user's `currentEmployerCompanyId` matches the target company (or
`hints.isCurrentEmployerForUsers` names them), the synthesis stage is run
with `redactSensitive: true` so nothing derived from
`employer-confidential` context leaks into the narrative.

## Safe fetching

Every outbound HTTP goes through `safeFetch` from `@careeros/shared/net`
with the `AssertPublicUrlOptions` allowlist. `hints.extraAllowlist`
augments the default allowlist so a company-specific host (e.g. a
self-hosted blog) can be reached without opening SSRF elsewhere.

## Audit trail

Every assembly emits `dossier.synthesized` with counts of claims kept vs
dropped and whether employer-confidential redaction was on. Per-stage
failures emit `dossier.stage.failed` with the stage name and error.
