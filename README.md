# Password Manager Browser Extension

> 🚧 **Work in progress:** This project is actively being built and is not production-ready yet. 🚧

A Chromium MV3 extension + Native Messaging bridge that requests credentials from your local password-manager app and autofills login forms.

## What this includes

- `extension/`: browser extension (Manifest V3)
- `native-host/`: Native Messaging host (Node.js) that proxies requests to your app

## Architecture

1. Content script detects login fields and requests credentials.
2. Background service worker sends a Native Messaging request to `com.password_manager`.
3. Native host calls your password-manager API endpoint:
   - `POST /api/browser/credentials/search`
   - `GET /api/browser/credentials/:id`
   - `POST /api/browser/credentials`
   - `PATCH /api/browser/credentials/:id`
   - `DELETE /api/browser/credentials/:id`
4. Extension receives credentials and fills username/password fields.
5. The popup can open a dedicated add-credential form, optionally prefilled from the current page, and save it into the password manager.
6. The popup can edit the currently selected credential using the same form, prefilled with the selected name, username, and password.
7. The edit form can also delete the selected credential and then refresh the current site credential list.

## Prerequisites

- Chromium-based browser
- Node.js 18+
- Running password-manager app with local API access

## Compatibility (not yet confirmed)
- Google Chrome (?)
- Firefox (?)
- Microsoft Edge (?)
- Brave (?)

## 1) Load the extension in Brave

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/`
4. Copy the extension ID shown by Brave

## 2) Configure native host bridge

The native host expects environment variables:

- `PASSWORD_MANAGER_API_URL` (default: `https://vault.localhost`; use `http://127.0.0.1:3000` for a local Rails development server)
- `PASSWORD_MANAGER_API_TOKEN` (required for unlock endpoint authentication)
- `PASSWORD_MANAGER_TIMEOUT_MS` (default: `3000`)

Use the native-host env file:

```bash
cd native-host
cp host.env.example host.env
```

Then edit `native-host/host.env` with your values.

For the Docker production-style web app, use:

```bash
PASSWORD_MANAGER_API_URL=https://vault.localhost
```

For a local Rails development server, use:

```bash
PASSWORD_MANAGER_API_URL=http://127.0.0.1:3000
```

Authentication flow:

1. Open the extension popup.
2. Enter your master password and click **Unlock**.
3. The extension decrypts the connected vault key locally.
4. The native host requests an unlock challenge from `POST /api/browser/auth/unlock` with the static API token.
5. The extension signs the challenge locally with the connected vault signing key.
6. The native host submits the signed proof.
7. If TOTP is enabled, the popup asks for a TOTP or recovery code and the native host submits that challenge response.
8. The native host receives an encrypted browser JWT.
9. The encrypted JWT is sent as Bearer token on later credentials requests.
10. When the token expires, the extension clears only that browser JWT and requires unlock again.

The native host acts as an HTTP proxy and API-token holder. It does not receive the master password, decrypted vault key material, or plaintext credential fields.

## 3) Register the Native Messaging host (Linux)

From `native-host/`:

```bash
EXTENSION_ID=your_real_extension_id ./install-native-host.sh
```

This creates:

- `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.password_manager.json`

The script injects:

- Absolute path to `native-host/host-launcher.sh`
- Your Brave extension ID in `allowed_origins`

## 4) Start host process environment

Brave launches the host process itself via `native-host/host-launcher.sh`, which loads `native-host/host.env`.

## Password-manager app API contract

Unlock challenge request (`POST /api/browser/auth/unlock`):

```json
{}
```

Signed unlock request (`POST /api/browser/auth/unlock`):

```json
{
  "challengeId": "challenge-id-from-server",
  "unlockSignature": "base64-signature",
  "signingPublicKeySpki": "base64-public-key"
}
```

Unlock response:

```json
{
  "token": "encrypted-jwt",
  "expiresAt": "2026-03-02T12:34:56Z",
  "tokenType": "Bearer"
}
```

TOTP challenge response:

```json
{
  "requiresTotp": true,
  "totpChallengeId": "totp-challenge-id-from-server",
  "expiresAt": "2026-03-02T12:34:56Z"
}
```

TOTP verification request:

```json
{
  "totpChallengeId": "totp-challenge-id-from-server",
  "totpCode": "123456",
  "rememberClient": true
}
```

Request body (`POST /api/browser/credentials/search`):

```json
{
  "name": "Example",
  "origin": "https://example.com",
  "url": "https://example.com/login",
  "title": "Example Login",
  "frameUrl": "https://example.com/login"
}
```

Response body:

```json
{
  "credentials": [
    {
      "id": "cred_123",
      "displayName": "Personal",
      "domain": "example.com",
      "encryptedSecretPayload": "-----BEGIN PGP MESSAGE-----..."
    }
  ]
}
```

If credentials match the current domain, the extension background decrypts `encryptedSecretPayload` locally and the popup loads them into an account picker so the user can select one before clicking fill.

Response body (`GET /api/browser/credentials/:id`):

```json
{
  "credential": {
    "id": "cred_123",
    "displayName": "Personal",
    "domain": "example.com",
    "encryptedSecretPayload": "-----BEGIN PGP MESSAGE-----..."
  }
}
```

The decrypted secret payload shape is:

```json
{
  "username": "user@example.com",
  "password": "secret-value",
  "notes": ""
}
```

Request body (`POST /api/browser/credentials`):

```json
{
  "origin": "https://example.com",
  "url": "https://example.com/login",
  "title": "Example Login",
  "frameUrl": "https://example.com/login",
  "domain": "example.com",
  "encryptedSecretPayload": "-----BEGIN PGP MESSAGE-----..."
}
```

Response body:

```json
{
  "credential": {
    "id": "cred_123",
    "displayName": "Example Login",
    "domain": "example.com",
    "encryptedSecretPayload": "-----BEGIN PGP MESSAGE-----..."
  }
}
```

To save a new login:

1. Open the extension popup.
2. Click **Add new credential**.
3. The popup defaults the credential name from the current site or domain.
4. If the current page already has a filled login form, the popup copies those values into the add form.
5. Review or edit the name, username, and password. Use **Generate** beside the password field to create a new password with configurable length, numbers, and symbols.
6. Click **Save**.

To edit an existing login:

1. Select a credential in the popup.
2. Click **Edit**.
3. Update the name, username, or password. Use **Generate** beside the password field if you want to replace the current password.
4. Click **Save** or **Cancel** to return.
5. Click **Delete credential** to remove the selected credential.
