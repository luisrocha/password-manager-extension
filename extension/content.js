const AUTOFILLED_FLAG = "data-pm-autofilled";

window.addEventListener("load", maybeAutofillOnLoad, { once: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FILL_REQUESTED") {
    fillCredentials().then(sendResponse);
    return true;
  }

  if (message?.type === "PING") {
    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: false, error: "Unknown content message" });
});

async function maybeAutofillOnLoad() {
  const settingsResp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!settingsResp?.ok) return;

  const { autofillOnPageLoad, allowHttp } = settingsResp.settings;
  if (!autofillOnPageLoad) return;

  if (!allowHttp && location.protocol !== "https:") return;
  await fillCredentials({ silentNoMatch: true });
}

async function fillCredentials(options = {}) {
  const detection = detectLoginTargets();
  if (detection.state === "already_autofilled") {
    return {
      ok: true,
      skipped: true,
      reason: "already_autofilled",
      message: "Credentials already autofilled"
    };
  }

  if (detection.state === "no_valid_login_fields") {
    return { ok: false, error: "No valid login fields found" };
  }
  const formTargets = detection.targets;

  const response = await chrome.runtime.sendMessage({
    type: "GET_CREDENTIALS",
    payload: {
      origin: location.origin,
      url: location.href,
      title: document.title,
      frameUrl: window.location.href
    }
  });

  if (!response?.ok) {
    return {
      ok: false,
      code: response?.code,
      error: response?.error || "Could not fetch credentials"
    };
  }

  if (!response.credentials.length) {
    if (options.silentNoMatch) return { ok: true, skipped: true };
    return { ok: false, error: "No credentials found for this site" };
  }

  const credential = response.credentials[0];
  applyCredential(formTargets, credential);
  return {
    ok: true,
    account: credential.displayName || credential.username || "Account"
  };
}

function detectLoginTargets() {
  const passwordCandidates = Array.from(document.querySelectorAll('input[type="password"]'))
    .filter((input) => isFieldUsable(input));
  if (!passwordCandidates.length) {
    return { state: "no_valid_login_fields" };
  }

  const passwordField = passwordCandidates.find((input) => input.getAttribute(AUTOFILLED_FLAG) !== "true");
  if (!passwordField) {
    return { state: "already_autofilled" };
  }

  let usernameField = null;
  const form = passwordField.form;

  if (form) {
    const formCandidates = Array.from(form.querySelectorAll('input[type="email"], input[name*="user" i], input[name*="email" i], input[autocomplete="username"]'));
    usernameField = formCandidates.find((input) => isFieldUsable(input));
  }

  if (!usernameField) {
    const candidates = Array.from(document.querySelectorAll('input[type="text"], input[type="email"]'));
    usernameField = candidates.find((input) => isFieldUsable(input));
  }

  return { state: "ready", targets: { usernameField, passwordField } };
}

function applyCredential(targets, credential) {
  const { usernameField, passwordField } = targets;
  const username = credential.username || "";
  const password = credential.password || "";

  if (usernameField && username) {
    setInputValue(usernameField, username);
    usernameField.setAttribute(AUTOFILLED_FLAG, "true");
  }

  if (passwordField && password) {
    setInputValue(passwordField, password);
    passwordField.setAttribute(AUTOFILLED_FLAG, "true");
  }
}

function setInputValue(input, value) {
  input.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isFieldVisible(field) {
  const style = window.getComputedStyle(field);
  return style.display !== "none" && style.visibility !== "hidden" && field.offsetParent !== null;
}

function isFieldUsable(field) {
  return isFieldVisible(field) && !field.disabled && !field.readOnly;
}
