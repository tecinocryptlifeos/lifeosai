# Split-platform deployment runbook

No step automatically advances to the next. Record the commit SHA and evidence for each gate.

1. **Termux:** create a feature branch from the current `main`; confirm `main` remains unchanged and the complete scope is intentional.
2. **GitHub:** push only that feature branch, open a PR, and require the full CI suite to pass.
3. **Cloudflare Pages preview:** build `dist/pages`, deploy to the temporary `pages.dev` URL with `LIFEOS_PAGES_PREVIEW=true`, and test every public/private route. Do not attach the custom domain yet.
4. **Cloudflare Worker preview:** create KV and the rate-limit namespace, render `wrangler.toml`, set required Worker secrets, deploy to `workers.dev`, and run gateway tests. `NORTHFLANK_ORIGIN` is optional and must not block deployment when no standby is configured.
5. **Render primary:** take an environment-variable inventory, configure the shared gateway secret, deploy manually with auto-deploy still off, and validate direct `/health` plus Worker-proxied API routes.
6. **Supabase and end-to-end smoke tests:** verify registration, email confirmation, password reset, Google auth, existing session refresh, profile completion, chat, voice token, admin access, and RLS from Pages preview.
7. **Primary-failure test:** mark or isolate Render only in a controlled test, run the five-minute probe, and verify the Worker records `edge` as preferred when no healthy standby is configured. Confirm edge-native health, config, session validation, and Live-token operations remain available while Python-dependent routes return controlled maintenance responses. Restore Render afterward.
8. **Capacity test:** pass the 50-request gateway contract and a controlled 50-user smoke plan without quota or error-rate violations.
9. **Routing gate:** only after all required gates above are 100% green, approve `losai.ng.eu.org` for Pages and `api.losai.ng.eu.org` for the Worker. Then enable Render's gateway guard. Keep rollback DNS and previous deployments available.

## Optional future standby activation

Northflank assets remain in the repository for a possible future warm standby, but Northflank is not a current release dependency. If a standby provider is later enabled, configure `NORTHFLANK_ORIGIN`, validate its gateway-secret protection and `/health` endpoint, run standby-routing and failover tests, and record that evidence independently. Do not use a fake standby origin in production.

NORTHFLANK_ORIGIN is optional. The production Cloudflare Worker must never depend on it being populated. A missing or empty optional standby is a valid steady-state configuration, not a deployment error. The scheduled health path must remain edge-authoritative and must not throw because a standby binding is absent.

Never alter `main`, the existing Back4App branch, live Supabase schema, or production routing as an incidental deployment step. Cloudflare Pages can connect preview branches through its [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/).
