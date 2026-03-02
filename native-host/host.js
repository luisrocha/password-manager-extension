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
    const response = await fetchCredentials(message.payload || {});
    writeNative(response);
    return;
  }

  if (message?.type === "PING") {
    writeNative({ ok: true, host: "password-manager-native-host" });
    return;
  }

  writeNative({ ok: false, error: "Unsupported message type" });
}

async function fetchCredentials(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/api/browser/credentials/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {})
      },
      body: JSON.stringify({
        origin: payload.origin,
        url: payload.url,
        title: payload.title,
        frameUrl: payload.frameUrl
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Password manager API returned ${response.status}`
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

function writeNative(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}
