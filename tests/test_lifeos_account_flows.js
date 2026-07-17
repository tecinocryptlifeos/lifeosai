const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync("web/lifeos_voice/assets/lifeos_account_v1.js", "utf8");
const context = { window: {}, console, Date };
vm.createContext(context);
vm.runInContext(source, context, { filename: "lifeos_account_v1.js" });
const account = context.window.LifeOSAccount;
assert(account, "LifeOSAccount was not exported");

assert.strictEqual(account.calculateAge("2000-01-01", new Date("2026-07-17T00:00:00Z")), 26);
assert.strictEqual(account.calculateAge("2014-07-18", new Date("2026-07-17T00:00:00Z")), 11);
assert.throws(() => account.validateProfile({
  first_name: "Young", surname: "User", date_of_birth: "2014-07-18", country: "Nigeria",
  email: "young@example.com", password: "Password123", accept_terms: true,
}), /at least 13/);
assert.throws(() => account.validatePassword("short"), /at least 10/);
assert.throws(() => account.validatePassword("alllettersxx"), /letter and one number/);
const requiredProfile = account.validateRequiredProfile({
  first_name: "Ada", surname: "Okafor", date_of_birth: "1990-05-10",
  country: "Nigeria", phone: "", accept_terms: true,
}, { minimumAge: 13 });
assert.strictEqual(requiredProfile.full_name, "Ada Okafor");
assert.strictEqual(requiredProfile.phone, null);

(async () => {
  const calls = [];
  const client = { auth: {
    signUp: async payload => { calls.push(["signUp", payload]); return { data: { user: { id: "u1" }, session: null }, error: null }; },
    signInWithPassword: async payload => { calls.push(["signIn", payload]); return { data: { session: { access_token: "t" } }, error: null }; },
    resetPasswordForEmail: async (email, options) => { calls.push(["reset", email, options]); return { data: {}, error: null }; },
    updateUser: async payload => { calls.push(["update", payload]); return { data: {}, error: null }; },
  }};

  const signup = await account.signUp(client, {
    first_name: "Ada", surname: "Okafor", date_of_birth: "1990-05-10", country: "Nigeria",
    phone: "+2348000000000", email: "ADA@EXAMPLE.COM", password: "Securepass1", accept_terms: true,
  }, { redirectTo: "https://losai.onrender.com/chat", minimumAge: 13, passwordMinimum: 10 });
  assert.strictEqual(signup.error, null);
  const signupPayload = calls.find(item => item[0] === "signUp")[1];
  assert.strictEqual(signupPayload.email, "ada@example.com");
  assert.strictEqual(signupPayload.options.emailRedirectTo, "https://losai.onrender.com/chat");
  assert.strictEqual(signupPayload.options.data.full_name, "Ada Okafor");
  assert.strictEqual(signupPayload.options.data.country, "Nigeria");
  assert.strictEqual(signupPayload.options.data.minimum_age_confirmed, true);

  await account.signIn(client, "ADA@EXAMPLE.COM", "Securepass1");
  assert.strictEqual(JSON.stringify(calls.find(item => item[0] === "signIn")[1]), JSON.stringify({ email: "ada@example.com", password: "Securepass1" }));

  await account.requestPasswordReset(client, "ADA@EXAMPLE.COM", "https://losai.onrender.com/reset-password");
  const reset = calls.find(item => item[0] === "reset");
  assert.strictEqual(reset[1], "ada@example.com");
  assert.strictEqual(reset[2].redirectTo, "https://losai.onrender.com/reset-password");

  await account.updatePassword(client, "Newsecure2");
  assert.strictEqual(JSON.stringify(calls.find(item => item[0] === "update")[1]), JSON.stringify({ password: "Newsecure2" }));

  console.log("LifeOS account flow simulation passed");
})().catch(error => { console.error(error); process.exit(1); });
