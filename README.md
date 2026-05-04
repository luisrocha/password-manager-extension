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
   - `POST /api/browser/credentials`
4. Extension receives credentials and fills username/password fields.
5. The popup can open a dedicated add-credential form, optionally prefilled from the current page, and save it into the password manager.
6. The popup can edit the currently selected credential using the same form, prefilled with the selected username and password.
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

- `PASSWORD_MANAGER_API_URL` (default: `http://127.0.0.1:17325`)
- `PASSWORD_MANAGER_API_TOKEN` (required for unlock endpoint authentication)
- `PASSWORD_MANAGER_TIMEOUT_MS` (default: `3000`)

Use the native-host env file:

```bash
cd native-host
cp host.env.example host.env
```

Then edit `native-host/host.env` with your values.

Authentication flow:

1. Open the extension popup.
2. Enter your master password and click **Unlock**.
3. The extension requests an encrypted JWT from `POST /api/browser/auth/unlock` with the static API token and master password.
4. The encrypted JWT is sent as Bearer token on later credentials requests.
5. When the token expires, the extension requires master password again.

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

Unlock request (`POST /api/browser/auth/unlock`):

```json
{
  "masterPassword": "your-master-password"
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

Request body (`POST /api/browser/credentials/search`):

```json
{
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
      "username": "user@example.com",
      "password": "super-secret"
    }
  ]
}
```

If credentials match the current domain, the popup loads them into an account picker so the user can select one before clicking fill.

Request body (`POST /api/browser/credentials`):

```json
{
  "origin": "https://example.com",
  "url": "https://example.com/login",
  "title": "Example Login",
  "frameUrl": "https://example.com/login",
  "domain": "example.com",
  "username": "user@example.com",
  "password": "super-secret"
}
```

Response body:

```json
{
  "credential": {
    "id": "cred_123",
    "displayName": "Example Login",
    "domain": "example.com",
    "username": "user@example.com"
  }
}
```

To save a new login:

1. Open the extension popup.
2. Click **Add new credential**.
3. If the current page already has a filled login form, the popup copies those values into the add form.
4. Review or edit the username and password.
5. Click **Save**.

To edit an existing login:

1. Select a credential in the popup.
2. Click **Edit**.
3. Update the username or password.
4. Click **Save** or **Cancel** to return.
5. Click **Delete credential** to remove the selected credential.
