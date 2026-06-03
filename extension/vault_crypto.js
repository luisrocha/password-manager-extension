import argon2 from "./argon2_bridge.js";
import * as openpgp from "./vendor/openpgp.min.js";
import { createVaultCrypto } from "./vendor/password_manager_vault_crypto.js";

const STORAGE_KEY = "passwordManager.encryptedVault";

const storage = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result?.[key] || null;
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  }
};

const vaultCrypto = createVaultCrypto({
  openpgp,
  argon2,
  storage,
  storageKey: STORAGE_KEY
});

export const hasStoredVault = vaultCrypto.hasStoredVault;
export const isVaultUnlocked = vaultCrypto.isVaultUnlocked;
export const importVaultBackup = vaultCrypto.importVaultBackup;
export const unlockVault = vaultCrypto.unlockVault;
export const lockVault = vaultCrypto.lockVault;
export const buildUnlockProof = vaultCrypto.buildUnlockProof;
export const decryptText = vaultCrypto.decryptText;
export const encryptText = vaultCrypto.encryptText;
