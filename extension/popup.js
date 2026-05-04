const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const unlockFormEl = document.getElementById("locked-section");
const lockedSectionEl = unlockFormEl;
const unlockedSectionEl = document.getElementById("unlocked-section");
const masterPasswordInput = document.getElementById("master-password");
const fillNowButton = document.getElementById("fill-now");
const editCredentialButton = document.getElementById("edit-credential");
const credentialsBrowserViewEl = document.getElementById("credentials-browser-view");
const credentialSearchFormEl = document.getElementById("credential-search-form");
const credentialSearchInputEl = document.getElementById("credential-search-input");
const credentialSelectionEl = document.getElementById("credential-selection");
const credentialSelectEl = document.getElementById("credential-select");
const credentialDetailsEl = document.getElementById("credential-details");
const selectedUsernameInput = document.getElementById("selected-username");
const selectedPasswordInput = document.getElementById("selected-password");
const copyUsernameButton = document.getElementById("copy-username");
const copyPasswordButton = document.getElementById("copy-password");
const togglePasswordButton = document.getElementById("toggle-password");
const addNewCredentialButton = document.getElementById("add-new-credential");
const newCredentialFormEl = document.getElementById("new-credential-form");
const newCredentialTitleEl = document.getElementById("new-credential-title");
const newCredentialUsernameInput = document.getElementById("new-credential-username");
const newCredentialPasswordInput = document.getElementById("new-credential-password");
const cancelNewCredentialButton = document.getElementById("cancel-new-credential");
const deleteCredentialButton = document.getElementById("delete-credential");
const autofillOnLoadInput = document.getElementById("autofill-on-load");
const allowHttpInput = document.getElementById("allow-http");

