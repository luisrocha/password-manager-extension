import {
  buildUnlockProof,
  decryptText,
  encryptText,
  hasStoredVault,
  importVaultBackup,
  isVaultUnlocked,
  lockVault,
  unlockVault
} from "./vault_crypto.js";

const NATIVE_APP_NAME = "com.password_manager";
const DEFAULT_SETTINGS = {
  autofillOnPageLoad: false,
  allowHttp: false
};
const AUTH_STORAGE_KEY = "browser_auth";
const PENDING_TOTP_STORAGE_KEY = "pending_totp_challenge";
const TOTP_REMEMBERED_CLIENT_STORAGE_KEY = "totp_remembered_client";
const TOTP_REMEMBERED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  await chrome.storage.session.remove(PENDING_TOTP_STORAGE_KEY);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  await chrome.storage.session.remove(PENDING_TOTP_STORAGE_KEY);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-login") return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  chrome.tabs.sendMessage(activeTab.id, { type: "FILL_REQUESTED" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    sendResponse({ ok: false, error: "Invalid message" });
    return;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)).then((settings) => {
      sendResponse({ ok: true, settings: { ...DEFAULT_SETTINGS, ...settings } });
    });
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    chrome.storage.sync.set(message.settings || {}).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "GET_CREDENTIALS") {
    requestNativeCredentials(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_CREDENTIAL_DETAIL") {
    requestNativeCredentialDetail(message.credentialId)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SAVE_CREDENTIAL") {
    saveNativeCredential(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "UPDATE_CREDENTIAL") {
    updateNativeCredential(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "DELETE_CREDENTIAL") {
    deleteNativeCredential(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SEARCH_CREDENTIALS") {
    requestNativeCredentials({
      query: typeof message.query === "string" ? message.query.trim() : ""
    })
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_API_CONFIG") {
    requestNativeApiConfig()
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "AUTHENTICATE") {
    unlockLocalVault(message.masterPassword)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SUBMIT_TOTP_CHALLENGE") {
    submitTotpChallenge(message.totpCode, message.rememberClient)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CANCEL_TOTP_CHALLENGE") {
    clearPendingTotpChallenge().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "IMPORT_VAULT_BACKUP") {
    importVaultBackup(message.serializedBackup)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, code: error.message, error: "Backup import failed" }));
    return true;
  }

  if (message.type === "LOCK_EXTENSION") {
    clearAuthState().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_AUTH_STATE") {
    getAuthState().then((auth) => {
      Promise.all([hasStoredVault(), getPendingTotpChallenge()]).then(([storedVault, pendingTotp]) => sendResponse({
        ok: true,
        auth: {
          hasVault: storedVault,
          localVaultUnlocked: isVaultUnlocked(),
          unlocked: Boolean(auth?.token),
          pendingTotp: Boolean(pendingTotp),
          totpExpiresAt: pendingTotp?.expiresAt || null,
          expiresAt: auth?.expiresAt || null
        }
      }));
    });
    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    sendResponse({ ok: false, error: "Invalid message" });
    return;
  }

  if (message.type === "PING") {
    verifyExternalSender(sender)
      .then(() => hasStoredVault())
      .then((storedVault) => sendResponse({ ok: true, hasVault: storedVault }))
      .catch((error) => sendResponse({ ok: false, code: error.message, error: "Extension connection unavailable" }));
    return true;
  }

  if (message.type === "IMPORT_VAULT_BACKUP") {
    importVaultBackupFromExternalMessage(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, code: error.message, error: "Extension connection failed" }));
    return true;
  }

  sendResponse({ ok: false, error: `Unknown external message type: ${message.type}` });
});

async function requestNativeCredentials(payload = {}) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "GET_CREDENTIALS",
        authToken: auth.token,
        payload: {
          origin: payload?.origin,
          url: payload?.url,
          title: payload?.title,
          frameUrl: payload?.frameUrl,
          query: payload?.query
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response || response.ok === false) {
          if (response?.code === "token_expired" || response?.code === "invalid_token") {
            clearBrowserAuthToken().then(() => {
              resolve({
                ok: false,
                code: "auth_required",
                error: "Session expired. Unlock again."
              });
            });
            return;
          }

          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Native host returned no data"
          });
          return;
        }

        decryptCredentials(response.credentials).then((credentials) => {
          resolve({
            ok: true,
            credentials
          });
        }).catch((error) => {
          resolve({ ok: false, code: "vault_locked", error: error.message || "Failed to decrypt credentials" });
        });
      }
    );
  });
}

async function requestNativeApiConfig() {
  const response = await sendNativeMessage({ type: "GET_API_CONFIG" });
  if (!response.ok) return response;

  return {
    ok: true,
    apiUrl: response.apiUrl || null
  };
}

async function importVaultBackupFromExternalMessage(message, sender) {
  await verifyExternalSender(sender);

  const serializedBackup = message.serializedBackup;
  if (typeof serializedBackup !== "string" || serializedBackup.trim() === "") {
    throw new Error("vault_missing");
  }

  await importVaultBackup(serializedBackup);
  await clearAuthState();
}

