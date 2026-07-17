document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const byId = id => document.getElementById(id);
  const status = byId("resetMessage");
  const setMessage = (text, kind = "") => { status.textContent = text; status.dataset.kind = kind; };
  try {
    const response = await fetch("/api/auth-config", { cache: "no-store" });
    if (!response.ok) throw new Error("The LifeOS account configuration is unavailable.");
    const config = await response.json();
    if (!config.configured || !config.email_enabled) throw new Error("Email account recovery is not enabled.");
    if (!window.supabase?.createClient || !window.LifeOSAccount) throw new Error("The secure account library did not load.");
    const client = window.supabase.createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      setMessage("Open this page from the password-reset link sent to your email.", "warning");
      byId("resetPassword").disabled = true;
      return;
    }
    setMessage("Enter a new password containing at least 10 characters, one letter and one number.", "ready");
    byId("resetPassword").addEventListener("click", async () => {
      try {
        const password = byId("newPassword").value;
        const confirmation = byId("confirmPassword").value;
        if (password !== confirmation) throw new Error("The two passwords do not match.");
        byId("resetPassword").disabled = true;
        setMessage("Updating your password…", "ready");
        const result = await window.LifeOSAccount.updatePassword(client, password, Number(config.password_min_length || 10));
        if (result.error) throw result.error;
        setMessage("Password updated. You can now return to LifeOS and sign in.", "ok");
        byId("returnToLifeOS").hidden = false;
      } catch (updateError) {
        byId("resetPassword").disabled = false;
        setMessage(updateError.message || "The password could not be updated.", "error");
      }
    });
  } catch (error) {
    setMessage(error.message || "Password recovery could not start.", "error");
    byId("resetPassword").disabled = true;
  }
});
