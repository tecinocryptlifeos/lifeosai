# LOSAI final split-platform architecture decision

Status: implementation in progress; production routing remains unchanged until every test and deployment gate passes.

| Responsibility | Permanent owner | Failure behavior |
|---|---|---|
| Development and recovery | Termux | Recreate the feature branch from GitHub; never develop directly on `main` |
| Source of truth and CI | GitHub | No deploy proceeds from an untested commit |
| Homepage and public/private static interfaces | Cloudflare Pages | Remain available independently of backend services |
| Stable API address, session validation, rate limiting, Live tokens, chat decision, account profile, health/config | Cloudflare Worker | Critical edge routes remain available; unsupported legacy routes return controlled maintenance |
| Identity and durable application data | Supabase | Shared system of record with RLS |
| Render | Removed from the production request path | No Worker route may depend on Render availability |
| Northflank | Deferred | Not a release dependency |

The public production web interface is `https://lifeosai.pages.dev` until any later custom-domain cutover is explicitly verified. The Worker is the Cloudflare edge API layer.

The Cloudflare Worker directly validates Supabase access tokens and profile status, enforces exact-origin CORS and security headers, rate-limits requests, issues one-use constrained Gemini Live ephemeral tokens, provides the Worker-native chat decision path with Gemini grounding, handles account-profile reads/writes directly through Supabase, and exposes `/health` and `/config`.

The Worker no longer probes, selects, proxies to, or falls back through Render or another Python origin. Legacy routes that have not yet been implemented natively at the edge return a controlled maintenance response rather than silently reintroducing a Python dependency.

Routing is deterministic:

1. Pages serves the public interface.
2. The Worker serves the stable API and critical edge-native application routes.
3. Supabase is the identity and durable-data system of record.
4. Gemini is reached directly from the Worker for chat grounding and constrained Live token issuance.
5. Unsupported legacy Python-dependent routes return controlled maintenance until an edge-native implementation is deliberately added.

Replay policy remains narrow. Authenticated token issuance and chat are protected by short-lived idempotency records. Account and other mutations require an `Idempotency-Key`. No request is replayed against a hidden or undeclared backend origin.

The capacity acceptance target remains 50 simultaneous public users. This is a release contract, not a claim of unlimited Gemini, Supabase, Cloudflare, or other provider quota.
