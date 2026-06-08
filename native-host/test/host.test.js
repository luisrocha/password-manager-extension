import assert from "node:assert/strict";
import test from "node:test";

process.env.PASSWORD_MANAGER_API_URL = "https://vault.test";
process.env.PASSWORD_MANAGER_API_TOKEN = "test-api-token";
process.env.PASSWORD_MANAGER_TIMEOUT_MS = "1000";

const host = await import("../host.js");

test("fetchCredentials forwards search context with browser JWT", async (t) => {
  const calls = mockFetch(t, {
    credentials: [
      {
        id: "1",
        displayName: "Example",
        domain: "example.com",
        encryptedSecretPayload: "encrypted-payload"
      }
    ]
  });

  const response = await host.fetchCredentials({
    origin: "https://example.com",
    url: "https://example.com/login",
    title: "Example Login",
    frameUrl: "https://example.com/login",
    query: "example"
  }, "browser-jwt");

  assert.equal(response.ok, true);
  assert.equal(response.credentials.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/credentials/search");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer browser-jwt");

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    origin: "https://example.com",
    url: "https://example.com/login",
    title: "Example Login",
    frameUrl: "https://example.com/login",
    query: "example"
  });
});

test("credential routes do not fall back to static API token", async (t) => {
  const calls = mockFetch(t, {});

  assert.deepEqual(await host.fetchCredentials({}, null), {
    ok: false,
    code: "auth_required",
    error: "Unlock required"
  });
  assert.deepEqual(await host.fetchCredentialDetail({ id: "1" }, null), {
    ok: false,
    code: "auth_required",
    error: "Unlock required"
  });
  assert.deepEqual(await host.saveCredential({}, null), {
    ok: false,
    code: "auth_required",
    error: "Unlock required"
  });
  assert.deepEqual(await host.updateCredential({ id: "1" }, null), {
    ok: false,
    code: "auth_required",
    error: "Unlock required"
  });
  assert.deepEqual(await host.deleteCredential({ id: "1" }, null), {
    ok: false,
    code: "auth_required",
    error: "Unlock required"
  });
  assert.equal(calls.length, 0);
});

test("saveCredential forwards encrypted payload without plaintext credential fields", async (t) => {
  const calls = mockFetch(t, { credential: { id: "1" } });

  const response = await host.saveCredential({
    name: "Example",
    domain: "example.com",
    username: "plain-user",
    password: "plain-password",
    notes: "plain-notes",
    encryptedSecretPayload: "encrypted-payload"
  }, "browser-jwt");

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/credentials");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer browser-jwt");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.encryptedSecretPayload, "encrypted-payload");
  assert.equal(Object.hasOwn(body, "username"), false);
  assert.equal(Object.hasOwn(body, "password"), false);
  assert.equal(Object.hasOwn(body, "notes"), false);
});

test("updateCredential forwards encrypted payload without plaintext credential fields", async (t) => {
  const calls = mockFetch(t, { credential: { id: "1" } });

  const response = await host.updateCredential({
    id: "1",
    name: "Example",
    username: "plain-user",
    password: "plain-password",
    notes: "plain-notes",
    encryptedSecretPayload: "encrypted-payload"
  }, "browser-jwt");

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/credentials/1");
  assert.equal(calls[0].options.method, "PATCH");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.encryptedSecretPayload, "encrypted-payload");
  assert.equal(Object.hasOwn(body, "username"), false);
  assert.equal(Object.hasOwn(body, "password"), false);
  assert.equal(Object.hasOwn(body, "notes"), false);
});

test("deleteCredential forwards delete request with browser JWT", async (t) => {
  const calls = mockFetch(t, { credential: { id: "1" } });

  const response = await host.deleteCredential({ id: "1" }, "browser-jwt");

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/credentials/1");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[0].options.headers.authorization, "Bearer browser-jwt");
  assert.equal(calls[0].options.body, undefined);
});

test("credential detail requires an id before calling API", async (t) => {
  const calls = mockFetch(t, {});

  const response = await host.fetchCredentialDetail({}, "browser-jwt");

  assert.deepEqual(response, {
    ok: false,
    code: "invalid_request",
    error: "Credential id is required"
  });
  assert.equal(calls.length, 0);
});