async function verifyExternalSender(sender) {
  const senderOrigin = originFromUrl(sender?.url);
  if (!senderOrigin) throw new Error("sender_invalid");

  const response = await requestNativeApiConfig();
  if (!response.ok || !response.apiUrl) throw new Error("api_config_unavailable");

  if (senderOrigin !== originFromUrl(response.apiUrl)) {
    throw new Error("sender_not_allowed");
  }
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function requestNativeCredentialDetail(credentialId) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "GET_CREDENTIAL_DETAIL",
        authToken: auth.token,
        payload: { id: credentialId }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response || response.ok === false) {
          if (response?.code === "token_expired" || response?.code === "invalid_token") {
            clearBrowserAuthToken().then(() => {
              resolve({
                ok: false,
                code: "auth_required",
                error: "Session expired. Unlock again."
              });
            });
            return;
          }

          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Native host returned no data"
          });
          return;
        }

        decryptCredential(response.credential).then((credential) => {
          resolve({ ok: true, credential });
        }).catch((error) => {
          resolve({ ok: false, code: "vault_locked", error: error.message || "Failed to decrypt credential" });
        });
      }
    );
  });
}

async function saveNativeCredential(payload = {}) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

  const encryptedSecretPayload = await encryptCredentialSecretPayload(payload);

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "SAVE_CREDENTIAL",
        authToken: auth.token,
        payload: {
          name: payload?.name,
          displayName: payload?.displayName,
          domain: payload?.domain,
          origin: payload?.origin,
          url: payload?.url,
          title: payload?.title,
          frameUrl: payload?.frameUrl,
          encryptedSecretPayload
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response || response.ok === false) {
          if (response?.code === "token_expired" || response?.code === "invalid_token") {
            clearBrowserAuthToken().then(() => {
              resolve({
                ok: false,
                code: "auth_required",
                error: "Session expired. Unlock again."
              });
            });
            return;
          }

          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Native host returned no data"
          });
          return;
        }

        resolve({
          ok: true,
          credential: response.credential || null
        });
      }
    );
  });
}

async function updateNativeCredential(payload = {}) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

  const encryptedSecretPayload = await encryptCredentialSecretPayload(payload);

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "UPDATE_CREDENTIAL",
        authToken: auth.token,
        payload: {
          id: payload?.id,
          name: payload?.name,
          displayName: payload?.displayName,
          encryptedSecretPayload
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response || response.ok === false) {
          if (response?.code === "token_expired" || response?.code === "invalid_token") {
            clearBrowserAuthToken().then(() => {
              resolve({
                ok: false,
                code: "auth_required",
                error: "Session expired. Unlock again."
              });
            });
            return;
          }

          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Native host returned no data"
          });
          return;
        }

        resolve({
          ok: true,
          credential: response.credential || null
        });
      }
    );
  });
}

async function deleteNativeCredential(payload = {}) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "DELETE_CREDENTIAL",
        authToken: auth.token,
        payload: {
          id: payload?.id
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response || response.ok === false) {
          if (response?.code === "token_expired" || response?.code === "invalid_token") {
            clearBrowserAuthToken().then(() => {
              resolve({
                ok: false,
                code: "auth_required",
                error: "Session expired. Unlock again."
              });
            });
            return;
          }

          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Native host returned no data"
          });
          return;
        }

        resolve({
          ok: true,
          credential: response.credential || null
        });
      }
    );
  });
}

async function unlockLocalVault(masterPassword) {
  if (!masterPassword) {
    return { ok: false, error: "Master password is required" };
  }

  await unlockVault(masterPassword);
  await clearPendingTotpChallenge();
  const challengeResponse = await requestNativeUnlockChallenge();
  if (!challengeResponse.ok) {
    return challengeResponse;
  }

  const proof = await buildUnlockProof(challengeResponse.challenge);
  const rememberedClientToken = await getTotpRememberedClientToken();
  const unlockResponse = await submitNativeUnlockProof({
    challengeId: challengeResponse.challengeId,
    unlockSignature: proof.signature,
    signingPublicKeySpki: proof.signingPublicKeySpki,
    totpRememberedClientToken: rememberedClientToken
  });

  if (!unlockResponse.ok) {
    return unlockResponse;
  }

  if (unlockResponse.requiresTotp) {
    if (rememberedClientToken) await clearTotpRememberedClientToken();
    if (!unlockResponse.totpChallengeId) {
      return { ok: false, code: "totp_required", error: "Two-factor challenge is missing" };
    }
    await storePendingTotpChallenge({
      totpChallengeId: unlockResponse.totpChallengeId,
      expiresAt: unlockResponse.expiresAt || null
    });
    return {
      ok: true,
      code: "totp_required",
      requiresTotp: true,
      expiresAt: unlockResponse.expiresAt || null
    };
  }

  if (!unlockResponse.token) {
    return { ok: false, code: "authentication_failed", error: "Missing browser session token" };
  }

  await chrome.storage.session.set({
    [AUTH_STORAGE_KEY]: {
      token: unlockResponse.token,
      expiresAt: unlockResponse.expiresAt || null
    }
  });

  return { ok: true, localVaultUnlocked: true, expiresAt: unlockResponse.expiresAt || null };
}

