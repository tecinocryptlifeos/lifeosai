# LifeOS Account & Analytics v1

1. Create a Supabase project.
2. Run `supabase_setup.sql` in its SQL Editor.
3. In Supabase Authentication > URL Configuration, set Site URL to your Render domain and add `/voice` as a redirect URL.
4. Enable Email authentication. Enable Google only after adding Google OAuth credentials.
5. Add the Render environment variables listed in `render.yaml`. `LIFEOS_ADMIN_EMAILS` is a comma-separated list of owner emails.
6. Redeploy. Open `/voice` to sign in and `/admin` for the owner dashboard.

Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript or commit it to Git.
