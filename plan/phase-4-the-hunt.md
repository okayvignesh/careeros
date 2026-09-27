# Phase 4 — The hunt (matching, resume studio, applications)

**Status:** In progress (slice 23 application tracker: new `applications` + `application_events` tables (unique on `(userId, jobId)` — create is naturally idempotent via P2002 → return-existing); state machine in `packages/shared/src/applications.ts` with 6 states (interested/applied/interviewing/offer/rejected/ghosted), `canTransition` guard + `nextStatesFrom` + `STATE_LABEL`, 6-scenario assert test; `ApplicationsService.create` / `listForUser` / `getById` / `transition` (guards via `canTransition`, auto-stamps `appliedAt` on first entry to applied, wraps state+event write in Prisma `$transaction`) / `attach` (checks resume/cover ownership before linking) / `remove`; `GET/POST /me/applications`, `PATCH /me/applications/:id/{transition,attach}`, `DELETE /me/applications/:id`; `/applications` page with tone-tinted state badges (accent=applied, warning=interviewing, success=offer, danger=rejected) + "Move to..." dropdown honoring nextStates + attached resume/cover chips + trash; JobsList gains "Track" button (idempotent, jumps to /applications on success); AppNav adds Applications link (Target icon). Full P4 close-the-loop shipped: browse jobs → track → draft resume + cover → download PDF → move through states. Slice 22 PDF export: new `packages/resume-render/` workspace package with `@react-pdf/renderer` + one `ats-first` React-PDF template that renders both resume + cover-letter shapes (single-column, Helvetica, plain `-` bullets, no images/color, ATS-safe by construction); `renderResumePdf` + `renderCoverLetterPdf` return Node `Buffer`s; `ResumeVariantsService.renderPdf` + `CoverLettersService.renderPdf` produce `{buffer, filename}` with slugified filename; `GET /me/resume-variants/:id/pdf` + `GET /me/cover-letters/:id/pdf` stream `application/pdf` with content-disposition attachment; new `apiBrowserUrl(path)` helper in api-client for direct-nav to stream endpoints; "Download PDF" buttons on both view pages. Docker workflow triggered fully (new workspace + new dep): pnpm install inside container + restart; both /pdf routes registered, /health 200. DOCX render, `classic` / `modern-minimal` / `dense-tech` templates, per-industry variants, ATS-safe linter defer. Slice 21 cover letter walking-skeleton: new `cover_letters` table (mirrors resume_variants shape); `CoverLetterContentSchema` in shared (greeting + 2-6 paragraphs each with factRefs + closing); `cover-letter-writer` prompt with same grounded contract as tailored-resume-writer (every paragraph must cite ≥1 factRef); `CoverLettersService.generateForJob` reuses the exact fact-check pattern from slice 20 (hallucinated-ID drop → LLM audit via `resume-bullet-fact-check` prompt at paragraph level → drop unsupported → drop empty variants); `{content, audit}` wrapper on `contentJson`; `GET/POST /me/cover-letters/*` + `/cover-letters/[id]` page + `AuditPanel` (paragraph-level status) + "Draft cover" button per row on /jobs. Slice-20 verifier debt shipped inline first: missing-verdict-defaults-supported was inverted to drop-with-reason (trust-critical), `.find` positional bug fixed to positional cursor, dead `cleaned` const deleted, em-dash in prompt swapped to comma, ai-safety.md Item 6 boxes updated to reflect shipped state, docker-workflow memory expanded with "safe no-op canary" note. Slice 20 fact-check gate on resume bullets: new `resume-bullet-fact-check` prompt + `FactCheckResultSchema` batches one LLM audit per resume (each bullet indexed, cited fact contents rendered inline); `runFactCheck` in service drops `supported=false` bullets, drops empty sections, throws if the whole variant collapses; on fact-check-call failure the variant is kept but `audit.status='unchecked'` so downstream knows it's un-audited; storage moved to `{content, audit}` wrapper on `contentJson` with backwards-compat unwrap for slice-19 rows (auto-marked as `unchecked`); `AuditPanel` on `/resume-variants/[id]` shows a color-tinted headline (green=passed, amber=partial, grey=unchecked) with per-dropped-bullet reasons expanded by default when partial. This closes the "citation exists but the bullet text still fabricates claims" gap that slice-19 acknowledged. Slice 19 P4 kickoff — tailored resume walking-skeleton: new `resume_variants` table (userId + optional jobId + roleTarget + templateId + contentJson + factRefs[] + parentId nullable); `TailoredResumeContentSchema` in shared (summary + sections[] with bullets carrying `factRefs`); `tailored-resume-writer` prompt wraps job description as untrusted, injects verified `resume_facts` as a numbered list with stable IDs, insists every bullet cites at least one factRef; new `apps/api/src/modules/resume-variants/` module: `generateForJob(userId, jobId)` loads job + verified facts + proven skills, LLM temp 0.2, post-filters cited fact IDs against `knownIds` set, drops bullets with zero valid refs (hallucination guard), throws BadRequest if the whole variant ends up empty; `listForUser` + `getById` reshape with fact summaries; `POST /me/resume-variants/for-job/:jobId` + `GET /me/resume-variants` + `GET /me/resume-variants/:id`; `/resume-variants/[id]` page with meta header + summary section + rendered sections + per-bullet clickable factRef chips (link to /facts) + copy-as-markdown button; JobsList gains a per-row "Draft resume" button. Walking-skeleton limits: no PDF/DOCX rendering yet, one implicit template (ats-first), no version-diff UI, no ATS-safe linter, no cover letter, no application tracker, no company dossier — all follow-up slices.)
**Blueprint refs:** §10 (job discovery/matching/acquisition), §10.4 (resume engine), §10.6 (company intelligence)
**Screens in scope:** `careeros-screens/phase-4-the-hunt/` (36, 37, 38, 39, 41, 42, 43, 44)

## Goal
New jobs produce useful, evidence-backed match reports. Tailored resumes contain only verified facts. Applications tracked with source verification. Company dossiers auto-generated for shortlisted jobs.

## Definition of done
- Match report shows matched requirements AND gaps with evidence per line.
- Resume variant generation blocked when a fact is unverified — cannot ship an invented claim.
- PDF + DOCX exports are ATS-safe (single-column, no images, standard fonts, machine-readable).
- Company dossier auto-generates for shortlisted jobs; each fact carries source + date.
- Every job in tracker has a verification state and last-verified timestamp.
- Cover-letter draft is per-job, editable, gated by fact-check before send.
- Application state machine prevents invalid transitions.

## Checklist

### Matching engine
- [ ] Match scorer formula:
  ```
  match_score = Σ (skill_weight_in_role × candidate_evidence_strength × recency_factor)
              / Σ (skill_weight_in_role)
  ```
- [ ] `evidence_strength` from P1 aggregator; `recency_factor = exp(-days_since_last / 90)`
- [ ] Readiness score: `readiness = f(match_score, confidence, gap_count, dealbreaker_absent)` → 0–100
- [ ] Gap report per requirement: `{skill, candidate_evidence[], gap_level: none|low|med|high, action: highlight|learn|honest-wording|do-not-claim}`
- [ ] Gap → action mapping table (in `packages/matching/gap-actions.ts`)
- [ ] Match explanation for UI — human-readable per-line reasoning
- [ ] Cache scores in `job_match_scores` with `computed_at`; invalidate on skill-state change

### Resume studio

#### Generation pipeline
- [x] Master fact base → role-specific variant generator: `ResumeVariantsService.generateForJob` in `apps/api/src/modules/resume-variants/` — verified `resume_facts` only, LLM restricted via prompt + post-filter.
- [x] Every bullet carries `factRefs[]` cited from a numbered fact list; service drops IDs not in the known set and drops bullets that end up ungrounded.
- [x] Fact-check gate: `resume-bullet-fact-check` LLM pass audits every bullet against its cited fact content. Unsupported bullets dropped pre-persist; audit summary stored on `contentJson.audit` and surfaced in `AuditPanel`. On check failure the variant is kept but flagged `unchecked` — never silently trusted.
- [ ] Section order + emphasis tuned per role family (backend/frontend/data/infra) — walking-skeleton uses classic ATS headings only.

#### PDF / DOCX export — React-PDF + docx npm
- [x] `packages/resume-render/` templating layer shipped
- [x] React-PDF templates: `AtsFirstResume` + `AtsFirstCoverLetter` in `templates/ats-first.tsx`
- [ ] `docx` templates in `templates/docx/` (structural, same content model)
- [~] Shared content model `ResumeDoc` — walking-skeleton uses the domain schemas (`TailoredResumeContent`, `CoverLetterContent`) directly. Unifying into a single `ResumeDoc` shape lands when a second renderer (DOCX) needs it.
- [~] Template library — only `ats-first` today. `classic` / `modern-minimal` / `dense-tech` land when users actually pick between templates.
- [x] Plain-text export via existing copy-markdown button on the view page (rendered from the same content shape).

#### ATS-safe formatting rules (enforced by linter in `packages/resume-render/lint.ts`)
- [ ] Single column layout
- [ ] No text boxes, no headers/footers, no images
- [ ] Standard fonts only: Inter, Helvetica, Arial (fallback stack)
- [ ] Font size ≥ 10pt
- [ ] No colored text except optional single accent
- [ ] Bullets = `•` or `-`, never fancy glyphs
- [ ] Section headers as plain text (h2 equivalent), not styled tables
- [ ] Contact info as plain text — no icons-as-info
- [ ] Every export passes `pdf-parse` extraction test → text matches source model
- [ ] Linter blocks export on violation

#### Version history
- [ ] `resume_variants` table: `id`, `user_id`, `role_target`, `template_id`, `content_json`, `created_at`, `parent_id`
- [ ] Diff UI: side-by-side old vs new, per-bullet highlighting via `diff-match-patch`
- [ ] Restore any prior version → creates new row (append-only)

### Cover letter engine
- [x] Prompt template with company + role + candidate-evidence injection (`cover-letter-writer`, grounded per ai-safety Item 1)
- [x] Same fact-check gate (Item 6): paragraph-level, reuses `resume-bullet-fact-check` prompt; unsupported paragraphs dropped, missing verdicts also drop
- [x] Editable draft (copy plain-text button in UI; no auto-send — send flow lands in P6)
- [~] Template library: single `standard` template today; `enthusiastic` / `technical-first` / `story-led` variants add later
- [ ] Per-industry variants (startup/enterprise/academia/nonprofit)
- [ ] Version history same as resume — `parentId` column exists on `cover_letters`, diff UI defers

### Company intelligence

#### Trigger + pipeline
- [ ] Async pipeline enqueued on `application.status → shortlisted`
- [ ] Steps: identity + business → tech signals → reviews → interviews → recent events → synthesis
- [ ] Every step idempotent; re-run replaces without loss
- [ ] Full dossier cached 30 days; refresh on-demand

#### Sources (blueprint §10.6 grounded, no unauthorized scraping)
- [ ] **Identity + business:** company website (public pages via configured HTTP fetcher), Wikipedia (if public entity), Crunchbase (public data only, no API), LinkedIn public company page (via agent when linked, otherwise skip)
- [ ] **Tech signals:** engineering blog RSS (allowlisted), public GitHub org, job descriptions (already ingested)
- [ ] **Reviews:** AmbitionBox + Comparably + Reddit/Blind aggregate — public pages, respectful pacing, attribution preserved. Glassdoor deferred pending partner API access.
- [ ] **Interview signals:** subreddit mentions of `interview at <company>` (public); Comparably interview data if available
- [ ] **Recent events:** company website news section, verified press releases; never speculative rumors
- [ ] Source rate limiting via `packages/shared/rate-limits.ts` per domain

#### Dossier composition
- [ ] `company_dossiers` table: `company_id`, `sections` (jsonb), `sources` (array of {url, fetched_at, hash}), `generated_at`
- [ ] Review-theme summarizer preserves sample size + recency + polarity
- [ ] Interview-question extraction: per-role signals only, with source count + dates
- [ ] Every claim in dossier UI carries a source chip (click → source URL + fetch date)

### Application tracker

#### State machine (XState)
- [~] `packages/shared/src/applications.ts` — enum + `canTransition` guard map (no XState dep yet; upgrade when transition metadata grows past hand-coded guards)
- [~] States: 6-state shape shipped (interested → applied → interviewing → offer|rejected|ghosted). `discovered` collapsed into `interested`; `shortlisted` + `resume_ready` + `responded` defer until they carry meaningful semantics.
- [x] Guards prevent skipping states — `canTransition(from, to)` is the only entry, tested with 6 scenarios.
- [x] Transition metadata: `at`, `byActor`, `notes` on every event (default `byActor='user'`; `agent` will be set by P3.5 desktop agent slice).
- [x] Every transition writes an `application_events` row inside a Prisma `$transaction` alongside the state update.

#### Tracker
- [ ] Source verification badge on every row — deferred until P3 verification state machine ships
- [~] Timeline per application: events fetched + returned in `ApplicationDto.events` (chronological). Not yet rendered in UI (fits when the per-application detail view lands).
- [ ] Auto-transition on ATS 200 response — deferred (needs P6 apply flow + ATS adapters)
- [x] Manual override always available: state dropdown honors guards but does not require intermediate steps.
- [ ] Pipeline board (Kanban) with drag = state transition — deferred; slice-23 uses a flat list with per-row "Move to..." dropdown.

### Frontend

#### Design bar (Linear/Vercel)
- [ ] Dense, dark-first, mono digits for readiness scores + comp, sparse charts
- [ ] Every screen through `frontend-design` skill review

#### Screens
- [ ] 36 Job matches — list with readiness + verification badges; filter chip row; sort by readiness or newest
- [ ] 37 Match report — per-requirement evidence + gap + action, expandable rows, quick-actions (add to queue, generate resume, dismiss)
- [ ] 38 Company dossier — sectioned, dated sources, review-themes panel with sample sizes, interview-question hint list, recent-events timeline
- [ ] 39 Source verification — URL, HTTP status, canonical resolution, timestamps, conflicts panel
- [ ] 41 Resume studio — side-by-side master vs variant, fact-check panel showing blocked claims, template picker, ATS-lint panel with pass/fail per rule, live preview
- [ ] 42 Fact check — full-page audit of a generated artifact with blocks + resolutions
- [ ] 43 Cover letter — editor + evidence chips (drag to insert), version dropdown, template picker
- [ ] 44 Applications — Kanban board with state guards, timeline drawer per app

### Testing (see `plan/testing.md`)

**Unit**
- [ ] Match scorer formula (isolated)
- [ ] Readiness formula (per-input variation)
- [ ] Fact-check gate: 3 backed + 1 fabricated → gate blocks + names fabrication
- [ ] Application state machine: every valid transition, every invalid transition rejected
- [ ] Gap → action mapping table complete for all gap levels
- [ ] ATS linter — every rule with pass + fail fixtures
- [ ] PDF text extraction round-trip (React-PDF output → `pdf-parse` → text matches source model)
- [ ] DOCX text extraction round-trip

**Integration (Testcontainers)**
- [ ] Shortlist → dossier pipeline runs to completion with source captures
- [ ] Resume-tailor end-to-end: facts → generate → fact-check → lint → render → MinIO
- [ ] Cover-letter same

**LLM evals**
- [ ] `resume-tailor/` — 15+ (facts, job) pairs; assert grounding + no fabrication + ATS-lint passes
- [ ] `cover-letter-writer/` — 15+ examples; same rules
- [ ] `fact-check-verifier/` — 20+ (generated, facts) pairs with known unbacked claims → gate catches them
- [ ] `dossier-synthesizer/` — 10+ companies with expected section coverage
- [ ] `review-theme-summarizer/` — expected themes appear, sample sizes preserved

**Playwright golden flow**
- [ ] End-to-end: match report → generate resume → fact-check passes → PDF renders → download works
- [ ] Application state machine: drag across pipeline board, invalid transitions blocked
- [ ] `checkA11y(page)` on 36, 37, 38, 39, 41, 42, 43, 44

**Visual regression**
- [ ] Baselines for every resume template rendered against seeded facts
- [ ] Baselines for every P4 screen

### AI safety — Items 1, 6, 7 (see `plan/ai-safety.md`)

#### Item 1 — Grounded generation (resume + cover letter + outreach + dossier)
- [ ] Resume tailoring uses `generateGrounded` — every bullet carries `evidence_refs`
- [ ] Cover-letter generator same contract
- [ ] Outreach composer same contract
- [ ] Company-dossier writer: facts require source_refs; themes may be model-derived but flagged as such

#### Item 6 — Fact-check gate
- [ ] `packages/ai/fact-check.ts` — `verifyClaims({generated, facts, schema})`
- [ ] Runs on: `resume_variants`, `cover_letters`, `outreach_messages`, `company_dossiers`, `market_briefs`
- [ ] Unbacked claims block `draft → review`; UI lists unbacked claims + regenerate/edit options
- [ ] Verifier uses different prompt template than generator (no shared blind spots)
- [ ] Unit test: 3 backed + 1 fabricated claim → gate blocks + names fabrication

#### Item 7 — Matching agents
- [ ] Agents: `resume-tailor`, `cover-letter-writer`, `match-scorer`, `gap-analyzer`, `dossier-synthesizer`, `review-theme-summarizer`
- [ ] All per Item 7 contract

### Observability additions (see `plan/observability.md`)
- [ ] Metrics: `resumes_generated_total{template,result}`, `fact_check_blocks_total`, `applications_by_state`, `dossier_generation_duration_seconds`, `ats_lint_failures_total{rule}`
- [ ] Log: every generated artifact with `artifact_id`, `template_id`, `fact_ids[]`, `blocks_hit[]`

## Exit criteria
All boxes ticked, blueprint §10 hunt-flow covered, PLAN.md updated.