async function submitTotpChallenge(totpCode, rememberClient) {
  const pendingTotp = await getPendingTotpChallenge();
  const trimmedCode = typeof totpCode === "string" ? totpCode.trim() : "";
  if (!pendingTotp?.totpChallengeId) {
    return { ok: false, code: "invalid_totp_challenge", error: "Two-factor challenge expired. Unlock again." };
  }
  if (!trimmedCode) {
    return { ok: false, code: "invalid_totp_code", error: "Two-factor code is required" };
  }

  const response = await sendNativeMessage({
    type: "SUBMIT_TOTP_CHALLENGE",
    payload: {
      totpChallengeId: pendingTotp.totpChallengeId,
      totpCode: trimmedCode,
      rememberClient: Boolean(rememberClient)
    }
  });

  if (!response.ok) {
    if (response.code === "invalid_totp_challenge") await clearPendingTotpChallenge();
    return response;
  }

  if (!response.token) {
    return { ok: false, code: "authentication_failed", error: "Missing browser session token" };
  }

  await chrome.storage.session.set({
    [AUTH_STORAGE_KEY]: {
      token: response.token,
      expiresAt: response.expiresAt || null
    }
  });
  await clearPendingTotpChallenge();

  if (response.totpRememberedClientToken) {
    await chrome.storage.local.set({
      [TOTP_REMEMBERED_CLIENT_STORAGE_KEY]: {
        token: response.totpRememberedClientToken,
        expiresAt: new Date(Date.now() + TOTP_REMEMBERED_CLIENT_TTL_MS).toISOString()
      }
    });
  }

  return { ok: true, localVaultUnlocked: true, expiresAt: response.expiresAt || null };
}

async function decryptCredentials(credentials) {
  if (!Array.isArray(credentials)) return [];

  return Promise.all(credentials.map((credential) => decryptCredential(credential)));
}

async function decryptCredential(credential) {
  if (!credential) return null;

  const encryptedSecretPayload = credential.encryptedSecretPayload || credential.encrypted_secret_payload;
  if (!encryptedSecretPayload) {
    return {
      ...credential,
      username: "",
      password: "",
      notes: ""
    };
  }

  const secretPayload = JSON.parse(await decryptText(encryptedSecretPayload));
  return {
    ...credential,
    username: secretPayload.username || "",
    password: secretPayload.password || "",
    notes: secretPayload.notes || ""
  };
}

async function encryptCredentialSecretPayload(payload = {}) {
  return encryptText(JSON.stringify({
    username: payload.username || "",
    password: payload.password || "",
    notes: payload.notes || ""
  }));
}

async function requestNativeUnlockChallenge() {
  return sendNativeMessage({ type: "REQUEST_UNLOCK_CHALLENGE" });
}

async function submitNativeUnlockProof(payload) {
  return sendNativeMessage({ type: "SUBMIT_UNLOCK_PROOF", payload });
}

async function sendNativeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(NATIVE_APP_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Native host unavailable"
        });
        return;
      }

      resolve(response || { ok: false, error: "Native host returned no data" });
    });
  });
}

async function clearAuthState() {
  lockVault();
  await clearBrowserAuthToken();
  await clearPendingTotpChallenge();
}

async function clearBrowserAuthToken() {
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
}

async function getAuthState() {
  const sessionResult = await chrome.storage.session.get(AUTH_STORAGE_KEY);
  const auth = sessionResult?.[AUTH_STORAGE_KEY];
  if (!auth?.token) return null;

  if (auth.expiresAt && Date.now() >= new Date(auth.expiresAt).getTime()) {
    await clearBrowserAuthToken();
    return null;
  }

  return auth;
}

async function storePendingTotpChallenge(challenge) {
  await chrome.storage.session.set({ [PENDING_TOTP_STORAGE_KEY]: challenge });
}

async function getPendingTotpChallenge() {
  const result = await chrome.storage.session.get(PENDING_TOTP_STORAGE_KEY);
  const pendingTotp = result?.[PENDING_TOTP_STORAGE_KEY];
  if (!pendingTotp?.totpChallengeId) return null;

  if (pendingTotp.expiresAt && Date.now() >= new Date(pendingTotp.expiresAt).getTime()) {
    await clearPendingTotpChallenge();
    return null;
  }

  return pendingTotp;
}

async function clearPendingTotpChallenge() {
  await chrome.storage.session.remove(PENDING_TOTP_STORAGE_KEY);
}

async function getTotpRememberedClientToken() {
  const result = await chrome.storage.local.get(TOTP_REMEMBERED_CLIENT_STORAGE_KEY);
  const rememberedClient = result?.[TOTP_REMEMBERED_CLIENT_STORAGE_KEY];
  if (!rememberedClient?.token) return null;

  if (rememberedClient.expiresAt && Date.now() >= new Date(rememberedClient.expiresAt).getTime()) {
    await clearTotpRememberedClientToken();
    return null;
  }

  return rememberedClient.token;
}

async function clearTotpRememberedClientToken() {
  await chrome.storage.local.remove(TOTP_REMEMBERED_CLIENT_STORAGE_KEY);
}
