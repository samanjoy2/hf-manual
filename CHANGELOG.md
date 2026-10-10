# Changelog

## 1.3.0 — 2026-10-10

- Redesigned the interface with a neutral desktop palette, system typography, compact summary counts, and consistent controls.
- Grouped access-request navigation, audit history, and settings in the sidebar.
- Improved request-table hierarchy with dataset names and namespaces, status icons, clearer decisions, and explicit details buttons.
- Added pagination with 10, 25, 50, or 100 rows per page and selections preserved across pages. CSV export still includes all filtered requests.
- Added approve/reject controls to the request-details drawer, a fixed decision footer, and readable form labels.
- Added Ctrl+K to search and Ctrl+B to toggle the sidebar, reduced-motion support, and accurate empty states.
- Added browser interaction checks for navigation, filtering, pagination, selection, exports, dialogs, and responsive layouts.
- Updated every README screenshot using fictional data.

## 1.2.0 — 2026-10-07

- Added automatic request refresh with configurable 1-, 5-, 15-, or 30-minute intervals.
- Added Windows notifications for newly detected pending requests, with an encrypted baseline to avoid duplicate alerts.
- Added automatic GitHub update checks, download progress, checksum verification, and an install-and-restart action.
- Added Settings & updates, available from both the dashboard and token setup.
- Replaced sidebar dots with distinct clock, checkmark, cross, and list icons, plus hover labels.
- Preserved the selected dataset filter during refresh and prevented multiple app instances from polling simultaneously.

## 1.1.0 — 2026-10-06

- Added a request-details drawer with submitted form answers and direct dataset, profile, and email links.
- Added requester history across every connected gated dataset.
- Added sorting by date, requester, dataset, or status, plus requested-date filters and one-click filter reset.
- Added an encrypted local audit log for successful access decisions with CSV and JSON exports.
- Added privacy-safe README screenshots for the request-details and audit-log workflows.

## 1.0.2 — 2026-10-06

- Made requester handles open their Hugging Face profiles in the default browser.
- Made requester email addresses open a Google search in the default browser.
- Added strict external-link validation for Hugging Face profiles, datasets, token settings, and Google email searches.
- Added a collapsible desktop sidebar that remembers the user's preference.
- Documented that the Windows installer supports both clean installation and in-place upgrades while preserving app data.

## 1.0.1 — 2026-09-26

- Added the custom dataset-shield application icon throughout the desktop interface and Windows build.
- Rebuilt the project README with release links, screenshots, security details, and source-build instructions.
- Added reproducible, privacy-safe screenshots generated entirely from fictional demo data.
- Replaced repository-dependent badges so release links render reliably for private repositories.

## 1.0.0 — 2026-09-26

First public Windows release of HF Access Desk.

- Review pending, accepted, and rejected requests across gated Hugging Face datasets.
- Approve, reject, reset, revoke, or return requests to pending.
- Bulk actions, search, dataset filtering, and CSV export.
- First-launch Hugging Face token setup with Windows DPAPI-backed encryption.
- Automatic discovery of personal and writable organization namespaces.
- Sandboxed Electron renderer with restricted IPC and external navigation.
- Assisted Windows installer with Desktop and Start Menu shortcuts.
