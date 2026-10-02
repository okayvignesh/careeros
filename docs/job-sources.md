# Job sources — allowed sources, trust tiers, and crawling policy

Authoritative owner decision: **U6** (Career OS may use Firecrawl and direct
crawling of public company career sites and ATS boards). This page is the
operational companion to `AGENTS.md` rule #4. If the two disagree, `AGENTS.md`
wins and this page is wrong.

## What is allowed

| Source class | Examples | How it is accessed | Trust tier |
|---|---|---|---|
| Authorized partner APIs | JSearch, Serpapi, Adzuna, Remotive, Arbeitnow | Direct HTTP via `packages/job-pipeline` adapters | 2 |
| Verified ATS APIs | Ashby, Greenhouse (extendable: Lever, Workday, SmartRecruiters, Workable, iCIMS, SuccessFactors) | Public board JSON/HTML via a typed adapter | 1 |
| Firecrawl | `api.firecrawl.dev/v1` `search` / `scrape` / `crawl` | `@careeros/firecrawl` client, SSRF-guarded egress | 2 (3 until verified against the employer's own board) |
| Direct crawl of public career sites / ATS boards | Company `/careers` pages, the ATS hosts above | `@careeros/firecrawl` scrape or a dedicated adapter | 2–3 |
| Desktop agent (user's own session) | LinkedIn, Indeed, Naukri, Glassdoor | P3.5 Electron + Playwright, user's browser | 3 |
| Parsed email alerts | Job-alert emails | P5 Gmail ingest | 3 |

## What remains banned

**Never scrape LinkedIn / Indeed / Naukri / Glassdoor from the server**, and
never route those platforms through Firecrawl, Apify, or any other third-party
scraper. Outsourcing a ToS violation does not launder it. Use partner APIs, the
desktop agent (user's authenticated session), or parsed email alerts only.

## robots.txt / ToS policy

Before a host is crawled directly:

1. **robots.txt** — fetch and honor it per user-agent. Disallowed paths are not
   requested. If robots.txt is absent or unreachable, treat the crawl as
   disallowed until reviewed.
2. **ToS** — an operator reviews the target's terms. A site that forbids
   automated access is not crawled, regardless of robots.txt. Prefer Firecrawl
   for discovery, where Firecrawl's own compliance posture applies, then verify
   the hit against the employer's canonical board.
3. **Identification** — send a stable, honest user-agent and an operator
   contact where the target asks for one.
4. **No auth bypass** — no paywall/login/CAPTCHA circumvention, no session
   reuse from a candidate account for server-side crawling.

## Rate-limit policy

- Every external call goes through `@careeros/shared` `retry` (exponential
  backoff + full jitter, base 500 ms, factor 2, max 30 s, 3 attempts; `429`
  honors `Retry-After`, `4xx` (non-429) fails fast, `5xx` retries).
- Per-host pacing lives in the worker queue (`limiter: { max, duration }`) so a
  crawl cannot burst. Firecrawl requests are capped per run by the scheduled
  worker's budget (F8).
- One crawl run is idempotent; re-runs dedupe by canonical URL and never
  overwrite `jobs_raw` (append-only).

## Trust tiers (cross-source merge)

`VERIFIED ATS (1) > Aggregator API / Firecrawl (2) > Desktop agent / email (3)`.

Only `VERIFIED` jobs may enter the auto-apply queue. A Firecrawl-discovered
listing is promoted to `VERIFIED` only after it resolves to the employer's own
ATS/career board. Firecrawl's rate-limit and robots handling is documented
upstream; the local client's job is to keep egress allowlisted, Zod-validate
responses, and never log the API key.

## Egress allowlist

`api.firecrawl.dev` is allowlisted in `infra/docker/squid/squid.conf`. Direct
crawl targets are **not** wildcarded: each reviewed host is added as an explicit
`allowed_dsts` line, preserving the deny-by-default posture. See
`plan/security.md` item 6.
