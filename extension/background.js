const NATIVE_APP_NAME = "com.password_manager";
const DEFAULT_SETTINGS = {
  autofillOnPageLoad: false,
  allowHttp: false
};
const AUTH_STORAGE_KEY = "browser_auth";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
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

  if (message.type === "AUTHENTICATE") {
    authenticateWithMasterPassword(message.masterPassword)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "LOCK_EXTENSION") {
    clearAuthState().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_AUTH_STATE") {
    getAuthState().then((auth) => {
      sendResponse({
        ok: true,
        auth: {
          unlocked: Boolean(auth?.token),
          expiresAt: auth?.expiresAt || null
        }
      });
    });
    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
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
            clearAuthState().then(() => {
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
          credentials: Array.isArray(response.credentials) ? response.credentials : []
        });
      }
    );
  });
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
            clearAuthState().then(() => {
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

async function saveNativeCredential(payload = {}) {
  const auth = await getAuthState();
  if (!auth?.token) {
    return { ok: false, error: "Unlock required", code: "auth_required" };
  }

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
          username: payload?.username,
          password: payload?.password,
          notes: payload?.notes
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
            clearAuthState().then(() => {
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

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "UPDATE_CREDENTIAL",
        authToken: auth.token,
        payload: {
          id: payload?.id,
          username: payload?.username,
          password: payload?.password,
          notes: payload?.notes
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
            clearAuthState().then(() => {
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
            clearAuthState().then(() => {
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

function authenticateWithMasterPassword(masterPassword) {
  if (!masterPassword) {
    return Promise.resolve({ ok: false, error: "Master password is required" });
  }

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "AUTHENTICATE",
        payload: { masterPassword }
      },
      async (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Native host unavailable"
          });
          return;
        }

        if (!response?.ok || !response.token) {
          resolve({
            ok: false,
            code: response?.code,
            error: response?.error || "Unlock failed"
          });
          return;
        }

        await chrome.storage.session.set({
          [AUTH_STORAGE_KEY]: {
            token: response.token,
            expiresAt: response.expiresAt || null
          }
        });
        await chrome.storage.local.remove(AUTH_STORAGE_KEY);

        resolve({ ok: true, expiresAt: response.expiresAt || null });
      }
    );
  });
}

async function clearAuthState() {
  await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

async function getAuthState() {
  const sessionResult = await chrome.storage.session.get(AUTH_STORAGE_KEY);
  const auth = sessionResult?.[AUTH_STORAGE_KEY];
  if (!auth?.token) return null;

  if (auth.expiresAt && Date.now() >= new Date(auth.expiresAt).getTime()) {
    await clearAuthState();
    return null;
  }

  return auth;
}
