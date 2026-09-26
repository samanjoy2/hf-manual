# HF Access Desk

A private Windows desktop app for reviewing and managing access requests across all of your gated Hugging Face datasets.

## Features

- Native Electron window—no localhost server or browser tab.
- First-launch token setup with live Hugging Face validation.
- Token encryption through Electron `safeStorage` and Windows DPAPI.
- Automatic discovery of gated datasets in your personal and writable organization namespaces.
- Combined pending, accepted, and rejected request views.
- Search, dataset filters, bulk approval/rejection, and CSV export.
- Revoke, reset, or return existing decisions to pending.

## Install and run

Install the Electron dependency once:

```powershell
npm install
```

Then launch the app with either:

```powershell
npm start
```

or double-click **HF Access Desk** on the Windows desktop.

## Download the Windows installer

Download `HF-Access-Desk-Setup-1.0.0.exe` from the repository's **Releases** page. Run the installer, choose an installation folder, and use the desktop or Start Menu shortcut it creates.

The initial community build is not code-signed, so Windows SmartScreen may show an **Unknown publisher** warning. The installer hash is published in the release notes for verification.

## First launch

The app asks you to paste a Hugging Face user access token. The token needs permission to:

- view access requests for gated repositories;
- write to every dataset whose requests you want to manage.

The app validates the token before saving it. On Windows, Electron encrypts it with DPAPI through `safeStorage`, meaning it is tied to your Windows sign-in. The encrypted value is stored in Electron's per-user application-data directory—not in this repository.

Use **Change token** at the bottom-left of the app to replace or forget the saved credential.

## Security design

- The renderer has Node.js integration disabled.
- Context isolation and Chromium renderer sandboxing are enabled.
- The preload bridge exposes only six narrow app functions, never raw Electron IPC.
- The renderer cannot make network requests; Hugging Face calls run in the main process.
- Navigation, new windows, and browser permissions are denied by default.
- External links are restricted to Hugging Face dataset pages and token settings.
- The token is never returned to the renderer after it is saved.

## Development

```powershell
npm run check
npm run dev
```

Create a Windows installer locally with:

```powershell
npm run dist:win
```

Main-process code is in `electron/main.cjs`, the isolated bridge is in `electron/preload.cjs`, and the interface is in `public/`.
