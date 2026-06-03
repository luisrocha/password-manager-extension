const formEl = document.getElementById("vault-import-form");
const fileInput = document.getElementById("vault-backup-file");
const statusEl = document.getElementById("status");

formEl.addEventListener("submit", onImportBackup);

async function onImportBackup(event) {
  event.preventDefault();
  clearStatus();

  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("Choose a vault backup file first.", true);
    return;
  }

  try {
    const serializedBackup = await file.text();
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_VAULT_BACKUP",
      serializedBackup
    });

    if (!response?.ok) {
      setStatus(response?.error || "Backup import failed.", true);
      return;
    }

    fileInput.value = "";
    setStatus("Backup imported. Reopen the extension popup and enter your master password.");
  } catch {
    setStatus("Backup import failed.", true);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.classList.remove("error");
}
