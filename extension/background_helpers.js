export function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function credentialSecretPayloadFrom(payload = {}) {
  return {
    username: payload?.username || "",
    password: payload?.password || "",
    notes: payload?.notes || ""
  };
}

export function serializeCredentialSecretPayload(payload = {}) {
  return JSON.stringify(credentialSecretPayloadFrom(payload));
}

export function expiresAtHasPassed(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;

  const expiresAtTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtTime) && now >= expiresAtTime;
}

export function isInvalidBrowserTokenResponse(response) {
  return response?.code === "token_expired" || response?.code === "invalid_token";
}
