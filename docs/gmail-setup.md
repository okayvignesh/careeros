# Gmail setup

Self-hosted, single-user OAuth install. Google's "testing" verification
state is fine for a developer's own account (up to 100 users of your
own OAuth client); public distribution needs full verification for
`gmail.readonly`.

## 1. Create the OAuth client

1. Open <https://console.cloud.google.com/>.
2. Create a project (or reuse one you already own).
3. Enable the **Gmail API** on that project
   (<https://console.cloud.google.com/apis/library/gmail.googleapis.com>).
4. Enable the **Cloud Pub/Sub API**.
5. Go to **APIs & Services -> OAuth consent screen**.
   - User type: **External** (even for personal use; Internal needs a
     Workspace org).
   - Testing status is fine.
   - Add yourself under **Test users**.
   - Scope: `https://www.googleapis.com/auth/gmail.readonly` only.
     We never request write / modify / send scopes - outreach drafts
     are created client-side via Gmail UI, not the API.
6. Go to **Credentials -> Create credentials -> OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URI: `https://<your-host>/integrations/gmail/oauth/callback`.
7. Download the client JSON (or just copy the Client ID + Client Secret).

## 2. Set up the Pub/Sub topic

Gmail delivers mailbox-change events to a Pub/Sub topic you own, which
pushes to our webhook.

```bash
# One-time setup via gcloud (or do this in the console).
PROJECT=<your-gcp-project-id>
TOPIC=career-os-gmail
SUB=career-os-gmail-push
WEBHOOK_URL=https://<your-host>/webhooks/gmail/push

gcloud pubsub topics create "$TOPIC" --project "$PROJECT"
gcloud pubsub subscriptions create "$SUB" \
  --project "$PROJECT" \
  --topic "$TOPIC" \
  --push-endpoint "$WEBHOOK_URL" \
  --push-auth-service-account "gmail-api-push@system.gserviceaccount.com"

# Grant the Gmail service account publish rights on the topic.
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --project "$PROJECT" \
  --member "serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role roles/pubsub.publisher
```

The webhook validates the Pub/Sub JWT per
<https://cloud.google.com/pubsub/docs/push#authentication>, so no
shared secret is needed between us and Google.

## 3. Environment variables

Set these on the API service before the first OAuth flow:

| Var | Where to find it | Notes |
|---|---|---|
| `GMAIL_OAUTH_CLIENT_ID` | OAuth credentials page | Required |
| `GMAIL_OAUTH_CLIENT_SECRET` | OAuth credentials page | Required |
| `GMAIL_OAUTH_REDIRECT_URI` | e.g. `https://<your-host>/integrations/gmail/oauth/callback` | Must match the OAuth client exactly |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project-id>/topics/career-os-gmail` | Full resource name |
| `GMAIL_PUBSUB_AUDIENCE` | Usually `https://<your-host>/webhooks/gmail/push` | JWT audience claim |

These are the exact names `apps/api/src/modules/gmail/gmail.service.ts`
(`readGmailEnv`) reads; all five are required together. Until they are set,
`GET /integrations/gmail/oauth/start` returns HTTP 400
`Gmail integration is not configured...`.

## 4. Connect your mailbox

1. Sign in to Career OS.
2. **Settings -> Integrations -> Gmail -> Connect**.
3. Google OAuth flow runs; `state` is cross-checked against your
   session cookie to prevent cookie-swap.
4. On callback, the refresh token is encrypted and persisted
   (`integration:gmail:oauth` purpose on `encrypted_secrets`).
5. The API calls `users.watch` to subscribe to mailbox events; a
   `GmailWatch` row records the historyId + expiration.

## 5. Verify

```bash
# Trigger a Gmail message to yourself. Within a few seconds you should see:
docker compose logs -f api | grep -E 'gmail|email-ingest'
# -> email-ingest.service: processed Gmail message m-<id> ...
```

If nothing shows up:
- Confirm the subscription has a message in the console
  (**Pub/Sub -> Subscriptions -> ... -> Messages**).
- Confirm the webhook returns 204 (`curl -i https://<your-host>/webhooks/gmail/push`
  returns 401/403 since you're not Pub/Sub, but should NOT return 500).
- Check the rate-limit: 300 req/min per IP (F.11a). You will only
  hit this under a Pub/Sub replay storm.

## 6. Rotate / revoke

- Revoke the Google-side grant at <https://myaccount.google.com/permissions>.
- In Career OS: **Settings -> Integrations -> Gmail -> Disconnect**.
  The API calls `users.stop` + nulls the `encrypted_secrets` row + the
  BullMQ consumer self-pauses because `readGmailEnv()` falls through.

## Watch renewal

Google expires `watch` after 7 days; Career OS re-watches daily via
BullMQ cron (E.4). You do not need to intervene unless the renewal
log shows errors for > 48h, in which case run the OAuth flow again
to refresh the token.

## Scope audit

Only `gmail.readonly` is requested. The audit in
`docs/oauth-scope-audit.md` documents this + the F.5 note that outreach
drafts stay client-side pending any future `gmail.compose` scope
decision (which would require full Google verification for public
release).
