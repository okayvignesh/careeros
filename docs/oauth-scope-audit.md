# OAuth scope audit (F.11c)

Per-integration inventory of what we grant vs. what the shipped code uses.
Least-privilege is enforced two ways:

1. **Install-time**: for user-supplied tokens (GitHub/GitLab PAT), an
   allowlist rejects excess scopes before the token is persisted. For
   OAuth flows (Gmail, Slack), the requested scopes come from our own
   config and the callback logs a warning if the response set drifts
   from expected.
2. **Documentation** (this file): a source of truth reviewers can diff
   against the manifest / OAuth client config.

Updated: 2026-09-29.

## Slack

| Scope | Used for | Enforcement |
|---|---|---|
| `commands` | receive slash commands (E.2) | required |
| `chat:write` | post daily brief + async notifications (E.3, via `@careeros/messaging` SlackChannel) | required |

- Constant: `EXPECTED_SLACK_SCOPES` in `apps/api/src/modules/slack/slack.oauth.ts`.
- Audit hook: `SlackOAuthService.completeInstall` logs `warn` for any missing (breaks the feature) or excess (violates least-privilege) scope at install time.
- Slack app manifest MUST request only these two. Anything else is dead grant.

## Gmail

| Scope | Used for | Enforcement |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | `history.list` + `messages.get` for E.4 push + E.5/E.6 ingest | required |

- Constant: `OAUTH_SCOPES` in `apps/api/src/modules/gmail/gmail.service.ts`.
- Write scopes (`gmail.modify`, `gmail.send`) are NOT requested. Outreach
  in F.5 uses draft-only via Gmail UI (user hits send), so no write scope
  is needed even at that layer.
- Public release requires Google app verification for `gmail.readonly`;
  self-hosted deployments do not (see `docs/gmail-setup.md`).

## GitHub (PAT)

| Scope | Used for | Enforcement |
|---|---|---|
| `repo` | private repo read for commit ingest + branch listing | required |
| `public_repo` | public-only alternative to `repo` | optional |
| `read:user` | user profile identity | required |
| `user:email` | `/user/emails` for evidence attribution (`apps/worker/src/github-sync.ts:427`) | required |

- Allowlist: `ALLOWED_SCOPES` in `apps/api/src/modules/integrations/github/github.service.ts`.
- Blocklist: `BLOCKED_SCOPES` (admin:*, delete_repo, workflow, ...) hard-fails install.
- Scope-gate: A-H6 reads `x-oauth-scopes` from the first API call and
  rejects any PAT whose scopes are outside the allowlist BEFORE persisting.

## GitLab (PAT)

| Scope | Used for | Enforcement |
|---|---|---|
| `read_api` | project + MR + pipeline reads | required |
| `read_user` | user profile + `/user/emails` (`apps/worker/src/gitlab-sync.ts:381`) | required |
| `read_repository` | repo tree + commit reads for ingest | required |

- Allowlist: `ALLOWED_SCOPES` in `apps/api/src/modules/integrations/gitlab/gitlab.service.ts`.
- Blocklist: `BLOCKED_SCOPES` (api, write_repository, sudo, ...) hard-fails.
- Scope-gate: A-H6b calls `/api/v4/personal_access_tokens/self` for an
  authoritative scope + expiry + revocation check before persisting.
- Applies to gitlab.com AND self-hosted; self-hosted host is also
  gated through `assertPublicUrl` (A-C2) with a per-user opt-in allowlist.

## Agent JWT (D.2 / D.7)

Not OAuth, but included for completeness — the desktop-agent auth
surface has its own scope.

| Scope | Used for | Enforcement |
|---|---|---|
| `agent:*` | agent-only routes (`/agent/*`, WSS `/agent/ws`, task-result POST) | required |

- Constant: `AGENT_JWT_SCOPE` in `apps/api/src/modules/agent/agent.service.ts`.
- `AgentService.verifyBearer` rejects any JWT whose `scope` claim is not
  `agent:*`, so a browser-session JWT cannot masquerade as an agent.

## Adding a new scope

1. Add the scope to the constant in the owning service file.
2. Update the row in this table with what it is used for + which code path.
3. If the integration has a scope-gate (GitHub/GitLab), decide whether the
   scope belongs in ALLOWED or BLOCKED and add a test.
4. If OAuth (Slack/Gmail), update the manifest / OAuth-client config in
   the same commit so the audit hook does not warn on the next install.

## Adding a new integration

1. Ship a scope constant + audit hook that mirrors the Slack pattern
   (`auditSlackScopes` + `EXPECTED_SLACK_SCOPES`).
2. Add a section to this table.
3. If the credential is user-supplied (PAT / token pasted in the UI),
   ship a scope-gate that refuses excess scopes at persist time
   (mirrors A-H6 / A-H6b).
4. If OAuth, ship an install-time audit that logs missing + excess.
