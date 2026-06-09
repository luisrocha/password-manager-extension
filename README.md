# Password Manager Browser Extension

Browser extension for the
[Password Manager web app](https://github.com/luisrocha/password-manager). It
connects to your self-hosted vault, unlocks locally with your master password,
and helps search, fill, add, edit, and delete credentials from the browser.

## Features
- Connects to the web app without requiring to manually import a vault backup file
- Unlocks the connected vault locally with your master password
- Supports the web app's TOTP unlock challenge, including remembered clients
- Lists credentials for the current page
- Auto-fill username and password fields from the selected credential
- Allows to add, edit and delete credentials

## Requirements
- A running Password Manager web app from
  [luisrocha/password-manager](https://github.com/luisrocha/password-manager)
- A Chromium-compatible browser with Manifest V3 extension support
- Node.js 18+ for the Native Messaging host
- Linux for the included Native Messaging install script

## Browser Compatibility
Currently targeted and manually tested against:

- Brave
- Chromium

Expected to work, but not yet fully verified:

- Google Chrome
- Microsoft Edge

Not currently supported:

- Firefox, because it uses a different extension and native messaging model
- Safari, because it uses a different extension platform

## Repository Layout
- `extension/`: unpacked browser extension source
- `native-host/`: Node.js Native Messaging host used by the extension

## Setup

### 1. Run The Web App

Set up and start the web app first. The extension expects the web app API to be
reachable from the native host.

For the Docker production-style web app, the default API URL is:

```bash
https://vault.localhost
```

For a local Rails development server, use:

```bash
http://127.0.0.1:3000
```

### 2. Configure The Native Host

Create the native-host environment file:

```bash
cd native-host
cp host.env.example host.env
```

Edit `native-host/host.env` and set:

- `PASSWORD_MANAGER_API_URL`
- `PASSWORD_MANAGER_API_TOKEN`
- `PASSWORD_MANAGER_TIMEOUT_MS`, optional

`PASSWORD_MANAGER_API_TOKEN` should be the raw browser API token. The web app
stores and verifies the SHA-256 hash of that token.

### 3. Load The Extension

1. Open your browser extension page, for example `brave://extensions` or
   `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Copy the extension ID shown by the browser.

### 4. Register The Native Host

From `native-host/`, install the native messaging manifest for the same browser
where you loaded the extension.

Brave:

```bash
EXTENSION_ID=your_real_extension_id ./install-native-host.sh
```

Chromium:

```bash
BROWSER=chromium EXTENSION_ID=your_real_extension_id ./install-native-host.sh
```

Google Chrome:

```bash
BROWSER=chrome EXTENSION_ID=your_real_extension_id ./install-native-host.sh
```

For another Chromium-based browser, pass its Native Messaging hosts directory:

```bash
TARGET_DIR=/path/to/NativeMessagingHosts EXTENSION_ID=your_real_extension_id ./install-native-host.sh
```

Restart or reload the browser after installing the native host.

### 5. Connect The Extension To The Vault

1. Open the extension popup.
2. Click **Open web app**.
3. Unlock the web app.
4. Click **Connect Extension** in the web app.
5. Return to the extension popup and unlock with your master password.

If TOTP is enabled in the web app, the extension will ask for a TOTP code or
recovery code after the local unlock step.

## Usage

- Use the popup to search credentials for the current page.
- Select a credential and click **Fill credentials**.
- Use **Add new credential** to save a new login for the current site.
- Use **Edit** to update or delete the selected credential.
- Use **Autofill on page load** only for sites where you are comfortable with
  automatic filling.

## Troubleshooting

### "Specified native messaging host not found"

Install the native host for the same browser that loaded the extension, then
restart or reload the browser. For Chromium, use:

```bash
cd native-host
BROWSER=chromium EXTENSION_ID=your_chromium_extension_id ./install-native-host.sh
```

### "Unlock required"

The browser session token may have expired. Open the extension popup and unlock
again with your master password.

### HTTPS certificate errors

If the web app runs at `https://vault.localhost`, make sure the local Caddy
certificate authority from the web app setup is trusted by your system/browser.

## Tests

Extension tests:

```bash
cd extension
npm test
```

Native host tests:

```bash
cd native-host
npm test
```

## License

MIT License. See [LICENCE](LICENCE).
