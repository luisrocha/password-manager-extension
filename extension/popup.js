const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const unlockFormEl = document.getElementById("locked-section");
const lockedSectionEl = unlockFormEl;
const unlockedSectionEl = document.getElementById("unlocked-section");
const vaultConnectSectionEl = document.getElementById("vault-connect-section");
const openWebAppButton = document.getElementById("open-web-app");
const masterPasswordInput = document.getElementById("master-password");
const masterPasswordLabelEl = masterPasswordInput.closest("label");
const authActionsEl = document.querySelector(".auth-actions");
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
const newCredentialNameInput = document.getElementById("new-credential-name");
const newCredentialUsernameInput = document.getElementById("new-credential-username");
const newCredentialPasswordInput = document.getElementById("new-credential-password");
const toggleNewCredentialPasswordButton = document.getElementById("toggle-new-credential-password");
const openPasswordGeneratorButton = document.getElementById("open-password-generator");
const passwordGeneratorPopupEl = document.getElementById("password-generator-popup");
const passwordLengthInput = document.getElementById("password-length");
const passwordLengthValueEl = document.getElementById("password-length-value");
const passwordIncludeNumbersInput = document.getElementById("password-include-numbers");
const passwordIncludeSymbolsInput = document.getElementById("password-include-symbols");
const generatePasswordButton = document.getElementById("generate-password");
const cancelNewCredentialButton = document.getElementById("cancel-new-credential");
const deleteCredentialButton = document.getElementById("delete-credential");
const deleteWarningEl = document.getElementById("delete-warning");
const autofillOnLoadInput = document.getElementById("autofill-on-load");
const allowHttpInput = document.getElementById("allow-http");

const DEFAULT_GENERATED_PASSWORD_LENGTH = 20;
const MIN_GENERATED_PASSWORD_LENGTH = 8;
const MAX_GENERATED_PASSWORD_LENGTH = 100;
const PASSWORD_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PASSWORD_NUMBERS = "0123456789";
const PASSWORD_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?";
const ICONS = {
  copy: "icons/copy.svg",
  generate: "icons/sparkles.svg",
  hide: "icons/eye-off.svg",
  show: "icons/eye.svg"
};

let activeTabId = null;
let listedCredentials = [];
let currentPageContext = emptyPageContext();
let credentialFormMode = "create";
let editingCredentialId = null;
let deleteConfirmationPending = false;
let activeSiteOrigin = "";
let activeSiteHiddenForInternalPage = false;

