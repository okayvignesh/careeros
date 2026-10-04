# Job Targeting & Market-Aware Execution — Design Spec

Status: approved design, pending review + implementation
Date: 2026-10-04
Base: `429c1b9` (master)
Related: `plan/phase-3-market-engine.md`, `plan/phase-4-the-hunt.md`,
`plan/phase-5-daily-assistant.md`, `AGENTS.md` §3/§4/§5/§8/§9/§11, `docs/codebase/CONCERNS.md`

## 1. Summary

A user picks *the kinds of jobs to apply for* — remote vs local/onsite/hybrid,
domestic vs abroad, which countries/cities, relocation and work-authorization
constraints — and that single **targeting profile** drives everything:
what/where we scrape, relevance + match, market/skill demand, resume tailoring,
cover-letter tailoring, and which skills get trained.

Today these preferences are mostly collected-but-ignored, geography is a
free-text string, and tailoring/market/training are geography-blind. This spec
makes targeting the spine of the pipeline.

## 2. Decisions (approved with the owner)

1. **Scenario:** home-country onsite + remote roles for foreign employers +
   willingness to relocate abroad (specific countries). Work-authorization and
   sponsorship matter.
2. **Authorization: two-track.** Discovery is permissive: roles are shown with
   `sponsorship: likely | unclear | none` and `authorization: ok | required`
   badges and ranked by fit. **Apply and "recommended for you" are strictly
   gated** to roles the user is authorized for, or that likely sponsor, and that
   are VERIFIED. Auto-apply never targets ineligible roles.
3. **Tailoring: region-aware format + content, English-only.** Select the
   document template from the target region (US ATS vs EU/international CV),
   tailor content to target role + market, add a selectable cover-letter tone.
   No multi-language generation in this scope.
4. **One profile.** `UserJobPreferences` becomes the canonical targeting
   profile; `CareerGoal` stops being a competing source.

## 3. Goals / Non-goals

**Goals**
- One enforced targeting profile used by ingest, relevance, match, market/skill
  demand, tailoring, and apply gating.
- Structured geography on jobs (country/region/city/workplace/remote-scope).
- Honest sponsorship/authorization signals; strict apply gating.
- Market-scoped "skills to train" (quests already derive from learning priority).
- Region-aware resume + cover documents (English).

