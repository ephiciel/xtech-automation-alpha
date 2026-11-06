"use strict";
// Offline cross-module integration: registration and OTP share Firestore/Auth fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerEmailOtpRoutes } = require("../backend/routes/email-otp.routes");
const { registerCustomerRegistrationRoutes } = require("../backend/routes/customer-registration.routes");

function harness(options = {}) {
  const route = new Map();
  const app = { post: (uri, ...handlers) => route.set(`POST ${uri}`, handlers.at(-1)) };
  const state = { users: new Map(), customers: new Map(), emailOtpChallenges: new Map() };
  const authUsers = new Map();
  const emails = [], deletedUsers = [], issuedTokens = [];
  let seq = 0;
  const stamp = ms => ({ toMillis: () => ms });
  const timestamp = () => stamp(Date.now());
  function snapshot(name, id) {
    const data = state[name].get(id);
    return { id, ref: document(name, id), exists: data !== undefined, data: () => data };
  }
  function document(name, id) {
    assert.ok(state[name], `Unknown collection: ${name}`);
    const ref = {
      id,
      get: async () => snapshot(name, id),
      set: async (value, options2) => {
        if (options.failUserSave && name === "users") throw new Error("Simulated Firestore failure");
        state[name].set(id, options2?.merge ? { ...state[name].get(id), ...value } : { ...value });
      },
      update: async value => {
        assert.ok(state[name].has(id));
        state[name].set(id, { ...state[name].get(id), ...value });
      },
      delete: async () => state[name].delete(id)
    };
    return ref;
  }
  function collection(name) {
    return {
      doc: id => document(name, id),
      where: (field, operator, expected) => {
        assert.equal(operator, "==");
        return { limit: () => ({ get: async () => {
          const docs = [...state[name].entries()]
            .filter(([, value]) => value[field] === expected)
            .slice(0, 1)
            .map(([id]) => snapshot(name, id));
          return { docs, empty: docs.length === 0 };
        } }) };
      }
    };
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const staged = [];
      const tx = {
        get: ref => ref.get(),
        set: (ref, value, options2) => staged.push(() => ref.set(value, options2)),
        update: (ref, value) => staged.push(() => ref.update(value)),
        delete: ref => staged.push(() => ref.delete())
      };
      const outcome = await callback(tx);
      for (const write of staged) await write();
      return outcome;
    }
  };
  const auth = {
    async getUserByEmail(email) {
      const record = [...authUsers.values()].find(user => user.email === email);
      if (!record) throw Object.assign(new Error("User not found"), { code: "auth/user-not-found" });
      return record;
    },
    async createUser(fields) {
      const user = { uid: `user-${++seq}`, ...fields };
      authUsers.set(user.uid, user);
      return user;
    },
    async getUser(uid) {
      const user = authUsers.get(uid);
      assert.ok(user, "User must exist");
      return user;
    },
    async updateUser(uid, fields) {
      const user = authUsers.get(uid);
      Object.assign(user, fields);
      return user;
    },
    async deleteUser(uid) {
      deletedUsers.push(uid);
      authUsers.delete(uid);
    },
    async createCustomToken(uid, claims) {
      issuedTokens.push({ uid, claims });
      return `offline-token-${uid}`;
    }
  };
  const normalizedEmail = value => String(value || "").trim().toLowerCase();
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const otp = registerEmailOtpRoutes(app, {
    getDb: () => db, getAuth: () => auth, getTimestamp: () => ({ fromMillis: stamp }), now: timestamp,
    normalizedEmail, isValidEmailAddress: validEmail, createOtpHash: () => ({ salt: "salt", hash: "digest" }),
    emailChallengeId: email => `challenge:${email}`, generateOtpCode: () => "123456",
    maskEmail: () => "p***@example.com", otpExpiryMinutes: () => 10, otpResendSeconds: () => 60,
    sendOtpEmail: async (...args) => { if (options.failMail) throw Error("Simulated email failure"); emails.push(args); },
    verifyOtpHash: code => code === "123456"
  });
  registerCustomerRegistrationRoutes(app, {
    getDb: () => db, getAuth: () => auth, now: timestamp, newDocumentId: () => `customer-${++seq}`,
    normalizedEmail, normalizePhilippineMobile: value => !value ? "" : String(value),
    isValidName: value => /^[a-zA-Z ]{2,}$/.test(value),
    isValidEmailAddress: validEmail, emailDomainCanReceiveMail: async () => true,
    isValidOptionalText: (value, length) => value.length <= length,
    isValidPassword: value => value.length >= 6 && value.length <= 128,
    issueEmailOtp: otp
  });
  async function request(url, body) {
    const handler = route.get(`POST ${url}`);
    assert.ok(handler, `Missing route ${url}`);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ body }, res);
    return res;
  }
  const register = (overrides = {}) => request("/api/auth/register-customer", {
    name: "Pat Sample", email: " PAT@EXAMPLE.COM ", password: "Password123!",
    phone: "09171234567", company: "Local Co", address: "Davao City", ...overrides
  });
  const verify = code => request("/api/auth/email-otp/verify", { email: "pat@example.com", code });
  return { app, state, authUsers, emails, deletedUsers, issuedTokens, register, verify, request, stamp };
}