init().catch((error) => setStatus(error.message, true));

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = activeTab?.id;
  renderActiveSite(activeTab?.url);

  const settingsResp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (settingsResp?.ok) {
    autofillOnLoadInput.checked = Boolean(settingsResp.settings.autofillOnPageLoad);
    allowHttpInput.checked = Boolean(settingsResp.settings.allowHttp);
  }

  setIconButton(openPasswordGeneratorButton, "generate", "Generate password");
  setIconButton(copyUsernameButton, "copy", "Copy username");
  setIconButton(copyPasswordButton, "copy", "Copy password");
  setPasswordVisibilityButton(togglePasswordButton, false);
  setPasswordVisibilityButton(toggleNewCredentialPasswordButton, false);

  autofillOnLoadInput.addEventListener("change", saveSettings);
  allowHttpInput.addEventListener("change", saveSettings);
  fillNowButton.addEventListener("click", onFillNow);
  editCredentialButton.addEventListener("click", onEditCredential);
  addNewCredentialButton.addEventListener("click", onAddNewCredential);
  newCredentialFormEl.addEventListener("submit", onNewCredentialSubmit);
  toggleNewCredentialPasswordButton.addEventListener("click", onToggleNewCredentialPasswordVisibility);
  openPasswordGeneratorButton.addEventListener("click", onOpenPasswordGenerator);
  passwordLengthInput.addEventListener("input", onPasswordLengthChange);
  generatePasswordButton.addEventListener("click", onGeneratePassword);
  cancelNewCredentialButton.addEventListener("click", onCancelNewCredential);
  deleteCredentialButton.addEventListener("click", onDeleteCredential);
  openWebAppButton.addEventListener("click", onOpenWebApp);
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
  if (!selectedCredentialId) {
    setStatus("Select an account first.", true);
    return;
  }

  const selectedCredentialResponse = await ensureCredentialDetail(selectedCredentialId);
  if (!selectedCredentialResponse.ok) {
    if (selectedCredentialResponse.code === "auth_required") {
      await refreshAuthState();
      hideCredentialSelection();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    setStatus(selectedCredentialResponse.error || "Failed to load credential", true);
    return;
  }
  const selectedCredential = selectedCredentialResponse.credential;

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

async function onOpenWebApp() {
  const response = await chrome.runtime.sendMessage({ type: "GET_API_CONFIG" });
  if (!response?.ok || !response.apiUrl) {
    setStatus(response?.error || "Could not read web app URL from the native host.", true);
    return;
  }

  const url = new URL(response.apiUrl);
  url.searchParams.set("extension_id", chrome.runtime.id);

  await chrome.tabs.create({ url: url.toString() });
}

async function onAddNewCredential() {
  if (!activeTabId) {
    setStatus("No active tab found", true);
    return;
  }

  currentPageContext = await extractCurrentPageContext();
  credentialFormMode = "create";
  editingCredentialId = null;
  newCredentialNameInput.value = deriveDefaultCredentialName(currentPageContext);
  newCredentialUsernameInput.value = currentPageContext.username || "";
  newCredentialPasswordInput.value = currentPageContext.password || "";
  showNewCredentialForm("Add new credential");
  setStatus("Add the username and password, then click Save.");
}

async function onNewCredentialSubmit(event) {
  event.preventDefault();

  const name = newCredentialNameInput.value.trim();
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
        name,
        username,
        password
      }
    })
    : await chrome.runtime.sendMessage({
      type: "SAVE_CREDENTIAL",
      payload: {
        ...currentPageContext,
        name,
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
  setStatus("");
}

function onEditCredential() {
  void openSelectedCredentialForEdit();
}

async function onDeleteCredential() {
  if (credentialFormMode !== "edit" || !editingCredentialId) {
    setStatus("No credential selected for deletion", true);
    return;
  }

  if (!deleteConfirmationPending) {
    deleteConfirmationPending = true;
    deleteCredentialButton.textContent = "Confirm delete";
    deleteCredentialButton.classList.add("confirming");
    deleteWarningEl.classList.remove("hidden");
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
  const hasVault = Boolean(response?.ok && response?.auth?.hasVault);
  const needsConnection = !unlocked && !hasVault;

  lockedSectionEl.classList.toggle("hidden", unlocked);
  unlockedSectionEl.classList.toggle("hidden", !unlocked);
  vaultConnectSectionEl.classList.toggle("hidden", !needsConnection);
  masterPasswordLabelEl.classList.toggle("hidden", !hasVault);
  authActionsEl.classList.toggle("hidden", !hasVault);
  siteEl.classList.toggle("hidden", needsConnection || activeSiteHiddenForInternalPage);

  if (!unlocked) {
    hideCredentialSelection();
    hideNewCredentialForm({ clearValues: true });
    setCredentialActionState(false);
    if (hasVault) masterPasswordInput.focus();
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
  void renderSelectedCredentialDetails();
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
  resetDeleteConfirmationState();
  resetNewCredentialPasswordVisibility();
  resetPasswordGeneratorOptions();
  hidePasswordGenerator();
  newCredentialNameInput.focus();
}

function hideNewCredentialForm(options = {}) {
  credentialsBrowserViewEl.classList.remove("hidden");
  newCredentialFormEl.classList.add("hidden");
  deleteCredentialButton.classList.add("hidden");
  resetDeleteConfirmationState();
  resetNewCredentialPasswordVisibility();
  hidePasswordGenerator();

  if (options.clearValues) {
    credentialFormMode = "create";
    editingCredentialId = null;
    newCredentialNameInput.value = "";
    newCredentialUsernameInput.value = "";
    newCredentialPasswordInput.value = "";
    currentPageContext = emptyPageContext();
  }
}

function onCredentialSelectionChange() {
  void renderSelectedCredentialDetails();
}

async function renderSelectedCredentialDetails() {
  const selectedCredential = getSelectedCredential();
  if (!selectedCredential) {
    hideCredentialDetails();
    return;
  }

  const detailResponse = await ensureCredentialDetail(selectedCredential.id);
  if (!detailResponse.ok) {
    if (detailResponse.code === "auth_required") {
      await refreshAuthState();
      hideCredentialSelection();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    hideCredentialDetails();
    setStatus(detailResponse.error || "Failed to load credential", true);
    return;
  }

  const detailedCredential = detailResponse.credential;
  selectedUsernameInput.value = detailedCredential.username || "";
  selectedPasswordInput.value = detailedCredential.password || "";
  selectedPasswordInput.classList.add("masked");
  setPasswordVisibilityButton(togglePasswordButton, false);
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

async function ensureCredentialDetail(credentialId) {
  const credential = listedCredentials.find((item) => item.id === credentialId);
  if (!credential) {
    return { ok: false, error: "Credential not found" };
  }

  if (credential.password) {
    return { ok: true, credential };
  }

  const response = await chrome.runtime.sendMessage({
    type: "GET_CREDENTIAL_DETAIL",
    credentialId
  });
  if (!response?.ok || !response.credential) {
    return {
      ok: false,
      code: response?.code,
      error: response?.error || "Failed to load credential"
    };
  }

  const index = listedCredentials.findIndex((item) => item.id === credentialId);
  if (index >= 0) {
    listedCredentials[index] = {
      ...listedCredentials[index],
      displayName: response.credential.displayName || listedCredentials[index].displayName || "",
      username: response.credential.username || "",
      password: response.credential.password || ""
    };
  }

  return { ok: true, credential: listedCredentials[index] };
}

function resetDeleteConfirmationState() {
  deleteConfirmationPending = false;
  deleteCredentialButton.textContent = "Delete";
  deleteCredentialButton.classList.remove("confirming");
  deleteWarningEl.classList.add("hidden");
}

function hideCredentialDetails() {
  credentialDetailsEl.classList.add("hidden");
  selectedUsernameInput.value = "";
  selectedPasswordInput.value = "";
  selectedPasswordInput.classList.add("masked");
  setPasswordVisibilityButton(togglePasswordButton, false);
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
  setPasswordVisibilityButton(togglePasswordButton, isHidden);
}

function onToggleNewCredentialPasswordVisibility() {
  const isHidden = newCredentialPasswordInput.type === "password";
  newCredentialPasswordInput.type = isHidden ? "text" : "password";
  setPasswordVisibilityButton(toggleNewCredentialPasswordButton, isHidden);
}

function resetNewCredentialPasswordVisibility() {
  newCredentialPasswordInput.type = "password";
  setPasswordVisibilityButton(toggleNewCredentialPasswordButton, false);
}

function setPasswordVisibilityButton(button, isVisible) {
  setIconButton(button, isVisible ? "hide" : "show", isVisible ? "Hide password" : "Show password");
}

function setIconButton(button, icon, label) {
  button.style.setProperty("--icon-url", `url("${ICONS[icon]}")`);
  button.setAttribute("aria-label", label);
  button.title = label;
}

function renderActiveSite(url) {
  activeSiteOrigin = "";
  activeSiteHiddenForInternalPage = false;

  if (!url) {
    siteEl.textContent = "No active site";
    siteEl.classList.remove("hidden");
    return;
  }

  const origin = new URL(url).origin;
  if (origin === chrome.runtime.getURL("").slice(0, -1)) {
    activeSiteHiddenForInternalPage = true;
    siteEl.classList.add("hidden");
    return;
  }

  activeSiteOrigin = origin;
  siteEl.textContent = origin;
  siteEl.classList.remove("hidden");
}

function onOpenPasswordGenerator() {
  const willShow = passwordGeneratorPopupEl.classList.contains("hidden");
  passwordGeneratorPopupEl.classList.toggle("hidden", !willShow);
  openPasswordGeneratorButton.setAttribute("aria-expanded", String(willShow));

  if (willShow) {
    passwordLengthInput.focus();
  }
}

function hidePasswordGenerator() {
  passwordGeneratorPopupEl.classList.add("hidden");
  openPasswordGeneratorButton.setAttribute("aria-expanded", "false");
}

function resetPasswordGeneratorOptions() {
  passwordLengthInput.value = String(DEFAULT_GENERATED_PASSWORD_LENGTH);
  updatePasswordLengthValue();
  passwordIncludeNumbersInput.checked = true;
  passwordIncludeSymbolsInput.checked = false;
}

function onPasswordLengthChange() {
  updatePasswordLengthValue();
}

function updatePasswordLengthValue() {
  passwordLengthValueEl.textContent = String(normalizedGeneratedPasswordLength(passwordLengthInput.value));
}

function onGeneratePassword() {
  const length = normalizedGeneratedPasswordLength(passwordLengthInput.value);
  passwordLengthInput.value = String(length);
  updatePasswordLengthValue();
  newCredentialPasswordInput.value = generatePassword({
    length,
    includeNumbers: passwordIncludeNumbersInput.checked,
    includeSymbols: passwordIncludeSymbolsInput.checked
  });
  hidePasswordGenerator();
  newCredentialPasswordInput.focus();
  setStatus("Generated password");
}

function normalizedGeneratedPasswordLength(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_GENERATED_PASSWORD_LENGTH;
  return Math.min(Math.max(parsed, MIN_GENERATED_PASSWORD_LENGTH), MAX_GENERATED_PASSWORD_LENGTH);
}

function generatePassword(options) {
  const requiredSets = [PASSWORD_LETTERS];
  if (options.includeNumbers) requiredSets.push(PASSWORD_NUMBERS);
  if (options.includeSymbols) requiredSets.push(PASSWORD_SYMBOLS);

  const pool = requiredSets.join("");
  const characters = requiredSets.map((set) => randomCharacter(set));

  while (characters.length < options.length) {
    characters.push(randomCharacter(pool));
  }

  return shuffleCharacters(characters).join("");
}

function randomCharacter(characters) {
  return characters[randomInt(characters.length)];
}

function shuffleCharacters(characters) {
  const shuffled = [...characters];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomInt(maxExclusive) {
  const randomValues = new Uint32Array(1);
  const maxUnbiasedValue = Math.floor(0x100000000 / maxExclusive) * maxExclusive;

  do {
    crypto.getRandomValues(randomValues);
  } while (randomValues[0] >= maxUnbiasedValue);

  return randomValues[0] % maxExclusive;
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
    origin: activeSiteOrigin
  };
}

async function openSelectedCredentialForEdit() {
  const selectedCredentialId = getSelectedCredentialId();
  if (!selectedCredentialId) {
    setStatus("Select an account first.", true);
    return;
  }

  const detailResponse = await ensureCredentialDetail(selectedCredentialId);
  if (!detailResponse.ok) {
    if (detailResponse.code === "auth_required") {
      await refreshAuthState();
      hideCredentialSelection();
      setStatus("Unlock required. Enter master password.", true);
      masterPasswordInput.focus();
      return;
    }

    setStatus(detailResponse.error || "Failed to load credential", true);
    return;
  }

  const selectedCredential = detailResponse.credential;
  credentialFormMode = "edit";
  editingCredentialId = selectedCredential.id;
  newCredentialNameInput.value = selectedCredential.displayName || "";
  newCredentialUsernameInput.value = selectedCredential.username || "";
  newCredentialPasswordInput.value = selectedCredential.password || "";
  showNewCredentialForm("Edit credential");
  setStatus("Update the name, username, or password, then click Save.");
}

function deriveDefaultCredentialName(context) {
  const hostname = context.domain || hostnameFromOrigin(context.origin);
  if (!hostname) return "Website Login";

  const siteName = siteNameFromHostname(hostname);
  return siteName || hostname;
}

function hostnameFromOrigin(origin) {
  if (!origin) return "";

  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

function siteNameFromHostname(hostname) {
  const normalized = hostname.replace(/^www\./i, "").toLowerCase();
  const parts = normalized.split(".").filter(Boolean);
  if (!parts.length) return "";

  let candidate = parts[0];
  if (parts.length >= 2) candidate = parts[parts.length - 2];
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) {
    candidate = parts[parts.length - 3];
  }

  return candidate
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
