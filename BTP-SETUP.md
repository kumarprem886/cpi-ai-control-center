# Deploying to SAP BTP from Business Application Studio

The frontend is built into `BackEnd/public`, which the backend serves as static
files. Everything runs as **one** Cloud Foundry app, so there is no CORS setup
and no second route to manage.

## 1. Open the project in Business Application Studio

1. BTP cockpit → **Business Application Studio** → create or open a Dev Space
   of type **Full Stack Cloud Application**.
2. In the Dev Space: **File → Open Workspace**, or from the welcome page choose
   **Clone from Git**.
3. Paste the repository URL:

   ```
   https://github.com/MANI-REDDY17/CPI_POC_PROJECT-main_capability.git
   ```

4. If the repository is private, use a personal access token as the password
   when Git prompts. Generate it with `repo` scope only, and revoke it when
   you are finished.

## 2. Log in to Cloud Foundry

In the BAS terminal (**Terminal → New Terminal**):

```bash
cf login -a https://api.cf.<your-region>.hana.ondemand.com --sso
```

Find your API endpoint in the BTP cockpit under **Subaccount → Overview →
Cloud Foundry Environment**. For a trial subaccount it usually looks like
`https://api.cf.us10-001.hana.ondemand.com`.

## 3. Deploy

```bash
chmod +x deploy-btp.sh
./deploy-btp.sh
```

The script:

1. checks for `node`, `npm` and `cf`, and that you are logged in
2. installs frontend dependencies and runs the production build
3. copies `FrontEnd/dist` into `BackEnd/public`
4. pushes the app **stopped**, so it cannot crash-loop before it has secrets
5. sets the six secrets with `cf set-env` (read from `BackEnd/.env` if that file
   exists, otherwise prompted for, with input hidden)
6. starts the app and prints its URL

Re-running it is safe; it redeploys over the existing app.

## 4. Secrets

These are set as CF environment variables, never committed and never uploaded
with the droplet (`BackEnd/.cfignore` excludes `.env`):

| Variable | Purpose |
|---|---|
| `CPI_BASE_URL` | Your CPI tenant API endpoint |
| `CPI_OAUTH_TOKEN_URL` | OAuth token endpoint |
| `CPI_OAUTH_CLIENT_ID` | Service key client id |
| `CPI_OAUTH_CLIENT_SECRET` | Service key client secret |
| `GROQ_API_KEY` | AI provider key |
| `BACKEND_API_KEY` | Shared key the frontend sends to the backend |

To change one later:

```bash
cf set-env cpi-ai-control-center GROQ_API_KEY <new-value>
cf restart cpi-ai-control-center
```

Non-secret defaults (`PORT`, `CPI_AUTH_MODE`, `AI_PROVIDER`, `GROQ_MODEL`) live
in `BackEnd/manifest.yml`.

## 5. Verify

```bash
cf app cpi-ai-control-center          # route and instance state
cf logs cpi-ai-control-center --recent
```

Then open the route. `/` serves the UI and `/api/health` reports CPI
connectivity.

## Troubleshooting

**App crashes right after start** — almost always a missing or wrong secret.
Check `cf logs cpi-ai-control-center --recent`, then re-set the value and
`cf restart`.

**Browser shows JSON instead of the UI** — `BackEnd/public` was not built.
Re-run `./deploy-btp.sh`; it rebuilds and re-copies on every run.

**`cf push` rejects the manifest** — confirm you are targeting the right org and
space with `cf target`.

**Out of memory** — raise `memory` in `BackEnd/manifest.yml` (512M default) and
push again. Large mapping sheets are the usual cause.

## Running locally instead

- Windows: double-click `START-APP.bat`, stop with `STOP-APP.bat`
- BAS or any bash shell:

  ```bash
  (cd BackEnd && npm install && node server.js) &
  (cd FrontEnd && npm install && npm run dev)
  ```

  Backend on 8082, frontend dev server on 5175.