**Non-goals (this scope)**
- Multi-language document generation.
- New banned-platform scraping (LinkedIn/Indeed/Naukri/Glassdoor stay
  email-alert/agent-only per AGENTS rule #4).
- Reliable visa adjudication — sponsorship is a heuristic signal, never truth.
- Multi-user enforcement (single-user product; schema stays multi-user-ready).

## 4. Canonical model — TargetingProfile

Extend `UserJobPreferences` (`apps/api/prisma/schema.prisma:941-958`;
map `user_job_preferences`) — migration `add_targeting_profile_fields`:

| Field | Type | Notes |
|---|---|---|
| `workplaceTypes` | `String[]` | `remote \| hybrid \| onsite` |
| `remoteScopes` | `String[]` | `remote_local \| remote_regional \| remote_global` |
| `countries` | `String[]` | ISO-3166 alpha-2 target countries |
| `cities` | `Json` | `[{country, city}]` structured |
| `homeCountry` | `String?` | alpha-2 |
| `citizenships` | `String[]` | alpha-2 |
| `workAuthorizations` | `String[]` | countries usable without sponsorship |
| `sponsorshipCountries` | `String[]` | countries where sponsorship is needed |
| `relocationWilling` | `Boolean` | |
| `relocationCountries` | `String[]` | alpha-2 |
| `timezoneOverlapHours` | `Int?` | min overlap for remote roles |
| `language` | `String?` | default `en` |

Keep `targetRoles`, `seniority`, `mustHaveSkills`, `dealbreakerSkills`,
`companyBlacklist`. `compMin/Max/currency` become per-market (see §9 /
Phase 3); for now keep a single pair and label the limitation.

**Unify `CareerGoal`.** `CareerGoal.targetRoles/locations` (`schema.prisma:498`)
stop being read for targeting. The goals wizard (`apps/web/.../11-goals`,
`goals.service.ts`) writes through to the profile. `CareerGoal` keeps
`timezone` + `currency` (and is the migration backfill source if the profile is
empty). Add a one-time backfill in the migration or an idempotent service step.

Zod: extend `JobPreferencesInputSchema`
(`packages/shared/src/schemas/index.ts:175-189`) with the new fields + enums.

## 5. Geo primitives & normalization

**New `packages/shared/src/constants/geo.ts`:**
- `Country` = `{ code, name, region, currency, docConvention }` for all
  ISO-3166 alpha-2 (compact static dataset; no runtime dependency).
- `REGIONS`, `WORKPLACE_TYPES`, `REMOTE_SCOPES` enums; `countryToCurrency`,
  `countryToResumeTemplate` (region→template mapping).
- Helpers: `isCountry(code)`, `countriesOfRegion(region)`.

**New pure `packages/job-pipeline/src/stages/geo.ts`:**
- `parseLocation(raw: string): { country?, region?, city?, workplaceType?, remoteScope?, unparsed?: true }`.
  Deterministic: country names/aliases + region tokens (`EMEA`, `APAC`, `LATAM`,
  `EU`), remote tokens (`remote`, `anywhere`, `work from home`), workplace tokens
  (`hybrid`, `onsite`), and a curated major-city gazetteer. Store raw + parsed;
  never drop a job for an unrunnable parse — mark it `unparsed`.
- `sponsorshipSignal(description): { value: 'likely'|'unclear'|'none', matched: string[], confidence }`
  from posting-text heuristics (`we sponsor`, `no sponsorship`, `must be
  authorized to work`, `visa`). Honest default `unclear`.

**`NormalizedJob`** (`schema.prisma:1070-1094`) — migration
`add_normalized_job_geo`: add `country`, `region`, `city`, `workplaceType`,
`remoteScope`, `sponsorshipSignal` (enum), `sponsorshipEvidence Json?`. Populate
from every adapter (lever/workday/ashby already expose workplace type). Persist a
`geoParsedAt` so a backfill worker can re-parse old rows.

## 6. Scoped ingest

- `JobsService.sync` (`apps/api/src/modules/jobs/jobs.service.ts:107-130`) builds
  a **market plan** from the profile and passes it to adapters instead of
  `fetch()` with no args.
- Adzuna (`packages/job-pipeline/src/adapters/adzuna.ts:54-102`): pass `country`
  + `where` per target market.
- Firecrawl (`packages/firecrawl/src/candidate-search.ts:81`): pass structured
  `country`/`location`; expand `query-builder.ts` to include countries + remote
  scope.
- ATS adapters: keep fetching public boards, then filter/score by country at
  normalize/relevance (boards rarely expose server-side country filters).
- JSearch / Serpapi adapters are **out of Phase 1** (Phase 3, optional, keys).

## 7. Relevance, match, and gating

**`relevance.ts`** (`packages/job-pipeline/src/stages/relevance.ts:10-15,46-75`):
extend `RelevancePrefs`/`RelevanceJob`/`RelevanceReason` with
`workplaceTypes`, `countries`, `workAuthorizations`, `sponsorshipSignal`,
`remoteOnly` (kept). Rules:
- Hard rejects (both tracks): stale, company blacklist, dealbreaker skill.
- Discovery soft signals (never hide on their own): `workplace_mismatch`,
  `location_mismatch`, `relocation_required`, `authorization_required`,
  `sponsorship_unclear`.
- Must-have skills stay a hard reject as today.

**`match.ts`** (`packages/job-pipeline/src/stages/match.ts:124-237`):
`computeMatch` returns sub-scores `skillFit` (dominant), `geoFit`
(workplace + country + remote-scope + timezone overlap), `compFit?`. `MatchResult`
exposes them. Skill scoring unchanged.

**Apply gating** (`applications.service.ts:50-72`, `ats-submit/**`):
`isEligibleToApply(profile, job)` = `authorization == ok || sponsorshipSignal == 'likely'`
AND `job.state == VERIFIED`. "Recommended for you" uses the same gate plus a
geo-fit threshold. `job_reject_log` gains geo reason codes so the existing
"why didn't I see this job?" audit UI can explain.

## 8. Market & skills-to-train scoping

- `MarketDemandService.loadPool` (`market-demand.service.ts:84-112`) and
  `LearningPriorityService` (`learning-priority.service.ts:41-49`) filter the job
  pool by target country/region/workplace so demand and priorities reflect the
  chosen market. `SnapshotFilter`/`hashFilter` include geo.
- Persist role thresholds (new `aim_role_thresholds` table or extend
  `role-skill-map.ts`) and feed `LearningPriorityService` so `role_gap` uses a
  real target per role instead of the fixed `0.5/0.7` constants.
- `quest-generator.service.ts:157` receives the market scope, so generated
  quests train toward the target market's demand.
- `daily-brief-composer.service.ts:60` adds the top learning priorities.
- Unify demand: `LearningPriorityService` consumes `MarketDemandService` rather
  than duplicating the query (`learning-priority.service.ts:41`).

## 9. Region-aware tailoring

- `resume-variants.service.ts:118 generateForJob` and
  `cover-letters.service.ts:115 generateForJob` load the targeting profile
  (target role override + target region + market).
- Prompts (`tailored-resume-writer.ts:27-43`, `cover-letter-writer.ts:26-38`)
  gain `{{targetRole}}`, `{{targetMarket}}`, `{{region}}`; cover gains `{{tone}}`.
  Fact-check gate (`grounded/gate.ts`, AGENTS rule #2) unchanged.
- Wire `templateId` through `renderResumePdfByTemplate`
  (`packages/resume-render/src/index.ts:29`) instead of the hardcoded
  `renderResumePdf` (`:17`). Add an EU/international template to
  `templates/index.ts` and extend `ResumeDoc` (`types.ts:24-34`) with
  contact/location/links (currently absent, `types.ts:8-10`).
- `roleTarget` no longer forced to `job.title`
  (`resume-variants.service.ts:230`, `cover-letters.service.ts:206`).

## 10. UI

- `JobPreferencesPanel.tsx:70-155` + `settings/job-preferences/page.tsx`: real
  controls for workplace types, remote scope, countries/cities, relocation,
  authorizations/citizenship; stop labeling fields "collect-only".
- `JobsList`: show authorization/sponsorship/geo-fit badges; add the
  apply-eligibility gate and a "why not eligible" explainer.
- Settings index/nav discoverability.

## 11. Testing

- Unit: `parseLocation` (fixtures per format), `sponsorshipSignal`,
  relevance geo rules, `computeMatch` sub-scores, template selection.
- Integration (Vitest + testcontainers): profile CRUD → scoped sync (msw) →
  relevance/match → apply gate; tailoring region/tone selection.
- Playwright: targeting settings → jobs list reflects scope + badges → resume
  generated with the region template.
- CI (`.github/workflows/pr.yml`) must be green.

## 12. Phasing & sequencing

- **Phase 1 — spine + enforcement (P1):** geo primitives, profile fields +
  migration/unify, `NormalizedJob` geo + parse + sponsorship signal, scoped
  Adzuna/Firecrawl ingest, relevance soft signals + match `geoFit`, two-track
  gating, settings UI. End-to-end "remote/local/abroad" behavior.
- **Phase 2 — skills + tailoring (P2):** geo-scoped market/skill demand + role
  thresholds + market-scoped quests + daily-brief priorities; region-aware
  resume/cover + tone + template wiring + `ResumeDoc` contact/location.
- **Phase 3 — breadth:** JSearch/Serpapi adapters, per-market comp normalization
  (FX), extra region templates, `TrainingResource` model, domicile/visa
  enrichment.

Sequencing: this work has its own isolated worktree (`feat/job-targeting`) so it
does not collide with the running `feat/remaining-work` workstreams that own
`apps/web` and `apps/api/prisma`. Merge conflicts on `schema.prisma` and the web
settings page are expected at integration and resolved deliberately.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sponsorship rarely stated; can't be trusted | Heuristic signal with evidence + confidence; default `unclear`; strict apply gate; never fabricate |
| Free-text locations lossy | Keep raw + parsed; explicit `unparsed` bucket; backfill worker |
| Cross-currency comp comparison | Phase 3; label the limitation meanwhile |
| Merely relabeling prefs without enforcement | Every layer must *consume* the profile; integration tests assert enforcement |
| Breaking existing pipeline consumers | `relevance`/`match` changes are additive (new optional fields); existing tests must stay green |
| Scope creep into multi-language | Explicit non-goal |

## 14. Open questions

- Per-market comp: one field pair now vs per-market bands (Phase 3)?
- `parseLocation` gazetteer size — curated top ~200 cities vs full dataset?
- Should `sponsorshipSignal` also be re-derived by an LLM during `verify`, or
  stay heuristic-only? (Leaning heuristic-only in P1, LLM in P3.)
