# Job Targeting & Market-Aware Execution — Design Spec (rev 2)

Status: approved design, review-corrected, pending implementation
Date: 2026-10-04
Base: `228898b` (master)
Related: `plan/phase-3-market-engine.md`, `plan/phase-4-the-hunt.md`,
`plan/phase-5-daily-assistant.md`, `AGENTS.md` §3/§4/§5/§8/§9/§11, `docs/codebase/CONCERNS.md`

> rev 2 integrates an independent codebase review + adversarial review. Corrections
> are marked with **[rev2]**. The earlier "not implementable as written" items are
> resolved here; implementers must treat the acceptance criteria as binding.

## 1. Summary

A user picks *the kinds of jobs to apply for* — remote vs local/onsite/hybrid,
domestic vs abroad, which countries/cities, relocation and work-authorization
constraints — and that single **targeting profile** drives everything:
what/where we scrape, relevance + match, market/skill demand, resume tailoring,
cover-letter tailoring, and which skills get trained.

## 2. Decisions (approved with the owner)

1. **Scenario:** home-country onsite + remote roles for foreign employers +
   willingness to relocate abroad (specific countries). Work-authorization and
   sponsorship matter.
2. **Authorization: two-track.** Discovery is permissive: roles are shown with
   `sponsorship: likely | unclear | none` and `authorization: ok | required`
   badges and ranked by fit. **Apply and "recommended for you" are strictly
   gated** to roles the user is authorized for, or that likely sponsor, and that
   are VERIFIED. **[rev2]** eligibility is *necessary but not sufficient*: every
   apply still traverses the approval queue + audit log (AGENTS §3.3).
3. **Tailoring: region-aware format + content, English-only.**
4. **One profile.** `UserJobPreferences` becomes the canonical targeting
   profile; `CareerGoal` stops being a read source for targeting.

## 3. Goals / Non-goals

**Goals:** one enforced targeting profile used by ingest, relevance, match,
market/skill demand, tailoring, and apply gating; structured geography on jobs;
honest sponsorship/authorization signals with strict apply gating; market-scoped
"skills to train"; region-aware English resume + cover documents.