const quietErrors = async callback => {
  const original = console.error;
  console.error = () => {};
  try { return await callback(); } finally { console.error = original; }
};

test("registration -> email challenge -> verification -> token is one connected workflow", async () => {
  const s = harness();
  const created = await s.register();
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.verificationRequired, true);
  assert.equal(s.emails.length, 1);
  assert.equal(s.emails[0][2], "registration");
  const uid = [...s.authUsers.keys()][0];
  const before = s.state.users.get(uid);
  assert.equal(before.active, false);
  assert.equal(before.registrationPending, true);
  assert.equal(s.authUsers.get(uid).disabled, true);
  assert.equal(s.state.customers.get(before.customerID).active, false);
  const complete = await s.verify("123456");
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.body.registrationCompleted, true);
  assert.equal(complete.body.customToken, `offline-token-${uid}`);
  assert.equal(s.state.emailOtpChallenges.size, 0);
  assert.equal(s.state.users.get(uid).active, true);
  assert.equal(s.state.customers.get(before.customerID).active, true);
  assert.equal(s.authUsers.get(uid).disabled, false);
  assert.equal(s.authUsers.get(uid).emailVerified, true);
  assert.equal(s.issuedTokens[0].claims.registrationVerified, true);
});

test("invalid OTP after registration never activates account", async () => {
  const s = harness();
  await s.register();
  const uid = [...s.authUsers.keys()][0];
  const incorrect = await s.verify("987654");
  assert.equal(incorrect.statusCode, 400);
  assert.equal(s.state.emailOtpChallenges.get("challenge:pat@example.com").attemptsRemaining, 4);
  assert.equal(s.state.users.get(uid).active, false);
  assert.equal(s.authUsers.get(uid).disabled, true);
  assert.equal(s.issuedTokens.length, 0);
});

test("pending-registration resend checks cooldown then issues replacement code", async () => {
  const s = harness();
  await s.register();
  const request = () => s.request("/api/auth/email-otp/request", { email: "pat@example.com" });
  const cooldown = await request();
  assert.equal(cooldown.statusCode, 429);
  assert.equal(s.emails.length, 1);
  const challenge = s.state.emailOtpChallenges.get("challenge:pat@example.com");
  challenge.lastSentAt = s.stamp(Date.now() - 120000);
  const resent = await request();
  assert.equal(resent.statusCode, 200);
  assert.equal(resent.body.registrationPending, true);
  assert.equal(s.emails.length, 2);
  const final = await s.verify("123456");
  assert.equal(final.statusCode, 200);
});

test("completed registration cannot create another account with the same email", async () => {
  const s = harness();
  await s.register();
  await s.verify("123456");
  const repeat = await s.register();
  assert.equal(repeat.statusCode, 409);
  assert.equal(s.authUsers.size, 1);
  assert.equal(s.state.customers.size, 1);
});

test("email delivery failure compensates newly created Auth and Firestore records", async () => quietErrors(async () => {
  const s = harness({ failMail: true });
  const result = await s.register();
  assert.equal(result.statusCode, 500);
  assert.equal(s.authUsers.size, 0);
  assert.equal(s.state.users.size, 0);
  assert.equal(s.state.customers.size, 0);
  assert.equal(s.state.emailOtpChallenges.size, 0);
  assert.equal(s.deletedUsers.length, 1);
}));
