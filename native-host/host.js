import process from "node:process";

const API_URL = process.env.PASSWORD_MANAGER_API_URL || "http://127.0.0.1:17325";
const API_TOKEN = process.env.PASSWORD_MANAGER_API_TOKEN || "";
const TIMEOUT_MS = Number(process.env.PASSWORD_MANAGER_TIMEOUT_MS || 3000);

let buffer = Buffer.alloc(0);

process.stdin.on("readable", () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    buffer = Buffer.concat([buffer, chunk]);
    consumeMessages();
  }
});

process.stdin.on("end", () => process.exit(0));

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

  if (message?.type === "AUTHENTICATE") {
    const response = await authenticate(message.payload || {});
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

    if (!response.ok) {
      const errorBody = await safeJson(response);
      return {
        ok: false,
        code: errorBody?.code || (response.status === 401 ? "invalid_token" : "api_error"),
        error: errorBody?.error || `Password manager API returned ${response.status}`
      };
    }

    const parsed = await response.json();
    return {
      ok: true,
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : []
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return { ok: false, error: error.message || "Bridge request failed" };
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
        username: payload.username,
        password: payload.password,
        notes: payload.notes
      }),
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) {
      return {
        ok: false,
        code: parsed?.code || (response.status === 401 ? "invalid_token" : "api_error"),
        error: parsed?.error || `Password manager API returned ${response.status}`
      };
    }

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return { ok: false, error: error.message || "Bridge request failed" };
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
        username: payload.username,
        password: payload.password,
        notes: payload.notes
      }),
      signal: controller.signal
    });

    const parsed = await safeJson(response);
    if (!response.ok) {
      return {
        ok: false,
        code: parsed?.code || (response.status === 401 ? "invalid_token" : "api_error"),
        error: parsed?.error || `Password manager API returned ${response.status}`
      };
    }

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return { ok: false, error: error.message || "Bridge request failed" };
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
    if (!response.ok) {
      return {
        ok: false,
        code: parsed?.code || (response.status === 401 ? "invalid_token" : "api_error"),
        error: parsed?.error || `Password manager API returned ${response.status}`
      };
    }

    return {
      ok: true,
      credential: parsed?.credential || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "Password manager API timed out" };
    }
    return { ok: false, error: error.message || "Bridge request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticate(payload) {
  if (!API_TOKEN) {
    return {
      ok: false,
      code: "invalid_api_token",
      error: "PASSWORD_MANAGER_API_TOKEN is required to unlock"
    };
  }

  const masterPassword = payload.masterPassword;
  if (!masterPassword) {
    return { ok: false, code: "invalid_master_password", error: "Master password is required" };
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
      body: JSON.stringify({ masterPassword }),
      signal: controller.signal
    });

    const body = await safeJson(response);
    if (!response.ok) {
      return {
        ok: false,
        code: body?.code || "authentication_failed",
        error: body?.error || `Authentication failed (${response.status})`
      };
    }

    if (!body?.token) {
      return { ok: false, code: "authentication_failed", error: "Missing token in response" };
    }

    return {
      ok: true,
      token: body.token,
      expiresAt: body.expiresAt || null
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, code: "timeout", error: "Password manager API timed out" };
    }
    return { ok: false, code: "bridge_error", error: error.message || "Bridge request failed" };
  } finally {
    clearTimeout(timeout);
  }
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