**Non-goals:** multi-language documents; new banned-platform scraping (AGENTS
rule #4); reliable visa adjudication (signals only, never truth); multi-user
*enforcement* (schema stays multi-user-ready).

## 4. Canonical model — TargetingProfile

Extend `UserJobPreferences` (`apps/api/prisma/schema.prisma:941-958`; map
`user_job_preferences`). **[rev2]** Keep the existing `locations String[]`
(legacy free-text, still read by `buildCandidateQueries`, market-brief, and
`JobPreferencesInputSchema`) — do not drop it; `cities Json` is the structured
form.

New fields: `workplaceTypes String[]` (`remote|hybrid|onsite`),
`remoteScopes String[]` (`remote_local|remote_regional|remote_global`),
`countries String[]` (ISO-3166 alpha-2), `cities Json` (`[{country,city}]`),
`homeCountry String?`, `citizenships String[]`, `workAuthorizations String[]`,
`sponsorshipCountries String[]`, `relocationWilling Boolean`,
`relocationCountries String[]`, `timezoneOverlapHours Int?` (unused in P1; see
§7), `language String?` default `en`.

**[rev2] Migrations must be timestamped and ordered after `20261013010000`**,
split into three: `20261014000000_add_targeting_profile_fields` (DDL),
`20261014000100_add_normalized_job_geo` (DDL), and
`20261014000200_backfill_targeting_profile` (data, runs last).

**[rev2] `CareerGoal` unify must be conflict-safe.** `buildCandidateQueries`
reads goal `targetRoles`, `locations`, `remoteOnly`, `seniority`
(`jobs.service.ts:189-192`); `GoalsService.save` writes only `CareerGoal`
(`goals.service.ts:9-26`). The backfill must `INSERT` a profile for users who
have a goal but no prefs row (`JobPreferencesService.get` returns `EMPTY`),
copying `targetRoles`, `locations`, `remoteOnly`, `compMin`, `compMax`,
`currency`, `seniority`, and must be idempotent (run twice = same rows) and
prefer existing non-empty profile values. Keep `CareerGoalsSchema`
(`schemas/index.ts:64-65`, requires `targetRoles`/`locations` `.min(1)`)
satisfiable; the wizard keeps writing `CareerGoal` **and** write-throughs the
profile.

Zod: extend `JobPreferencesInputSchema` (`schemas/index.ts:175-189`) with the new
fields + enums. Acceptance: a grep/contract test proves no targeting read path
uses `CareerGoal.targetRoles/locations`.

## 5. Geo primitives & normalization

**`packages/shared/src/constants/geo.ts`** **[rev2, re-exported from
`constants/index.ts`]**: `Country {code,name,region,currency}` for ISO-3166;
`REGIONS`, `WORKPLACE_TYPES`, `REMOTE_SCOPES`; `isCountry`,
`countriesOfRegion`. **[rev2]** `countryToResumeTemplate` lives in
`packages/resume-render`, not `shared` (avoids coupling `shared` to template ids).

**`packages/job-pipeline/src/stages/geo.ts`** (pure, deterministic, never
throws):
- `parseLocation(raw) → {country?,region?,city?,workplaceType?,remoteScope?,unparsed?}`.
  **[rev2]** Ambiguous city without country context (London, Paris) → `country`
  undefined + `unparsed:true` — never a guessed country. Remote/workplace tokens
  parse independently of location. Unknown input is never dropped; raw is
  preserved (jobs_raw stays append-only, AGENTS §6).
- `sponsorshipSignal(description) → {value:'likely'|'unclear'|'none', matched:string[], confidence}`.
  **[rev2]** `likely` requires ≥1 positive match; negations ("no sponsorship",
  "we do not sponsor", "must be authorized") force `none`; no match → `unclear`
  (never default `likely`). Evidence = matched text + source + `parsedAt` +
  confidence.

**`RawJob` extension [rev2].** `RawJob` (`job-pipeline/src/types.ts:15-28`) has
only `remote`+`location`. Extend `RawJobSchema` and every `map*` (lever drops
`workplaceType` at `lever/index.ts:163`, workday drops `remoteType` at
`workday/index.ts:278`, ashby has `isRemote`) so `workplaceType` survives to
persistence.

**`NormalizedJob`** (`schema.prisma:1070-1094`, migration
`add_normalized_job_geo`): add `country`, `region`, `city`, `workplaceType`,
`remoteScope`, `sponsorshipSignal` (enum), `sponsorshipEvidence Json?`,
`geoParsedAt DateTime?`. Populate on **insert and update** in both ingest paths
(`jobs.service.ts:206-344`, `firecrawl-search.worker.ts:230-260`).

**[rev2] `state` promotion (blocker).** Ingest never writes `NormalizedJob.state`
(rows stay at the default `unverified`); "VERIFIED" is only a verify-stage verdict
(`verify.ts:114,155`) and `scripts/seed-test.ts`. P1 must promote `state`
(lowercase) in the ingest path from the existing verify verdict, and the apply
gate must use `state === 'verified'`. A backfill sets legacy rows conservatively
to `discovered` unless already verified.

**[rev2] New queue for backfill.** `packages/shared/src/queues.ts` has only
`github|gitlab|embedding|firecrawl-search`. Add `jobs.geo-backfill` (stable
`jobId = geo-backfill:<jobId>`, idempotent) or an explicit one-off script;
`geoParsedAt` records completion. **[rev2]** P1 indexes on `(country, region,
workplaceType)` are optional (reads are in-memory over `POOL_ROW_CAP`), but add
them if cheap.

## 6. Scoped ingest

**[rev2] `JobsService.sync` takes only `adapterId` (no `userId`) and adapters are
pre-built singletons (`jobs.service.ts:84-86,107-130`).** Refactor to pass a
market plan: `sync(adapterId, plan)` or per-call `create*Adapter(opts)`.
- Adzuna (`job-pipeline/src/adapters/adzuna.ts:54-102`): pass `country`+`where`
  per target market.
- Firecrawl **[rev2 paths]:** the builder is
  `packages/job-pipeline/src/search/candidate-search.ts:81` +
  `search/query-builder.ts`, not `packages/firecrawl/src/*`. `FirecrawlSearchRequestSchema`
  already supports `country`/`location` (`packages/firecrawl/src/schemas.ts:84-95`);
  change `CandidateSearchRunOptions`/request construction to pass them, and fix
  `mapFirecrawl` which hardcodes `location: null`
  (`adapters/firecrawl/index.ts:222`).
- ATS adapters: fetch public boards, filter/score by country at
  normalize/relevance.
- JSearch/Serpapi: Phase 3 (optional, keys).

Acceptance: an msw test asserts the outbound Adzuna/Firecrawl request **set**
equals the market plan per country, and that non-target countries get zero calls.

## 7. Relevance, match, and gating

**[rev2] `relevance.ts` return shape.** `RelevanceResult` is `{relevant, reason?}`
(single reason, `:32-42`) and cannot carry the new soft signals: add
`signals: RelevanceSignal[]` (additive; `reason` retained for the hard reject).
- Hard rejects (both tracks): stale, company blacklist, dealbreaker skill,
  must-have skill (unchanged), and `remoteOnly` **when** the legacy flag is on
  (kept hard for backward compatibility). **[rev2]** reconcile: `workplaceTypes`
  soft signals only apply when `remoteOnly` is false.
- Discovery soft signals: `workplace_mismatch`, `location_mismatch`,
  `relocation_required`, `authorization_required`, `sponsorship_unclear`,
  `comp_uncomparable`. Soft signals never hide a job.
- **[rev2] Update both consumers:** `jobs.service.list` builds `RelevanceJob` by
  hand (`:398-405`) and `matcher.service.ts:92` builds `ComputeInput` separately.

**[rev2] `match.ts`:** add optional `geoFit` (workplace + country + remote-scope)
and `compFit` to `MatchResult`, defaulted so legacy callers are unchanged.
**[rev2] `compFit` is emitted only when job currency == profile currency;
otherwise `null` + `comp_uncomparable`.** Never compare across currencies.
**[rev2] `timezoneOverlapHours` is removed from P1 `geoFit`** (no tz source/
algorithm yet) — deferred to P2 with an explicit DST-correct overlap spec.

**[rev2] Apply gating.** There is no `isEligibleToApply` today; only approval
state in `ats-submit.service.ts:213-218`. Add
`isEligibleToApply(profile, job)` = `state === 'verified'` AND
(`authorization === ok` OR `sponsorshipSignal === 'likely'`). Null/unparsed geo
or missing signal ⇒ treated as `unclear` ⇒ ineligible for "recommended".
"Recommended for you" uses the same gate + geo-fit threshold. The gate decision
is itself logged. Auto-apply queue remains Phase 3.

**[rev2] Reject logging.** `job_reject_log` is written only by verify-stage ingest
rejections (`jobs.service.ts:263-279`), never by read-time relevance; adding rows
per read would grow unbounded. Rule: geo reject reasons are logged **at
ingest/persist time**; read-time exclusions surface reasons in the API response
(no per-read log). This satisfies AGENTS §5 without unbounded growth.

## 8. Market & skills-to-train scoping

- **[rev2] `aim_role_thresholds`** table `(user_id, role_key, threshold)` with a
  uniqueness constraint (schema multi-user-ready), seeded from the existing
  `role-skill-map.ts` constants; `LearningPriorityService` falls back to the
  current `0.5/0.7` when absent. The constants live in
  `learning-priority.ts:72-73`, so extend `LearningPriorityInput`/the formula —
  not the role map. Keep `historical_demonstrated_proficiency` and
  `current_readiness` distinct in gap math (AGENTS §11).
- `MarketDemandService.loadPool` (`market-demand.service.ts:84-112`) and
  `LearningPriorityService` (`learning-priority.service.ts:41-49`) filter the
  pool by target country/region/workplace. **[rev2]** today learning-priority
  applies **no** prefs filters while loadPool does — unifying is a behavior
  change; make it explicit and test both.
- **[rev2] Update all snapshot consumers:** `SnapshotFilter`/`hashFilter`
  (`snapshot.service.ts:33-38,81`), `prefsToFilter` (`:92`), `DEFAULT_FILTER`
  (`:26`), and `market-brief.service.ts:349-362 loadFilteredPool`, or geo changes
  won't rotate the hash. Key `null` geo explicitly (counted or excluded *with a
  reason*) and test both.
