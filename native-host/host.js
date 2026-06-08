import process from "node:process";
import { pathToFileURL } from "node:url";

const API_URL = process.env.PASSWORD_MANAGER_API_URL || "https://vault.localhost";
const API_TOKEN = process.env.PASSWORD_MANAGER_API_TOKEN || "";
const TIMEOUT_MS = Number(process.env.PASSWORD_MANAGER_TIMEOUT_MS || 3000);

let buffer = Buffer.alloc(0);

if (isMainModule()) {
  startNativeHost();
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function startNativeHost() {
  process.stdin.on("readable", () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      buffer = Buffer.concat([buffer, chunk]);
      consumeMessages();
    }
  });

  process.stdin.on("end", () => process.exit(0));
}

function consumeMessages() {
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) return;

    const json = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);

    handleMessage(json).catch((error) => {
      writeNative({ ok: false, error: error.message || "Host error" });
    });
  }
}

async function handleMessage(rawJson) {
  let message;
  try {
    message = JSON.parse(rawJson);
  } catch {
    writeNative({ ok: false, error: "Invalid JSON from extension" });
    return;
  }

  if (message?.type === "GET_CREDENTIALS") {
    const response = await fetchCredentials(message.payload || {}, message.authToken);
    writeNative(response);
    return;
  }

  if (message?.type === "GET_CREDENTIAL_DETAIL") {
    const response = await fetchCredentialDetail(message.payload || {}, message.authToken);
    writeNative(response);
    return;
  }

  if (message?.type === "SAVE_CREDENTIAL") {
    const response = await saveCredential(message.payload || {}, message.authToken);
    writeNative(response);
    return;
  }

  if (message?.type === "UPDATE_CREDENTIAL") {
    const response = await updateCredential(message.payload || {}, message.authToken);
    writeNative(response);
    return;
  }

  if (message?.type === "DELETE_CREDENTIAL") {
    const response = await deleteCredential(message.payload || {}, message.authToken);
    writeNative(response);
    return;
  }

  if (message?.type === "GET_API_CONFIG") {
    writeNative({ ok: true, apiUrl: API_URL });
    return;
  }

  if (message?.type === "REQUEST_UNLOCK_CHALLENGE") {
    const response = await requestUnlockChallenge();
    writeNative(response);
    return;
  }

  if (message?.type === "SUBMIT_UNLOCK_PROOF") {
    const response = await submitUnlockProof(message.payload || {});
    writeNative(response);
    return;
  }

  if (message?.type === "SUBMIT_TOTP_CHALLENGE") {
    const response = await submitTotpChallenge(message.payload || {});
    writeNative(response);
    return;
  }

  if (message?.type === "PING") {
    writeNative({ ok: true, host: "password-manager-native-host" });
    return;
  }

  writeNative({ ok: false, error: "Unsupported message type" });
}

