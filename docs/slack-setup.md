# Slack setup

Self-hosted, single-workspace install. No marketplace listing. Bring your
own Slack workspace, install the app into it once, done.

## 1. Create the app

1. Go to <https://api.slack.com/apps> and click **Create New App -> From an app manifest**.
2. Pick your workspace.
3. Paste the contents of `infra/slack/manifest.yml`, replacing every
   `REPLACE_ME.example.com` with your API host (e.g. `careeros.mydomain.tld`).
4. Review + create.

## 2. Install to workspace

The install must start from the API so it can mint the OAuth `state` nonce that
protects the callback. A direct **Install to Workspace** from the Slack app page
carries no state and is rejected.

1. While signed in to Career OS, call `GET /webhooks/slack/oauth/start`. The
   response is `{ "url": "https://slack.com/oauth/v2/authorize?..." }` carrying a
   one-time `state` bound to your session.
2. Open that URL and approve the requested bot scopes:
   - `chat:write` (post messages)
   - `commands` (slash commands)
   - `im:history`, `im:read`, `im:write` (direct-message channel)
3. Slack redirects to
   `https://<your-host>/webhooks/slack/oauth/callback?code=...&state=...`. The
   API requires your session plus the matching, unexpired, unused `state` before
   it exchanges the code and stores the bot token encrypted in
   `encrypted_secrets` (purpose `integration:slack:bot_token`). The
   `redirect_uri` used in the exchange is always the server-configured
   `SLACK_OAUTH_REDIRECT_URI`; a caller-supplied value is ignored.

## 3. Environment variables

Set these on the API service before the first request lands:

| Var | Where to find it | Notes |
|---|---|---|
| `SLACK_SIGNING_SECRET` | App page -> **Basic Information -> Signing Secret** | Required for every inbound webhook. |
| `SLACK_CLIENT_ID` | App page -> **Basic Information -> Client ID** | Required for OAuth exchange. |
| `SLACK_CLIENT_SECRET` | App page -> **Basic Information -> Client Secret** | Required for OAuth exchange. |
| `SLACK_BOT_TOKEN` | Populated automatically by the OAuth callback | Optional to set manually if you install out-of-band. |
| `SLACK_OAUTH_REDIRECT_URI` | e.g. `https://your-host/webhooks/slack/oauth/callback` | Must match the manifest exactly. |
| `SLACK_BRIEF_CHANNEL` | Channel or user id the bot should post the daily brief to | Required for daily-brief delivery over Slack; web mirror still works without it. |

## 4. Verify installation

Send `/brief` in any channel where the bot is present. You should see the
daily-brief block. If Slack shows `dispatch_failed`, check the API logs for
`slack signature reject`.

## 5. Endpoints reference

| Slack -> API | Purpose |
|---|---|
| `POST /webhooks/slack/events` | Events API (message, app_mention). URL-verification challenge handled inline. |
| `POST /webhooks/slack/interactive` | Block Kit button + menu callbacks. |
| `POST /webhooks/slack/commands` | The seven slash commands. |
| `GET /webhooks/slack/oauth/start` | Auth-required. Mints a one-time OAuth `state`, returns the Slack authorize URL. |
| `POST /webhooks/slack/oauth/callback` | OAuth completion. Requires session + matching, unexpired, one-time `state`. |

## 6. Security notes

- Every Slack webhook endpoint (`events`, `interactive`, `commands`) verifies
  `x-slack-signature` HMAC-SHA256 BEFORE parsing the body. Requests with a bad
  signature return 401 with `reason: bad_signature`.
- Timestamps outside +/- 5 minutes are rejected as `stale_timestamp` to
  block replay attacks.
- `event_id` is deduped in Redis with a 24h TTL so Slack retries on our
  500s do not double-fire handlers.
- Slack OAuth requires a signed-in session and a cryptographically random,
  user-bound, one-time `state` nonce (Redis TTL 10 min, consumed with `GETDEL`).
  Missing/mismatched/expired/replayed state is rejected with 400.
- The bot token is stored under AES-GCM with the `ENCRYPTION_KEY` master
  key bound to `purpose = integration:slack:bot_token` as AAD.

## 7. Rotating credentials

1. Regenerate the signing secret on Slack's app page.
2. Update `SLACK_SIGNING_SECRET` and redeploy.
3. To rotate the bot token: reinstall the app from the same admin page,
   run the OAuth flow again. The `upsert` in `slack.oauth.ts` overwrites
   the existing ciphertext in place.
