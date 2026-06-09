import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialSecretPayloadFrom,
  expiresAtHasPassed,
  isInvalidBrowserTokenResponse,
  originFromUrl,
  serializeCredentialSecretPayload
} from "../background_helpers.js";

test("originFromUrl returns normalized origins", () => {
  assert.equal(originFromUrl("https://vault.localhost/security?extension_id=abc#connect"), "https://vault.localhost");
  assert.equal(originFromUrl("http://127.0.0.1:3000/credentials"), "http://127.0.0.1:3000");
});

test("originFromUrl rejects invalid URLs", () => {
  assert.equal(originFromUrl("not a url"), null);
  assert.equal(originFromUrl(null), null);
  assert.equal(originFromUrl(undefined), null);
});

test("credentialSecretPayloadFrom keeps only local secret fields", () => {
  assert.deepEqual(
    credentialSecretPayloadFrom({
      username: "person@example.com",
      password: "secret",
      notes: "private note",
      encryptedSecretPayload: "encrypted",
      domain: "example.com"
    }),
    {
      username: "person@example.com",
      password: "secret",
      notes: "private note"
    }
  );
});

test("credentialSecretPayloadFrom defaults missing secret fields to empty strings", () => {
  assert.deepEqual(credentialSecretPayloadFrom({ username: "person@example.com" }), {
    username: "person@example.com",
    password: "",
    notes: ""
  });
});

test("serializeCredentialSecretPayload serializes the encrypted payload shape", () => {
  assert.equal(
    serializeCredentialSecretPayload({ username: "person@example.com", password: "secret" }),
    '{"username":"person@example.com","password":"secret","notes":""}'
  );
});

test("expiresAtHasPassed detects expired timestamps", () => {
  const now = Date.parse("2026-06-09T12:00:00Z");

  assert.equal(expiresAtHasPassed("2026-06-09T11:59:59Z", now), true);
  assert.equal(expiresAtHasPassed("2026-06-09T12:00:00Z", now), true);
  assert.equal(expiresAtHasPassed("2026-06-09T12:00:01Z", now), false);
});

test("expiresAtHasPassed treats missing or invalid timestamps as not expired", () => {
  const now = Date.parse("2026-06-09T12:00:00Z");

  assert.equal(expiresAtHasPassed(null, now), false);
  assert.equal(expiresAtHasPassed("", now), false);
  assert.equal(expiresAtHasPassed("not a timestamp", now), false);
});

test("isInvalidBrowserTokenResponse detects token invalidation responses", () => {
  assert.equal(isInvalidBrowserTokenResponse({ code: "token_expired" }), true);
  assert.equal(isInvalidBrowserTokenResponse({ code: "invalid_token" }), true);
  assert.equal(isInvalidBrowserTokenResponse({ code: "invalid_api_token" }), false);
  assert.equal(isInvalidBrowserTokenResponse({ code: "invalid_totp_code" }), false);
  assert.equal(isInvalidBrowserTokenResponse(null), false);
});
