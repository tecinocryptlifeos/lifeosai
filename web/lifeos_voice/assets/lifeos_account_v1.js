(() => {
  "use strict";

  const MINIMUM_AGE = 13;
  const PASSWORD_MIN_LENGTH = 10;

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function normaliseEmail(value) {
    return clean(value).toLowerCase();
  }

  function calculateAge(dateOfBirth, now = new Date()) {
    const value = clean(dateOfBirth);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return -1;
    const [year, month, day] = value.split("-").map(Number);
    const birth = new Date(Date.UTC(year, month - 1, day));
    if (
      birth.getUTCFullYear() !== year ||
      birth.getUTCMonth() !== month - 1 ||
      birth.getUTCDate() !== day
    ) return -1;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (birth > today) return -1;
    let age = today.getUTCFullYear() - year;
    const beforeBirthday = today.getUTCMonth() < month - 1 ||
      (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
    if (beforeBirthday) age -= 1;
    return age;
  }

  function validatePassword(password, minimum = PASSWORD_MIN_LENGTH) {
    const value = String(password || "");
    if (value.length < minimum) {
      throw new Error(`Password must contain at least ${minimum} characters.`);
    }
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
      throw new Error("Password must contain at least one letter and one number.");
    }
    return value;
  }

  function validateRequiredProfile(profile, options = {}) {
    const minimumAge = Number(options.minimumAge || MINIMUM_AGE);
    const firstName = clean(profile.first_name);
    const surname = clean(profile.surname);
    const dateOfBirth = clean(profile.date_of_birth);
    const country = clean(profile.country);
    const phone = clean(profile.phone);
    if (!firstName) throw new Error("First name is required.");
    if (!surname) throw new Error("Surname is required.");
    const age = calculateAge(dateOfBirth);
    if (age < minimumAge) {
      throw new Error(`You must be at least ${minimumAge} years old to create a LifeOS account.`);
    }
    if (!country) throw new Error("Country is required.");
    if (profile.accept_terms !== true) {
      throw new Error("Accept the Terms and Privacy Policy to continue.");
    }
    return {
      first_name: firstName,
      surname,
      full_name: `${firstName} ${surname}`,
      date_of_birth: dateOfBirth,
      country,
      phone: phone || null,
      age,
      accept_terms: true,
    };
  }

  function validateProfile(profile, options = {}) {
    const passwordMinimum = Number(options.passwordMinimum || PASSWORD_MIN_LENGTH);
    const required = validateRequiredProfile(profile, options);
    const email = normaliseEmail(profile.email);
    const password = validatePassword(profile.password, passwordMinimum);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    return { ...required, email, password };
  }

  async function signUp(client, profile, options = {}) {
    if (!client?.auth?.signUp) throw new Error("The account service is unavailable.");
    const verified = validateProfile(profile, options);
    return client.auth.signUp({
      email: verified.email,
      password: verified.password,
      options: {
        emailRedirectTo: options.redirectTo,
        data: {
          first_name: verified.first_name,
          surname: verified.surname,
          full_name: verified.full_name,
          date_of_birth: verified.date_of_birth,
          country: verified.country,
          phone: verified.phone,
          minimum_age_confirmed: true,
          terms_accepted_at: new Date().toISOString(),
        },
      },
    });
  }

  async function signIn(client, email, password) {
    if (!client?.auth?.signInWithPassword) throw new Error("The account service is unavailable.");
    const normalised = normaliseEmail(email);
    if (!normalised) throw new Error("Enter your email address.");
    if (!password) throw new Error("Enter your password.");
    return client.auth.signInWithPassword({ email: normalised, password: String(password) });
  }

  async function requestPasswordReset(client, email, redirectTo) {
    if (!client?.auth?.resetPasswordForEmail) throw new Error("The account service is unavailable.");
    const normalised = normaliseEmail(email);
    if (!normalised) throw new Error("Enter your email address first.");
    return client.auth.resetPasswordForEmail(normalised, { redirectTo });
  }

  async function updatePassword(client, password, minimum = PASSWORD_MIN_LENGTH) {
    if (!client?.auth?.updateUser) throw new Error("The account service is unavailable.");
    return client.auth.updateUser({ password: validatePassword(password, minimum) });
  }

  window.LifeOSAccount = Object.freeze({
    MINIMUM_AGE,
    PASSWORD_MIN_LENGTH,
    calculateAge,
    validatePassword,
    validateRequiredProfile,
    validateProfile,
    signUp,
    signIn,
    requestPasswordReset,
    updatePassword,
  });
})();