async function fetchCredentials(payload, authToken) {
  const bearerToken = authToken || API_TOKEN;
  if (!bearerToken) {
    return { ok: false, code: "auth_required", error: "Unlock required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`
      },
      body: JSON.stringify({
        origin: payload.origin,
        url: payload.url,
        title: payload.title,
        frameUrl: payload.frameUrl,
        query: payload.query
      }),
      signal: controller.signal
    });

    if (!response.ok) return apiErrorResponse(response, await safeJson(response));

    const parsed = await response.json();
    return {
      ok: true,
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : []
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCredentialDetail(payload, authToken) {
  const bearerToken = authToken || API_TOKEN;
  if (!bearerToken) {
    return { ok: false, code: "auth_required", error: "Unlock required" };
  }

  if (!payload.id) {
    return { ok: false, code: "invalid_request", error: "Credential id is required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials/${payload.id}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${bearerToken}`
      },
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) return apiErrorResponse(response, parsed);

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function saveCredential(payload, authToken) {
  const bearerToken = authToken || API_TOKEN;
  if (!bearerToken) {
    return { ok: false, code: "auth_required", error: "Unlock required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`
      },
      body: JSON.stringify({
        name: payload.name,
        displayName: payload.displayName,
        domain: payload.domain,
        origin: payload.origin,
        url: payload.url,
        title: payload.title,
        frameUrl: payload.frameUrl,
        encryptedSecretPayload: payload.encryptedSecretPayload
      }),
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) return apiErrorResponse(response, parsed);

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function updateCredential(payload, authToken) {
  const bearerToken = authToken || API_TOKEN;
  if (!bearerToken) {
    return { ok: false, code: "auth_required", error: "Unlock required" };
  }

  if (!payload.id) {
    return { ok: false, code: "invalid_request", error: "Credential id is required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials/${payload.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`
      },
      body: JSON.stringify({
        name: payload.name,
        displayName: payload.displayName,
        encryptedSecretPayload: payload.encryptedSecretPayload
      }),
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) return apiErrorResponse(response, parsed);

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteCredential(payload, authToken) {
  const bearerToken = authToken || API_TOKEN;
  if (!bearerToken) {
    return { ok: false, code: "auth_required", error: "Unlock required" };
  }

  if (!payload.id) {
    return { ok: false, code: "invalid_request", error: "Credential id is required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials/${payload.id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${bearerToken}`
      },
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) return apiErrorResponse(response, parsed);

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestUnlockChallenge() {
  if (!API_TOKEN) {
    return {
      ok: false,
      code: "invalid_api_token",
      error: "PASSWORD_MANAGER_API_TOKEN is required to unlock"
    };
  }

  const response = await postUnlockPayload({});
  if (!response.ok) return response;

  if (!response.challengeId || !response.challenge) {
    return { ok: false, code: "authentication_failed", error: "Missing unlock challenge in response" };
  }

  return response;
}

async function submitUnlockProof(payload) {
  if (!payload.challengeId || !payload.unlockSignature) {
    return { ok: false, code: "invalid_request", error: "Unlock challenge and signature are required" };
  }

  return postUnlockPayload({
    challengeId: payload.challengeId,
    unlockSignature: payload.unlockSignature,
    signingPublicKeySpki: payload.signingPublicKeySpki,
    totpRememberedClientToken: payload.totpRememberedClientToken || undefined
  });
}

async function submitTotpChallenge(payload) {
  if (!payload.totpChallengeId || !payload.totpCode) {
    return { ok: false, code: "invalid_request", error: "Two-factor challenge and code are required" };
  }

  return postUnlockPayload({
    totpChallengeId: payload.totpChallengeId,
    totpCode: payload.totpCode,
    rememberClient: Boolean(payload.rememberClient)
  });
}

async function postUnlockPayload(payload) {
  if (!API_TOKEN) {
    return {
      ok: false,
      code: "invalid_api_token",
      error: "PASSWORD_MANAGER_API_TOKEN is required to unlock"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/auth/unlock`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const body = await safeJson(response);
    if (!response.ok && response.status !== 202) {
      return apiErrorResponse(response, body, "authentication_failed", `Authentication failed (${response.status})`);
    }

    if (body?.requiresTotp) {
      return {
        ok: true,
        requiresTotp: true,
        totpChallengeId: body.totpChallengeId || null,
        expiresAt: body.expiresAt || null
      };
    }

    return {
      ok: true,
      challengeId: body?.challengeId || null,
      challenge: body?.challenge || null,
      token: body?.token || null,
      expiresAt: body?.expiresAt || null,
      tokenType: body?.tokenType || null,
      totpRememberedClientToken: body?.totpRememberedClientToken || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, code: "timeout", error: "Password manager API timed out" };
    }
    return bridgeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function apiErrorResponse(response, body, fallbackCode = "api_error", fallbackError = null) {
  return {
    ok: false,
    code: body?.code || apiErrorCodeForStatus(response.status, fallbackCode),
    error: body?.error || fallbackError || `Password manager API returned ${response.status}`
  };
}

function apiErrorCodeForStatus(status, fallbackCode) {
  if (status === 401) return "invalid_token";
  if (status === 429) return "rate_limited";
  return fallbackCode;
}

function bridgeFetchError(error) {
  const cause = error?.cause;
  const causeCode = cause?.code || "";

  if ([
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "DEPTH_ZERO_SELF_SIGNED_CERT"
  ].includes(causeCode)) {
    return {
      ok: false,
      code: "tls_untrusted_certificate",
      error: "Password manager HTTPS certificate is not trusted by the native host."
    };
  }

  if (causeCode === "ECONNREFUSED") {
    return {
      ok: false,
      code: "connection_refused",
      error: `Could not connect to password manager at ${API_URL}. Check that the app is running and PASSWORD_MANAGER_API_URL is correct.`
    };
  }

  if (causeCode === "ENOTFOUND") {
    return {
      ok: false,
      code: "host_not_found",
      error: `Could not resolve password manager host for ${API_URL}. Check PASSWORD_MANAGER_API_URL.`
    };
  }

  return {
    ok: false,
    code: causeCode ? "bridge_error" : "fetch_failed",
    error: causeCode ? `Bridge request failed (${causeCode})` : (error.message || "Bridge request failed")
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function writeNative(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

export {
  apiErrorResponse,
  deleteCredential,
  fetchCredentialDetail,
  fetchCredentials,
  requestUnlockChallenge,
  saveCredential,
  submitTotpChallenge,
  submitUnlockProof,
  updateCredential
};