- **quests:** scope flows through `LearningPriorityService` (the generator merely
  calls `priorities.rankFor`, `quest-generator.service.ts:157`).
- **[rev2] daily-brief** uses `remediationTask` (`daily-brief-composer.service.ts:60,70`),
  not learning priorities — add the injection explicitly.
- **[rev2] empty market scope** must degrade gracefully (no crash, no fabricated
  priorities) and stay idempotent.

## 9. Region-aware tailoring

- `generateForJob` (resume `resume-variants.service.ts:118`, cover
  `cover-letters.service.ts:115`) loads the profile: target-role override +
  target region + market.
- **[rev2] Prompts:** two registries exist (`prompts/registry.ts` runtime,
  `prompts/catalog/registry.ts` audit); `verify-prompt-versions.sh:21` scans only
  `catalog/`, and `renderPrompt` throws on a missing placeholder
  (`registry.ts:52-56`). Add `{{targetRole}}`, `{{targetMarket}}`, `{{region}}`
  (+ cover `{{tone}}`) to **both** call sites (`resume-variants.service.ts:152`,
  `cover-letters.service.ts:142`), bump the runtime `version`, and mirror the
  catalog entry (incl. `UNTRUSTED_SYSTEM_CLAUSE`; the existing cover catalog has
  drifted).
