const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const unlockFormEl = document.getElementById("locked-section");
const lockedSectionEl = unlockFormEl;
const unlockedSectionEl = document.getElementById("unlocked-section");
const masterPasswordInput = document.getElementById("master-password");
const fillNowButton = document.getElementById("fill-now");
const credentialSelectionEl = document.getElementById("credential-selection");
const credentialSelectEl = document.getElementById("credential-select");
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
  unlockFormEl.addEventListener("submit", onUnlockSubmit);

  const unlocked = await refreshAuthState();
  if (unlocked) {
    await loadCredentialOptions();
  }
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

  const selectedCredentialId = credentialSelectionEl.classList.contains("hidden")
    ? null
    : credentialSelectEl.value || null;

  if (!selectedCredentialId) {
    setStatus("Select an account first.", true);
    return;
  }

  const response = await chrome.tabs.sendMessage(activeTabId, {
    type: "FILL_REQUESTED",
    credentialId: selectedCredentialId
  });
  if (!response?.ok) {
    if (response?.code === "auth_required") {
      await refreshAuthState();
      hideCredentialSelection();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    setStatus(response?.error || "Failed to fill credentials", true);
    return;
  }

  if (response.needsSelection) {
    showCredentialSelection(response.credentials || []);
    setStatus("Select an account, then click Fill credentials.", true);
    return;
  }

  if (response.skipped) {
    setStatus(response.message || "Nothing to fill on this page");
    return;
  }

  setStatus(`Filled: ${response.account || "account"}`);
}

async function onUnlock() {
  const masterPassword = masterPasswordInput.value;
  const response = await chrome.runtime.sendMessage({
    type: "AUTHENTICATE",
    masterPassword
  });

  if (!response?.ok) {
    setStatus(response?.error || "Unlock failed", true);
    return;
  }

  masterPasswordInput.value = "";
  const unlocked = await refreshAuthState();
  if (unlocked) {
    await loadCredentialOptions();
  }
  setStatus("Extension unlocked");
}

async function onUnlockSubmit(event) {
  event.preventDefault();
  await onUnlock();
}

async function refreshAuthState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });
  const unlocked = Boolean(response?.ok && response?.auth?.unlocked);

  lockedSectionEl.classList.toggle("hidden", unlocked);
  unlockedSectionEl.classList.toggle("hidden", !unlocked);

  if (!unlocked) {
    hideCredentialSelection();
    setFillButtonHasCredentials(false);
    masterPasswordInput.focus();
  }

  return unlocked;
}

function showCredentialSelection(credentials) {
  credentialSelectEl.innerHTML = "";

  credentials.forEach((credential) => {
    const option = document.createElement("option");
    option.value = credential.id;
    option.textContent = formatCredentialOption(credential);
    credentialSelectEl.append(option);
  });

  credentialSelectionEl.classList.remove("hidden");
  setFillButtonHasCredentials(true);
}

function hideCredentialSelection() {
  credentialSelectionEl.classList.add("hidden");
  credentialSelectEl.innerHTML = "";
  setFillButtonHasCredentials(false);
}

function formatCredentialOption(credential) {
  const name = credential.displayName || credential.username || "Account";
  if (!credential.username || credential.username === name) return name;
  return `${name} (${credential.username})`;
}

async function loadCredentialOptions() {
  if (!activeTabId) {
    hideCredentialSelection();
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "LIST_CREDENTIALS" });
    if (!response?.ok) {
      hideCredentialSelection();
      if (response?.error) {
        setStatus(response.error, true);
      }
      return;
    }

    const credentials = Array.isArray(response.credentials) ? response.credentials : [];
    if (!credentials.length) {
      hideCredentialSelection();
      setStatus("No credentials found for this site");
      return;
    }

    showCredentialSelection(credentials);
  } catch {
    hideCredentialSelection();
    setStatus("This page does not support autofill", true);
  }
}

function setFillButtonHasCredentials(hasCredentials) {
  fillNowButton.disabled = !hasCredentials;
  fillNowButton.textContent = hasCredentials ? "Fill credentials" : "No credentials found";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}
