const BACKUP_VERSION = 1
const DEFAULT_STORAGE_KEY = "passwordManager.encryptedPrivateKey"
const ARGON2_TIME = 2
const ARGON2_MEMORY_KIB = 19456
const ARGON2_PARALLELISM = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const AES_KEY_BYTES = 32
const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

export function createVaultCrypto({ openpgp, argon2, storage, storageKey = DEFAULT_STORAGE_KEY }) {
  if (!openpgp) throw new Error("openpgp_required")
  if (!argon2) throw new Error("argon2_required")
  if (!storage) throw new Error("storage_required")

  let unlockedPrivateKey = null
  let unlockedPublicKey = null
  let unlockedSigningKey = null
  let unlockedSigningPublicKey = null

  async function hasStoredVault() {
    return (await readStoredVault()) !== null
  }

  function isVaultUnlocked() {
    return unlockedPrivateKey !== null && unlockedPublicKey !== null && unlockedSigningKey !== null
  }

  async function generateVault(masterPassword) {
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: "ecc",
      curve: "curve25519",
      userIDs: [{ name: "Password Manager Vault" }]
    })
    const signingKeys = await generateSigningKeys()

    const vault = await buildEncryptedVault(privateKey, publicKey, signingKeys, masterPassword)
    await storeVault(vault)

    unlockedPrivateKey = await openpgp.readPrivateKey({ armoredKey: privateKey })
    unlockedPublicKey = await openpgp.readKey({ armoredKey: publicKey })
    unlockedSigningKey = signingKeys.privateKey
    unlockedSigningPublicKey = signingKeys.publicKeySpki

    return vault
  }

  async function unlockVault(masterPassword) {
    const vault = await readStoredVault()
    if (!vault) throw new Error("vault_missing")

    const privateKey = await decryptPrivateKey(vault, masterPassword)
    unlockedSigningKey = await decryptSigningKey(vault, masterPassword)

    unlockedPrivateKey = await openpgp.readPrivateKey({ armoredKey: privateKey })
    unlockedPublicKey = await openpgp.readKey({ armoredKey: vault.publicKey })
    unlockedSigningPublicKey = vault.signing.publicKeySpki

    return true
  }

  function lockVault() {
    unlockedPrivateKey = null
    unlockedPublicKey = null
    unlockedSigningKey = null
    unlockedSigningPublicKey = null
  }

  async function exportVaultBackup() {
    const vault = await readStoredVault()
    if (!vault) throw new Error("vault_missing")

    return JSON.stringify(vault, null, 2)
  }

  async function importVaultBackup(serializedBackup) {
    const vault = JSON.parse(serializedBackup)
    validateVault(vault)
    await storeVault(vault)

    return vault
  }

  async function encryptText(plaintext) {
    assertUnlocked()

    return openpgp.encrypt({
      message: await openpgp.createMessage({ text: plaintext.toString() }),
      encryptionKeys: unlockedPublicKey
    })
  }

  async function decryptText(ciphertext) {
    assertUnlocked()

    const message = await openpgp.readMessage({ armoredMessage: ciphertext.toString() })
    const { data } = await openpgp.decrypt({
      message,
      decryptionKeys: unlockedPrivateKey,
      format: "utf8"
    })

    return data
  }

  async function buildUnlockProof(challenge) {
    assertUnlocked()

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      unlockedSigningKey,
      TEXT_ENCODER.encode(challenge)
    )

    return {
      signature: encodeBase64(signature),
      signingPublicKeySpki: unlockedSigningPublicKey
    }
  }

  async function readStoredVault() {
    const serializedVault = await storage.get(storageKey)
    if (!serializedVault) return null

    const vault = JSON.parse(serializedVault)
    validateVault(vault)

    return vault
  }

  async function storeVault(vault) {
    validateVault(vault)
    await storage.set(storageKey, JSON.stringify(vault))
  }

  async function buildEncryptedVault(privateKey, publicKey, signingKeys, masterPassword) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const signingIv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const key = await deriveWrappingKey(masterPassword, salt)
    const encryptedPrivateKey = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      TEXT_ENCODER.encode(privateKey)
    )
    const encryptedSigningPrivateKey = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: signingIv },
      key,
      TEXT_ENCODER.encode(signingKeys.privateKeyJwk)
    )

    return {
      version: BACKUP_VERSION,
      publicKey,
      encryptedPrivateKey: encodeBase64(encryptedPrivateKey),
      signing: {
        algorithm: "ECDSA-P256-SHA256",
        publicKeySpki: signingKeys.publicKeySpki,
        encryptedPrivateKey: encodeBase64(encryptedSigningPrivateKey),
        iv: encodeBase64(signingIv)
      },
      kdf: {
        name: "Argon2id",
        version: 19,
        time: ARGON2_TIME,
        memoryKiB: ARGON2_MEMORY_KIB,
        parallelism: ARGON2_PARALLELISM,
        hashLength: AES_KEY_BYTES,
        salt: encodeBase64(salt)
      },
      encryption: {
        name: "AES-GCM",
        iv: encodeBase64(iv)
      }
    }
  }

  async function generateSigningKeys() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      true,
      ["sign", "verify"]
    )
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey)
    const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey)

    return {
      privateKey: keyPair.privateKey,
      privateKeyJwk: JSON.stringify(privateKeyJwk),
      publicKeySpki: encodeBase64(publicKeySpki)
    }
  }

  async function decryptPrivateKey(vault, masterPassword) {
    const key = await deriveWrappingKeyForVault(vault, masterPassword)
    const privateKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(vault.encryption.iv) },
      key,
      decodeBase64(vault.encryptedPrivateKey)
    )

    return TEXT_DECODER.decode(privateKey)
  }

  async function decryptSigningKey(vault, masterPassword) {
    const key = await deriveWrappingKeyForVault(vault, masterPassword)
    const privateKeyJwk = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(vault.signing.iv) },
      key,
      decodeBase64(vault.signing.encryptedPrivateKey)
    )

    return crypto.subtle.importKey(
      "jwk",
      JSON.parse(TEXT_DECODER.decode(privateKeyJwk)),
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["sign"]
    )
  }

  async function deriveWrappingKey(masterPassword, salt) {
    const result = await argon2.hash({
      pass: masterPassword,
      salt,
      time: ARGON2_TIME,
      mem: ARGON2_MEMORY_KIB,
      parallelism: ARGON2_PARALLELISM,
      hashLen: AES_KEY_BYTES,
      type: argon2.ArgonType.Argon2id
    })

    return importAesWrappingKey(result.hash)
  }

  async function deriveWrappingKeyForVault(vault, masterPassword) {
    if (vault.kdf.name !== "Argon2id") throw new Error("vault_unsupported")

    const result = await argon2.hash({
      pass: masterPassword,
      salt: decodeBase64(vault.kdf.salt),
      time: vault.kdf.time,
      mem: vault.kdf.memoryKiB,
      parallelism: vault.kdf.parallelism,
      hashLen: vault.kdf.hashLength,
      type: argon2.ArgonType.Argon2id
    })

    return importAesWrappingKey(result.hash)
  }

  async function importAesWrappingKey(rawKey) {
    return crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    )
  }

  function assertUnlocked() {
    if (!isVaultUnlocked()) throw new Error("vault_locked")
  }

  return {
    hasStoredVault,
    isVaultUnlocked,
    generateVault,
    unlockVault,
    lockVault,
    exportVaultBackup,
    importVaultBackup,
    encryptText,
    decryptText,
    buildUnlockProof
  }
}

export function validateVault(vault) {
  if (vault?.version !== BACKUP_VERSION) throw new Error("vault_unsupported")
  if (!vault.publicKey || !vault.encryptedPrivateKey) throw new Error("vault_invalid")
  if (vault.signing?.algorithm !== "ECDSA-P256-SHA256") throw new Error("vault_invalid")
  if (!vault.signing.publicKeySpki || !vault.signing.encryptedPrivateKey) throw new Error("vault_invalid")
  if (!vault.signing.iv) throw new Error("vault_invalid")
  if (!validKdf(vault.kdf)) throw new Error("vault_invalid")
  if (vault.encryption?.name !== "AES-GCM" || !vault.encryption.iv) throw new Error("vault_invalid")
}

function validKdf(kdf) {
  if (kdf?.name !== "Argon2id") return false

  return kdf.version === 19 &&
    kdf.time > 0 &&
    kdf.memoryKiB >= 8192 &&
    kdf.parallelism > 0 &&
    kdf.hashLength === AES_KEY_BYTES &&
    Boolean(kdf.salt)
}

function encodeBase64(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}
