# LifeOS Queue Runtime v1.1.0

Human-facing name: **LifeOS Queue**

Technical identifier: `lifeos_queue`

The production runtime uses the Gmail API and the existing Supabase Queue
tables/RPCs. Gmail credentials remain server-side. The worker is disabled by
default and a second database switch must also be enabled before mail can be
sent.

## Operating accounts

- Google Cloud project and OAuth client owner: `lifeostecinoai@gmail.com`
- Gmail mailbox authorized for Queue delivery: `losaiadminpatric@gmail.com`
- Supabase Queue sender: `losaiadminpatric@gmail.com`

The infrastructure owner and authorized Gmail mailbox are intentionally
different accounts.

## Production environment variables

Required private Render variables:

- `LIFEOS_QUEUE_GOOGLE_CLIENT_ID`
- `LIFEOS_QUEUE_GOOGLE_CLIENT_SECRET`
- `LIFEOS_QUEUE_GOOGLE_REFRESH_TOKEN`
- `LIFEOS_QUEUE_INTERNAL_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`)

Required non-secret variables:

- `LIFEOS_QUEUE_GMAIL_ADDRESS=losaiadminpatric@gmail.com`
- `LIFEOS_QUEUE_WORKER_ENABLED=false` during deployment verification
- `LIFEOS_QUEUE_POLL_SECONDS=60`
- `LIFEOS_QUEUE_REPLY_SYNC_SECONDS=900`

Never commit or print the private values.

## Safety gates

Both gates must be active before an outbound row can be claimed:

1. Render: `LIFEOS_QUEUE_WORKER_ENABLED=true`
2. Supabase: `lifeos_queue_settings.enabled=true`

Keep both gates disabled while installing credentials and verifying the live
runtime. The database enforces a daily limit of 10 messages, serializes claims,
and enforces the configured 30-minute interval across overlapping deployments.
The Gmail runtime also uses a deterministic RFC 822 Message-ID to prevent a
duplicate send after a database acknowledgement failure.

## Protected runtime verification

The status route exchanges the refresh token, verifies the Gmail profile, and
checks Supabase without sending email:

```bash
curl --fail-with-body --silent --show-error \
  --header "X-LifeOS-Queue-Secret: $LIFEOS_QUEUE_INTERNAL_SECRET" \
  https://losai.onrender.com/api/lifeos-queue/status
```

The expected safe result includes:

- `remote_check: passed`
- `gmail_profile_verified: losaiadminpatric@gmail.com`
- `database_reachable: true`
- `database_queue_enabled: false` before activation
- `worker_enabled: false` before activation

The protected run route accepts `verify`, `dispatch`, or `reply_sync`. A
dispatch request cannot bypass either safety gate.

## Queue policy

- 10 messages daily
- 30-minute minimum outbound spacing
- 15-minute reply synchronization
- 3 maximum attempts
- disabled by default

## Activation order

1. Deploy with the Render worker disabled and the Supabase Queue disabled.
2. Run the protected status verification and confirm the expected Gmail.
3. Set `LIFEOS_QUEUE_WORKER_ENABLED=true` and redeploy.
4. Add one approved test message while the database Queue remains disabled.
5. Enable `lifeos_queue_settings.enabled` and verify one controlled send.
6. Confirm the Supabase row is `sent` and contains Gmail message/thread IDs.
7. Only after the live test passes, disable the old Google OAuth client secret.

Reply synchronization records Gmail metadata and a short snippet in the
service-role-only Queue table; it does not expose message content publicly.
