const NATIVE_APP_NAME = "com.password_manager";
const DEFAULT_SETTINGS = {
  autofillOnPageLoad: false,
  allowHttp: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
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

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
});

function requestNativeCredentials(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_APP_NAME,
      {
        type: "GET_CREDENTIALS",
        payload: {
          origin: payload?.origin,
          url: payload?.url,
          title: payload?.title,
          frameUrl: payload?.frameUrl
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
          resolve({
            ok: false,
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
