# Northflank origin cron fix

`NORTHFLANK_ORIGIN` is intentionally optional because Northflank is a deferred warm standby, not a current production dependency.

The production Cloudflare Worker must not read, probe, proxy to, or fail over through `NORTHFLANK_ORIGIN`. When no standby is configured, origin evaluation is Cloudflare-edge-only and the scheduled handler must be a no-op that records an edge-authoritative health state rather than throwing a `GatewayError`.

The repository's current edge health implementation already follows that rule: `evaluateOrigins()` produces an `edge` state without reading external-origin bindings, and `currentOriginState()` converts missing/stale KV state back to that edge state.

Do not populate `NORTHFLANK_ORIGIN` with a fake or Render URL. Only populate it after a real Northflank standby is deployed, independently health-checked, and explicitly promoted to release dependency status.
