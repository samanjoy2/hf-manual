# HF Access Desk

A small, private dashboard for reviewing access requests across all of your gated Hugging Face datasets. It uses the official Hugging Face Hub access-request API and keeps the Hugging Face token on the server.

## What it does

- Discovers gated datasets under your account and writable organizations.
- Combines pending, accepted, and rejected requests into one dashboard.
- Filters by status or dataset and searches names, usernames, and email addresses.
- Approves, rejects, revokes, resets, or moves requests back to pending.
- Supports bulk approve/reject and CSV export.
- Protects a deployed dashboard with an optional password.
- Runs with Node.js only—there are no npm dependencies to install.

## Run locally

1. Copy `.env.example` to `.env`.
2. Put a Hugging Face user access token with gated-request read and repository write permissions in `HF_TOKEN`.
3. Set a strong `APP_PASSWORD` if anyone else can reach the server.
4. Start the app:

   ```sh
   node server.mjs
   ```

5. Open [http://localhost:7860](http://localhost:7860).

The `.env` file is ignored by Git. Do not put your token in the source files or commit it.

## Dataset discovery

The dashboard calls `whoami-v2`, searches for gated datasets under your personal namespace and organizations where you have a writable role, then queries each dataset's access-request endpoints.

If a private or resource-group dataset is not discovered automatically, add it explicitly:

```dotenv
HF_DATASETS=your-name/dataset-one,your-org/dataset-two
```

The token must have write access to every repository whose requests you want to change. API failures on individual datasets are shown as a warning without hiding requests from other datasets.

## Deploy as a Hugging Face Docker Space

1. Create a new **Docker** Space. A private Space is strongly recommended because access requests contain personal information.
2. Upload this repository.
3. In the Space settings, add `HF_TOKEN` as a **Secret**—not a variable.
4. Add `APP_PASSWORD` as another Secret if the Space is reachable by anyone else.
5. Optionally add `HF_DATASETS` as a variable with comma-separated dataset IDs.

The included `Dockerfile` listens on port `7860`, which is the default port for Docker Spaces.

## Security notes

- `HF_TOKEN` is never sent to the browser.
- `APP_PASSWORD` creates an HTTP-only, same-site session cookie and is rate-limited on repeated failures.
- For public deployments, HTTPS is required for the production session cookie.
- Prefer a narrowly scoped Hugging Face token. Rotate any token that was shared in chat, logs, screenshots, or source control.
- Access-request records include personal data such as email addresses. Keep the dashboard private and handle exports accordingly.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HF_TOKEN` | Yes | — | Hugging Face user access token |
| `APP_PASSWORD` | Recommended | No login required | Protects the dashboard |
| `HF_DATASETS` | No | Auto-discovery | Extra comma-separated dataset IDs |
| `PORT` | No | `7860` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address; use `127.0.0.1` for local-only access |
| `HF_ENDPOINT` | No | `https://huggingface.co` | Hub endpoint |
| `CACHE_TTL_SECONDS` | No | `60` | Dashboard cache duration |

## API behavior

Approvals and rejections use:

```text
POST /api/datasets/{repo_id}/user-access-request/handle
```

with the status and username in the JSON body. A batch is processed with limited concurrency, and partial failures are reported rather than silently discarded.