let activeTabId = null;
let listedCredentials = [];
let currentPageContext = emptyPageContext();
let credentialFormMode = "create";
let editingCredentialId = null;

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
  editCredentialButton.addEventListener("click", onEditCredential);
  addNewCredentialButton.addEventListener("click", onAddNewCredential);
  newCredentialFormEl.addEventListener("submit", onNewCredentialSubmit);
  cancelNewCredentialButton.addEventListener("click", onCancelNewCredential);
  deleteCredentialButton.addEventListener("click", onDeleteCredential);
  unlockFormEl.addEventListener("submit", onUnlockSubmit);
  credentialSearchFormEl.addEventListener("submit", onCredentialSearchSubmit);
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
  const selectedCredential = getSelectedCredential();

  if (!selectedCredentialId) {
    setStatus("Select an account first.", true);
    return;
  }

  const response = await chrome.tabs.sendMessage(activeTabId, {
    type: "FILL_REQUESTED",
    credentialId: selectedCredentialId,
    selectedCredential
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

async function onAddNewCredential() {
  if (!activeTabId) {
    setStatus("No active tab found", true);
    return;
  }

  currentPageContext = await extractCurrentPageContext();
  credentialFormMode = "create";
  editingCredentialId = null;
  newCredentialUsernameInput.value = currentPageContext.username || "";
  newCredentialPasswordInput.value = currentPageContext.password || "";
  showNewCredentialForm("Add new credential");
  setStatus("Add the username and password, then click Save.");
}

async function onNewCredentialSubmit(event) {
  event.preventDefault();

  const username = newCredentialUsernameInput.value.trim();
  const password = newCredentialPasswordInput.value;

  if (!password) {
    setStatus("Password is required", true);
    newCredentialPasswordInput.focus();
    return;
  }

  const saveResponse = credentialFormMode === "edit"
    ? await chrome.runtime.sendMessage({
      type: "UPDATE_CREDENTIAL",
      payload: {
        id: editingCredentialId,
        username,
        password
      }
    })
    : await chrome.runtime.sendMessage({
      type: "SAVE_CREDENTIAL",
      payload: {
        ...currentPageContext,
        username,
        password
      }
    });

  if (!saveResponse?.ok) {
    if (saveResponse?.code === "auth_required") {
      await refreshAuthState();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    setStatus(saveResponse?.error || "Failed to save credential", true);
    return;
  }

  const savedCredentialId = saveResponse.credential?.id || null;
  const savedName = saveResponse.credential?.displayName || currentPageContext.title || "credential";
  hideNewCredentialForm({ clearValues: true });
  credentialSearchInputEl.value = "";
  await loadCredentialOptions({ selectedCredentialId: savedCredentialId });
  setStatus(`Saved: ${savedName}`);
}

function onCancelNewCredential() {
  hideNewCredentialForm({ clearValues: true });
}

function onEditCredential() {
  const selectedCredential = getSelectedCredential();
  if (!selectedCredential) {
    setStatus("Select an account first.", true);
    return;
  }

  credentialFormMode = "edit";
  editingCredentialId = selectedCredential.id;
  newCredentialUsernameInput.value = selectedCredential.username || "";
  newCredentialPasswordInput.value = selectedCredential.password || "";
  showNewCredentialForm("Edit credential");
  setStatus("Update the username or password, then click Save.");
}

async function onDeleteCredential() {
  if (credentialFormMode !== "edit" || !editingCredentialId) {
    setStatus("No credential selected for deletion", true);
    return;
  }

  const deleteResponse = await chrome.runtime.sendMessage({
    type: "DELETE_CREDENTIAL",
    payload: {
      id: editingCredentialId
    }
  });

  if (!deleteResponse?.ok) {
    if (deleteResponse?.code === "auth_required") {
      await refreshAuthState();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    setStatus(deleteResponse?.error || "Failed to delete credential", true);
    return;
  }

  const deletedName = deleteResponse.credential?.displayName || "credential";
  hideNewCredentialForm({ clearValues: true });
  credentialSearchInputEl.value = "";
  await loadCredentialOptions();
  setStatus(`Deleted: ${deletedName}`);
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
    hideNewCredentialForm({ clearValues: true });
    setCredentialActionState(false);
    masterPasswordInput.focus();
  }

  return unlocked;
}

function showCredentialSelection(credentials, options = {}) {
  listedCredentials = credentials.map((credential) => ({
    id: credential.id,
    displayName: credential.displayName || "",
    domain: credential.domain || "",
    username: credential.username || "",
    password: credential.password || ""
  }));
  credentialSelectEl.innerHTML = "";

  listedCredentials.forEach((credential) => {
    const option = document.createElement("option");
    option.value = credential.id;
    option.textContent = formatCredentialOption(credential);
    credentialSelectEl.append(option);
  });

  if (options.selectedCredentialId) {
    const hasMatchingCredential = listedCredentials.some((credential) => credential.id === options.selectedCredentialId);
    if (hasMatchingCredential) credentialSelectEl.value = options.selectedCredentialId;
  }

  credentialSelectionEl.classList.remove("hidden");
  renderSelectedCredentialDetails();
  setCredentialActionState(true);
}

function hideCredentialSelection() {
  listedCredentials = [];
  credentialSelectionEl.classList.add("hidden");
  credentialSelectEl.innerHTML = "";
  hideCredentialDetails();
  setCredentialActionState(false);
}

function formatCredentialOption(credential) {
  const name = credential.displayName || credential.username || "Account";
  const domain = credential.domain ? ` @ ${credential.domain}` : "";
  if (!credential.username || credential.username === name) return `${name}${domain}`;
  return `${name} (${credential.username})${domain}`;
}

async function loadCredentialOptions(options = {}) {
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

    showCredentialSelection(credentials, options);
  } catch {
    hideCredentialSelection();
    setStatus("This page does not support autofill", true);
  }
}

function setCredentialActionState(hasCredentials) {
  fillNowButton.disabled = !hasCredentials;
  fillNowButton.textContent = hasCredentials ? "Fill credentials" : "No credentials found";
  editCredentialButton.classList.toggle("hidden", !hasCredentials);
  editCredentialButton.disabled = !hasCredentials;
}

function showNewCredentialForm(title) {
  credentialsBrowserViewEl.classList.add("hidden");
  newCredentialFormEl.classList.remove("hidden");
  newCredentialTitleEl.textContent = title;
  deleteCredentialButton.classList.toggle("hidden", credentialFormMode !== "edit");
  newCredentialUsernameInput.focus();
}

function hideNewCredentialForm(options = {}) {
  credentialsBrowserViewEl.classList.remove("hidden");
  newCredentialFormEl.classList.add("hidden");
  deleteCredentialButton.classList.add("hidden");

  if (options.clearValues) {
    credentialFormMode = "create";
    editingCredentialId = null;
    newCredentialUsernameInput.value = "";
    newCredentialPasswordInput.value = "";
    currentPageContext = emptyPageContext();
  }
}

function onCredentialSelectionChange() {
  renderSelectedCredentialDetails();
}

function renderSelectedCredentialDetails() {
  const selectedCredential = getSelectedCredential();
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

function getSelectedCredential() {
  const selectedCredentialId = getSelectedCredentialId();
  if (!selectedCredentialId) return null;
  return listedCredentials.find((credential) => credential.id === selectedCredentialId) || null;
}

function hideCredentialDetails() {
  credentialDetailsEl.classList.add("hidden");
  selectedUsernameInput.value = "";
  selectedPasswordInput.value = "";
  selectedPasswordInput.classList.add("masked");
  togglePasswordButton.textContent = "Show";
  editCredentialButton.disabled = true;
}

async function onCopyUsername() {
  await copyToClipboard(selectedUsernameInput.value, "Username copied");
}

async function onCredentialSearchSubmit(event) {
  event.preventDefault();

  const query = credentialSearchInputEl.value.trim();
  if (!query) {
    await loadCredentialOptions();
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "SEARCH_CREDENTIALS",
    query
  });

  if (!response?.ok) {
    if (response?.code === "auth_required") {
      await refreshAuthState();
      hideCredentialSelection();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    hideCredentialSelection();
    setStatus(response?.error || "Failed to search credentials", true);
    return;
  }

  const credentials = Array.isArray(response.credentials) ? response.credentials : [];
  if (!credentials.length) {
    hideCredentialSelection();
    setStatus("No credentials match this search");
    return;
  }

  showCredentialSelection(credentials);
  setStatus(`Found ${credentials.length} matching credential${credentials.length === 1 ? "" : "s"}`);
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

async function extractCurrentPageContext() {
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "EXTRACT_CREDENTIAL" });
    if (response?.ok && response.credential) {
      return {
        ...emptyPageContext(),
        ...response.credential
      };
    }
  } catch {
    // Keep manual entry available even when the content script cannot inspect the page.
  }

  return {
    ...emptyPageContext(),
    origin: siteEl.textContent === "No active site" ? "" : siteEl.textContent
  };
}

function emptyPageContext() {
  return {
    origin: "",
    url: "",
    frameUrl: "",
    title: "",
    domain: "",
    username: "",
    password: ""
  };
}