- **[rev2] Template ids:** `TemplateId = 'classic'|'dense-tech'|'modern-minimal'`
  but DB defaults are `ats-first`/`standard`; `renderResumePdfByTemplate('ats-first')`
  throws, and `classic` aliases `AtsFirstResume`. Normalize the mapping and
  update **both** render call sites: `resume-variants.service.ts:374` and
  `ats-submit.service.ts:423` (plus `pdf-extract.test.ts`). Add an
  EU/international template to `templates/index.ts`; extend `ResumeDoc`
  (`types.ts:24-34`) with contact/location, **[rev2] sourced from verified facts
  only** (region format must never invent an address).
- `roleTarget` no longer forced to `job.title`
  (`resume-variants.service.ts:230`, `cover-letters.service.ts:206`). Region +
  tone are selected by code from enums, never by an LLM.

## 10. UI

- `JobPreferencesPanel.tsx` + `settings/job-preferences/page.tsx` **[rev2] the
  "collect-only" copy is on `page.tsx:15-16`**: real controls for workplace
  types, remote scope, countries/cities, relocation, authorizations/citizenship.
- `JobsList`: authorization/sponsorship/geo-fit badges; apply-eligibility gate
  with a "why not eligible" explainer. `data-testid` on every new control.

## 11. Testing (binding acceptance criteria)

- **Geo parse fixtures** per format; ambiguous city → `unparsed` (no guessed
  country); re-parse leaves `jobs_raw` byte-unchanged; `parseLocation` never
  throws.
- **Sponsorship** fixture table (negations/ambiguity); property test: confidence
  > 0 ⇒ `matched` non-empty.
- **Two-track truth table** (authorization ok/required × sponsorship
  likely/unclear/none × state verified/discovered): `unclear+required=ineligible`,
  `likely+not verified=ineligible`, `none+required=ineligible`.
- **Scrape scope** (msw): request set == market plan; non-target countries zero
  calls.
- **Backward compatibility:** frozen snapshot test — a legacy caller passing no
  geo gets byte-identical `relevance`/`match` output.
- **Market-scoped skills:** two profiles (e.g. US vs DE) over one corpus produce
  different demand sets **and** different snapshot hashes.
- **Region tailoring:** generated artifact records `templateId` + resolved
  region; cover tone echoes the enum; fact-check gate still blocks unsupported
  claims; new `ResumeDoc` contact/location comes only from verified facts.
- Use `testcontainers`, `msw`, `fast-check` (match math); retries **0**.
- Playwright: targeting settings → jobs list scope + badges → resume with the
  region template. CI (`.github/workflows/pr.yml`) green.

## 12. Phasing & sequencing

- **P1 — spine + enforcement:** geo primitives (re-exported), profile fields +
  timestamped migrations + conflict-safe backfill, `RawJob`+`NormalizedJob` geo,
  parse + sponsorship, `state` promotion, scoped Adzuna/Firecrawl ingest + `sync`
  refactor, relevance `signals[]` + match `geoFit`/`compFit` (same-currency only),
  `isEligibleToApply` two-track gate, `jobs.geo-backfill` queue, settings UI.
- **P2 — skills + tailoring:** geo-scoped market/skill demand + `aim_role_thresholds`
  + market-scoped quests + daily-brief injection + timezoneOverlap in `geoFit`;
  region-aware resume/cover + tone + template wiring + `ResumeDoc` contact.
- **P3 — breadth:** JSearch/Serpapi, per-market comp FX, extra region templates,
  `TrainingResource`, LLM sponsorship signal (Zod-structured).

Sequencing: implemented in the isolated worktree `feat/job-targeting` (base
`228898b`) so it does not collide with `feat/remaining-work` (which owns
`apps/web` + Prisma). Merge conflicts on `schema.prisma` and the web settings
page are expected and resolved deliberately at integration.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sponsorship rarely stated | Heuristic with evidence+confidence; default `unclear`; strict apply gate; never fabricate |
| Free-text locations lossy | Raw + parsed; `unparsed` bucket; backfill queue |
| Currency-incomparable comp | `compFit` only when currencies match; else `null` + reason |
| Merely relabeling prefs | Every layer consumes the profile; enforcement integration tests |
| Breaking existing consumers | `signals[]`/`geoFit` additive; frozen legacy snapshot test |
| P1 gating on unpopulated fields | Backfill precedes gating; null ⇒ `unclear` ⇒ ineligible |
| Scope creep to multi-language | Explicit non-goal |

## 14. Open questions

- Per-market comp bands (P3) vs single pair now — currently single pair + same-currency guard.
- Gazetteer size (top ~200 cities vs full dataset).
- Sponsorship via LLM during `verify` (P3) vs heuristic-only in P1 — leaning heuristic-only.
