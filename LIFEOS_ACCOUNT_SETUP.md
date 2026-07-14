# LifeOS Mandatory Accounts & Operations Audit v2

1. Create a Supabase project.
2. Run `supabase_setup.sql` in its SQL Editor.
3. In Supabase Authentication > URL Configuration, set Site URL to the canonical Render domain. Add exact redirect URLs for `https://YOUR-DOMAIN/voice`, `https://YOUR-DOMAIN/chat`, and `https://YOUR-DOMAIN/admin`.
4. Configure Google OAuth with a Web application client, the canonical Render origin, and the Supabase callback URL. Use only `openid`, `userinfo.email`, and `userinfo.profile`, then publish the Google OAuth audience as External.
5. Keep email sign-in disabled unless a production SMTP provider is connected. The default deployment sets `LIFEOS_EMAIL_AUTH_ENABLED=false` and hides email controls.
6. In Render, add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `LIFEOS_ADMIN_EMAILS`. Use a comma-separated list of owner emails for the admin list. Existing `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` names remain supported for compatibility.
7. Set `LIFEOS_GOOGLE_AUTH_ENABLED=true`, keep `LIFEOS_EMAIL_AUTH_ENABLED=false`, and keep `LIFEOS_AUTH_REQUIRED=true`. Authentication is also enforced in the application and fails closed when the Supabase values are absent or no provider is enabled.
8. Redeploy the canonical public service. Open `/voice` or `/chat` to sign in and `/admin` for the owner-only operations dashboard.

The audit records account and operational events, not conversation text. Never expose the Google Client Secret, `SUPABASE_SECRET_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript, chat messages, screenshots, or Git.
