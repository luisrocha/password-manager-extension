const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const unlockFormEl = document.getElementById("locked-section");
const lockedSectionEl = unlockFormEl;
const unlockedSectionEl = document.getElementById("unlocked-section");
const masterPasswordInput = document.getElementById("master-password");
const fillNowButton = document.getElementById("fill-now");
const credentialSelectionEl = document.getElementById("credential-selection");
const credentialSelectEl = document.getElementById("credential-select");
const credentialDetailsEl = document.getElementById("credential-details");
const selectedUsernameInput = document.getElementById("selected-username");
const selectedPasswordInput = document.getElementById("selected-password");
const copyUsernameButton = document.getElementById("copy-username");
const copyPasswordButton = document.getElementById("copy-password");
const togglePasswordButton = document.getElementById("toggle-password");
const autofillOnLoadInput = document.getElementById("autofill-on-load");
const allowHttpInput = document.getElementById("allow-http");

let activeTabId = null;
let listedCredentials = [];

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
  credentialSelectEl.addEventListener("change", onCredentialSelectionChange);
  copyUsernameButton.addEventListener("click", onCopyUsername);
  copyPasswordButton.addEventListener("click", onCopyPassword);
  togglePasswordButton.addEventListener("click", onTogglePasswordVisibility);

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

  const selectedCredentialId = getSelectedCredentialId();

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
    const credentials = Array.isArray(response.credentials) ? response.credentials : [];
    showCredentialSelection(credentials);
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
  listedCredentials = credentials;
  credentialSelectEl.innerHTML = "";

  credentials.forEach((credential) => {
    const option = document.createElement("option");
    option.value = credential.id;
    option.textContent = formatCredentialOption(credential);
    credentialSelectEl.append(option);
  });

  credentialSelectionEl.classList.remove("hidden");
  renderSelectedCredentialDetails();
  setFillButtonHasCredentials(true);
}

function hideCredentialSelection() {
  listedCredentials = [];
  credentialSelectionEl.classList.add("hidden");
  credentialSelectEl.innerHTML = "";
  hideCredentialDetails();
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

function onCredentialSelectionChange() {
  renderSelectedCredentialDetails();
}

function renderSelectedCredentialDetails() {
  const selectedCredentialId = getSelectedCredentialId();
  if (!selectedCredentialId) {
    hideCredentialDetails();
    return;
  }

  const selectedCredential = listedCredentials.find((credential) => credential.id === selectedCredentialId);
  if (!selectedCredential) {
    hideCredentialDetails();
    return;
  }

  selectedUsernameInput.value = selectedCredential.username || "";
  selectedPasswordInput.value = selectedCredential.password || "";
  selectedPasswordInput.classList.add("masked");
  togglePasswordButton.textContent = "Show";
  credentialDetailsEl.classList.remove("hidden");
}

function getSelectedCredentialId() {
  if (credentialSelectionEl.classList.contains("hidden")) return null;
  const value = credentialSelectEl.value || "";
  return value.trim() ? value : null;
}

function hideCredentialDetails() {
  credentialDetailsEl.classList.add("hidden");
  selectedUsernameInput.value = "";
  selectedPasswordInput.value = "";
  selectedPasswordInput.classList.add("masked");
  togglePasswordButton.textContent = "Show";
}

async function onCopyUsername() {
  await copyToClipboard(selectedUsernameInput.value, "Username copied");
}

async function onCopyPassword() {
  await copyToClipboard(selectedPasswordInput.value, "Password copied");
}

function onTogglePasswordVisibility() {
  const isHidden = selectedPasswordInput.classList.contains("masked");
  selectedPasswordInput.classList.toggle("masked", !isHidden);
  togglePasswordButton.textContent = isHidden ? "Hide" : "Show";
}

async function copyToClipboard(value, successMessage) {
  if (!value) {
    setStatus("Nothing to copy", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setStatus(successMessage);
  } catch {
    setStatus("Failed to copy", true);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}
