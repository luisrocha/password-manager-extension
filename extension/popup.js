const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const fillNowButton = document.getElementById("fill-now");
const autofillOnLoadInput = document.getElementById("autofill-on-load");
const allowHttpInput = document.getElementById("allow-http");

let activeTabId = null;

init().catch((error) => setStatus(error.message, true));

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = activeTab?.id;
  siteEl.textContent = activeTab?.url ? new URL(activeTab.url).origin : "No active site";

  const settingsResp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (settingsResp?.ok) {
    autofillOnLoadInput.checked = Boolean(settingsResp.settings.autofillOnPageLoad);
    allowHttpInput.checked = Boolean(settingsResp.settings.allowHttp);
  }

  autofillOnLoadInput.addEventListener("change", saveSettings);
  allowHttpInput.addEventListener("change", saveSettings);
  fillNowButton.addEventListener("click", onFillNow);
}

async function saveSettings() {
  const settings = {
    autofillOnPageLoad: autofillOnLoadInput.checked,
    allowHttp: allowHttpInput.checked
  };

  const response = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to save settings", true);
    return;
  }

  setStatus("Settings saved");
}

async function onFillNow() {
  if (!activeTabId) {
    setStatus("No active tab found", true);
    return;
  }

  const response = await chrome.tabs.sendMessage(activeTabId, { type: "FILL_REQUESTED" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to fill credentials", true);
    return;
  }

  if (response.skipped) {
    setStatus(response.message || "Nothing to fill on this page");
    return;
  }

  setStatus(`Filled: ${response.account || "account"}`);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}
