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
4. Extension receives credentials and fills username/password fields.

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
- `PASSWORD_MANAGER_API_TOKEN` (optional but recommended)
- `PASSWORD_MANAGER_TIMEOUT_MS` (default: `3000`)

Use the native-host env file:

```bash
cd native-host
cp host.env.example host.env
```

Then edit `native-host/host.env` with your values.

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

## UX behavior

- Popup button: fill credentials on current page
- Shortcut: `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS)
- Optional settings:
  - Autofill on page load
  - Allow autofill on HTTP pages (disabled by default)

## Security notes

- Keep autofill restricted to HTTPS unless explicitly needed.
- Do not store API tokens in source code.
- Use a short-lived token for browser integration.
- Consider requiring user unlock or biometric confirmation in your password-manager app before returning passwords.

## Development notes

- Extension entry files:
  - `extension/manifest.json`
  - `extension/background.js`
  - `extension/content.js`
  - `extension/popup.js`
- Native host entry:
  - `native-host/host.js`