test("submitTotpChallenge posts challenge code and remember flag", async (t) => {
  const calls = mockFetch(t, {
    token: "browser-token",
    expiresAt: "2026-06-08T12:00:00Z",
    tokenType: "Bearer",
    totpRememberedClientToken: "remembered-client-token"
  });

  const response = await host.submitTotpChallenge({
    totpChallengeId: "challenge-id",
    totpCode: "123456",
    rememberClient: true
  });

  assert.equal(response.ok, true);
  assert.equal(response.token, "browser-token");
  assert.equal(response.totpRememberedClientToken, "remembered-client-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/auth/unlock");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-api-token");

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    totpChallengeId: "challenge-id",
    totpCode: "123456",
    rememberClient: true
  });
});

test("submitTotpChallenge requires challenge id and code before calling API", async (t) => {
  const calls = mockFetch(t, {});

  const response = await host.submitTotpChallenge({
    totpChallengeId: "challenge-id"
  });

  assert.deepEqual(response, {
    ok: false,
    code: "invalid_request",
    error: "Two-factor challenge and code are required"
  });
  assert.equal(calls.length, 0);
});

test("submitUnlockProof posts signed proof and remembered TOTP token", async (t) => {
  const calls = mockFetch(t, {
    token: "browser-token",
    expiresAt: "2026-06-08T12:00:00Z",
    tokenType: "Bearer"
  });

  const response = await host.submitUnlockProof({
    challengeId: "challenge-id",
    unlockSignature: "signature",
    signingPublicKeySpki: "public-key",
    totpRememberedClientToken: "remembered-client-token"
  });

  assert.equal(response.ok, true);
  assert.equal(response.token, "browser-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vault.test/api/browser/auth/unlock");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-api-token");

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    challengeId: "challenge-id",
    unlockSignature: "signature",
    signingPublicKeySpki: "public-key",
    totpRememberedClientToken: "remembered-client-token"
  });
});

test("submitUnlockProof requires challenge id and signature before calling API", async (t) => {
  const calls = mockFetch(t, {});

  const response = await host.submitUnlockProof({
    challengeId: "challenge-id"
  });

  assert.deepEqual(response, {
    ok: false,
    code: "invalid_request",
    error: "Unlock challenge and signature are required"
  });
  assert.equal(calls.length, 0);
});

test("submitUnlockProof returns pending TOTP challenge", async (t) => {
  mockFetch(t, {
    requiresTotp: true,
    totpChallengeId: "totp-challenge-id",
    expiresAt: "2026-06-08T12:00:00Z"
  }, { status: 202 });

  const response = await host.submitUnlockProof({
    challengeId: "challenge-id",
    unlockSignature: "signature",
    signingPublicKeySpki: "public-key"
  });

  assert.deepEqual(response, {
    ok: true,
    requiresTotp: true,
    totpChallengeId: "totp-challenge-id",
    expiresAt: "2026-06-08T12:00:00Z"
  });
});

test("requestUnlockChallenge returns server challenge", async (t) => {
  mockFetch(t, {
    challengeId: "challenge-id",
    challenge: "challenge-value"
  });

  const response = await host.requestUnlockChallenge();

  assert.deepEqual(response, {
    ok: true,
    challengeId: "challenge-id",
    challenge: "challenge-value",
    token: null,
    expiresAt: null,
    tokenType: null,
    totpRememberedClientToken: null
  });
});

test("fetchCredentialDetail maps invalid token response", async (t) => {
  mockFetch(t, {
    error: "Unauthorized",
    code: "invalid_token"
  }, { ok: false, status: 401 });

  const response = await host.fetchCredentialDetail({ id: "1" }, "expired-token");

  assert.deepEqual(response, {
    ok: false,
    code: "invalid_token",
    error: "Unauthorized"
  });
});

test("apiErrorResponse maps rate limits", () => {
  const response = host.apiErrorResponse({ status: 429 }, null);

  assert.deepEqual(response, {
    ok: false,
    code: "rate_limited",
    error: "Password manager API returned 429"
  });
});

function mockFetch(t, body, options = {}) {
  const calls = [];

  t.mock.method(globalThis, "fetch", async (url, fetchOptions) => {
    calls.push({ url, options: fetchOptions });
    return jsonResponse(body, options);
  });

  return calls;
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return body;
    }
  };
}
