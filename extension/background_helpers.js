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
