# Erve — Production Deployment Runbook

This is the first-ever deployment of Erve. Nothing described here has been run against a real VPS yet — follow it in order for the first deployment, and re-use the later sections (First deployment, Rollback, Troubleshooting) for every deployment after that.

Placeholders used throughout, never real values:

```text
SITE_USER=<CloudPanel site user>
DOMAIN_NAME=<application domain>
APP_PORT=<CloudPanel local Node.js application port>
SSH_PORT=<VPS SSH port>
DEPLOY_ROOT=/home/${SITE_USER}/htdocs/${DOMAIN_NAME}
```

---

## 1. CloudPanel site provisioning (one-time, manual)

### 1.1 Pick an unused local port

SSH into the VPS with an existing administrative account and inspect listening TCP ports:

```bash
ss -ltnp
```

Choose a port not already listed. This becomes `APP_PORT`. It is **never** exposed through the public firewall — only Nginx (via `127.0.0.1:${APP_PORT}`) talks to it.

### 1.2 Create the site

In the CloudPanel UI, create a **Node.js** site:

```text
Domain: DOMAIN_NAME
Node.js version: 22        (highest CloudPanel offers — provisioning only, see §2)
App port: APP_PORT
Site user: SITE_USER
```

This creates `DEPLOY_ROOT = /home/SITE_USER/htdocs/DOMAIN_NAME` and configures the domain, HTTPS certificate, and base Nginx vhost. Activate HTTPS for the domain in CloudPanel (Let's Encrypt or your own certificate) before continuing.

### 1.3 SSH access for deployment

Generate a dedicated deploy keypair on your workstation — **never inside this (or any) Git repository working directory**, to avoid ever accidentally `git add`-ing a private key. Use an explicit path outside any repo, e.g. your own `~/.ssh/`:

```bash
ssh-keygen -t ed25519 -C "erve-deploy" -f ~/.ssh/erve_deploy_key
```

Add `~/.ssh/erve_deploy_key.pub` to the CloudPanel site user's authorized keys (CloudPanel UI → site → SSH Access, or append to `~SITE_USER/.ssh/authorized_keys` directly). Verify:

```bash
ssh -p SSH_PORT SITE_USER@VPS_HOST
```

Password-based deployment is never used. The private key (`~/.ssh/erve_deploy_key`, not the `.pub` file) becomes the `DEPLOY_SSH_KEY` GitHub secret (§6) — paste its contents directly into the GitHub secret value, then do not leave stray copies of it lying around afterward.

### 1.4 Record the VPS host key fingerprint

```bash
ssh-keyscan -p SSH_PORT VPS_HOST > /tmp/erve-known-hosts
ssh-keygen -lf /tmp/erve-known-hosts
```

**Separately verify** the printed fingerprint against the VPS provider's control panel (Hostinger shows the host key fingerprint for the instance) before trusting it — do not just take `ssh-keyscan`'s output on faith. Once verified, the contents of `/tmp/erve-known-hosts` becomes the `DEPLOY_KNOWN_HOSTS` GitHub secret (§6). The deployment workflow always passes `StrictHostKeyChecking=yes` against this pinned file — it never uses `StrictHostKeyChecking=no`.

---

## 2. Node.js 24 via NVM (site user)

CloudPanel only offers Node.js up to 22; the repository requires Node.js 24 (`package.json` `engines.node: ">=24.0.0 <25"`). CloudPanel's Node 22 is used **only** to provision the site/user/domain/port — the actual API always runs under NVM-managed Node 24.

As `SITE_USER`:

```bash
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
else
  echo "Install NVM first: https://github.com/nvm-sh/nvm" >&2
  exit 1
fi

nvm install 24
nvm alias default 24
nvm use 24

node --version      # must print v24.x
npm --version
which node
nvm which 24
```

Enable Corepack and activate the repository's pinned pnpm version (`pnpm@11.11.0`, from root `package.json`'s `packageManager` field — re-check this against the repo before relying on it):

```bash
corepack enable
corepack prepare pnpm@11.11.0 --activate
pnpm --version
```

**Every** script in `scripts/deployment/` explicitly re-loads NVM and runs `nvm use 24` itself — non-interactive SSH sessions, GitHub Actions SSH commands, and PM2's startup service do not inherit an interactive shell's NVM state. If the active Node major version is ever not `24`, those scripts fail closed rather than silently falling back to CloudPanel's Node 22.

### 2.1 Install PM2 under Node 24

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24

npm install --global pm2

which node
node --version
which pm2
pm2 --version
nvm which 24
```

Both `node` and `pm2` must resolve from the Node 24 NVM install, not root, not CloudPanel's Node 22, not another user.

---

## 3. PostgreSQL (already installed — role/database only)

PostgreSQL is already installed and running on the VPS and is **not** reinstalled or reconfigured globally.

### 3.1 Check the installed version

```bash
sudo -u postgres psql -tAc "SHOW server_version;"
```

Record the major version — it should match the `postgres:<major>` image used in both `.github/workflows/ci.yml` and `.github/workflows/deploy-production.yml` service containers (currently pinned to `postgres:18`; update both workflows together if the VPS version differs).

### 3.2 Generate the application password

```bash
openssl rand -hex 32
```

Copy it somewhere secure (e.g. your password manager) — not into a file in this repo, not into shell history you keep, not into GitHub.

### 3.3 Create the role and database

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE erve_app WITH LOGIN PASSWORD '<the generated password>';
CREATE DATABASE erve OWNER erve_app;
\l erve
```

`erve_app` must **not** have `SUPERUSER`, `REPLICATION`, `CREATEROLE`, or `CREATEDB`. It only owns and can log into the `erve` database.

### 3.4 Verify connectivity as the application role

From `SITE_USER`:

```bash
psql "postgresql://erve_app:<PASSWORD>@127.0.0.1:5432/erve"
```

```sql
SELECT current_user;      -- erve_app
SELECT current_database(); -- erve
```

This becomes the production `DATABASE_URL`:

```text
postgresql://erve_app:<PASSWORD>@127.0.0.1:5432/erve?schema=public
```

The schema is Prisma's `public` default (`apps/api/prisma/schema.prisma` sets no custom schema) — no extra privilege grants are needed beyond ownership of the `erve` database.

---

## 4. Server directory structure

As `SITE_USER`:

```bash
DEPLOY_ROOT="/home/SITE_USER/htdocs/DOMAIN_NAME"

mkdir -p "$DEPLOY_ROOT/releases"
mkdir -p "$DEPLOY_ROOT/shared/backups"
mkdir -p "$DEPLOY_ROOT/shared/uploads"
mkdir -p "$DEPLOY_ROOT/shared/mobile-updates/bundles"
mkdir -p "$DEPLOY_ROOT/.deploy/incoming"
mkdir -p "$DEPLOY_ROOT/.deploy/failed"
mkdir -p "$DEPLOY_ROOT/.deploy/scripts"

chmod 700 "$DEPLOY_ROOT/shared/backups"
```

`releases/`, `shared/`, and `.deploy/` are created once. Deployments never delete `shared/` content; `scripts/deployment/cleanup-releases.sh` only ever touches `releases/<full-git-sha>` directories that aren't `current` or the immediately-previous release.

---

## 5. Production environment file

Create `${DEPLOY_ROOT}/shared/api.env` **manually** on the VPS — it is never committed, never part of the deployment artifact, and never printed by any script or workflow.

```bash
touch "$DEPLOY_ROOT/shared/api.env"
chmod 600 "$DEPLOY_ROOT/shared/api.env"
```

Contents (derived from `apps/api/src/config/env.ts`'s Zod schema and `apps/api/.env.example` — re-check both against the repo before relying on this list, since it's the source of truth):

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=<APP_PORT — must match the CloudPanel-assigned port>

DATABASE_URL=postgresql://erve_app:<PASSWORD>@127.0.0.1:5432/erve?schema=public

# Generate distinct secrets with: openssl rand -hex 32
JWT_ACCESS_SECRET=<32+ char random secret>
JWT_REFRESH_SECRET=<different 32+ char random secret>
JWT_ACCESS_EXPIRES_IN=5m
JWT_REFRESH_IDLE_TIMEOUT_MINUTES=20
JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS=8

# Exact-match allowlist, comma-separated. https://localhost is the real
# observed Capacitor Android WebView origin for the packaged mobile app
# (see apps/mobile/CAPACITOR_AUTH_TESTING.md) — unrelated to DOMAIN_NAME
# and required regardless of which domain the web app is served from.
CORS_ORIGIN=https://DOMAIN_NAME,https://localhost
```

Notes:
- The web app itself doesn't strictly need to be in `CORS_ORIGIN` (it's served same-origin through Nginx at `/`, calling `/api/...` — no cross-origin request, no CORS preflight), but including it is harmless defense-in-depth.
- The refresh-token cookie (`apps/api/src/modules/auth/refresh-cookie.ts`) sets `Secure` whenever `NODE_ENV=production`, so HTTPS must be live end-to-end (CloudPanel's cert + this env value) before testing login from a browser.
- That same cookie is issued with `Path=/`, not an Express-internal path like `/auth`. The public request path the browser actually sees differs by environment — `/auth/refresh` in local dev (direct Express, no proxy) vs. `/api/auth/refresh` in production (behind the Nginx `/api/` proxy, §8) — and `Path=/` is the one value that is correct in both without any environment-specific configuration or an Nginx `proxy_cookie_path` rewrite. Do not change this to a narrower path without re-verifying it against whatever public path the browser/Capacitor WebView actually calls.
- No file upload / storage credentials exist in the current codebase (no `multer`, no upload routes) — `shared/uploads/` is reserved for when that lands, not used today.

Every release gets a fresh `api/.env → ../../../shared/api.env` symlink created by `deploy-release.sh` — the file itself is written once and reused by every deployment.

---

## 6. GitHub configuration

### 6.1 Environment

Create a GitHub **Environment** named `production` (repo Settings → Environments). This gates the `deploy` job in `.github/workflows/deploy-production.yml` — add required reviewers here if you want manual approval before each deploy.

### 6.2 Environment secrets

```text
DEPLOY_SSH_KEY       the private key generated in §1.3 (erve_deploy_key, not the .pub file)
DEPLOY_KNOWN_HOSTS    the verified contents of /tmp/erve-known-hosts from §1.4
```

### 6.3 Environment variables

```text
DEPLOY_HOST                VPS hostname or IP
DEPLOY_PORT                SSH_PORT
DEPLOY_USER                SITE_USER
DEPLOY_ROOT                /home/SITE_USER/htdocs/DOMAIN_NAME
ERVE_BASE_URL              https://DOMAIN_NAME
APP_PORT                   the port chosen in §1.1
ERVE_RELEASE_RETENTION     10
ERVE_DB_BACKUP_RETENTION   10
```

`ERVE_RELEASE_RETENTION` and `ERVE_DB_BACKUP_RETENTION` are independent policies enforced by separate scripts (`scripts/deployment/cleanup-releases.sh` and `scripts/deployment/cleanup-backups.sh`) — see §11.1.

The production `DATABASE_URL` and JWT secrets are **never** entered into GitHub — they live only in `shared/api.env` on the VPS.

---

## 7. First deployment (ordered)

1. Complete §1–§6 above.
2. Push/merge the commit you want deployed to `main`.
3. In GitHub → Actions → **Deploy to production** → Run workflow (this is a `workflow_dispatch`-only workflow; it never runs automatically).
4. Watch the `build-and-verify` job: install → typecheck → lint → `@erve/client` tests → migrate the disposable CI database → seed → `@erve/api` tests → re-seed (the test suite truncates the seeded data) → `tsc` build → `scripts/deployment/package-production.sh` → boot the packaged artifact against the disposable database and verify `/health` (200), `/ready` (200), a real login as the seeded admin, and a real DB-backed `/styles` read, all through the packaged artifact itself (not the monorepo source) → upload the artifact.
5. If the `production` Environment has required reviewers, approve the `deploy` job.
6. Watch the `deploy` job: download + checksum-verify the artifact → SSH → upload artifact and `scripts/deployment/` to the VPS → run `deploy-release.sh <sha>` remotely.
7. On the VPS, confirm:
   ```bash
   pm2 status
   pm2 logs erve-api --lines 50
   readlink -f "$DEPLOY_ROOT/current"
   curl -s http://127.0.0.1:$APP_PORT/health
   curl -s http://127.0.0.1:$APP_PORT/ready
   ```
8. Apply the Nginx changes from §8 (one-time, manual) if not already done, then:
   ```bash
   curl -s https://DOMAIN_NAME/
   curl -s https://DOMAIN_NAME/api/health
   curl -s https://DOMAIN_NAME/api/ready
   ```
9. Configure PM2 boot recovery (§9) — not required for this first deploy to succeed, but do it before you consider the environment production-ready.

---

## 8. Nginx (CloudPanel custom vhost)

CloudPanel manages the base vhost (SSL, its own security/logging includes). Do not replace it. Open the CloudPanel UI's vhost editor for `DOMAIN_NAME` and splice in the three `location` blocks from [`deployment/nginx/erve.vhost.example.conf`](deployment/nginx/erve.vhost.example.conf), replacing `<DEPLOY_ROOT>` and `<APP_PORT>`. Validate and reload:

```bash
nginx -t
sudo systemctl reload nginx
```

Then verify:

```text
GET /                                   -> web frontend
GET /some-spa-route                     -> web frontend (SPA fallback)
GET /assets/<real-hashed-file>          -> the asset, long-cached
GET /assets/<made-up-file>              -> 404
GET /api/health                         -> API health JSON
GET /api/ready                          -> API readiness JSON
GET /api/nonexistent                    -> API 404 JSON (NOT index.html)
GET /mobile-updates/bundles/missing.zip -> 404 (NOT index.html)
```

---

## 9. PM2 boot recovery

As `SITE_USER`, with Node 24 active:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24

pm2 status
pm2 startup systemd
```

This prints a privileged command containing the exact NVM Node 24 path — run **that exact command** as root (e.g. via `sudo`). Then, back as `SITE_USER`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24
pm2 save
```

Verify:

```bash
systemctl status pm2-SITE_USER
pm2 status
```

Regenerate the startup service (`pm2 startup systemd` + `pm2 save`) whenever: the NVM Node 24 path changes (a new 24.x patch gets installed under a new path), PM2 is reinstalled under a different Node version, or the site user changes. **Reboot recovery is not considered verified until you have actually performed a controlled `sudo reboot` and confirmed `pm2 status` shows `erve-api` online afterward.**

---

## 10. Manual rollback

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
DEPLOY_ROOT=/home/SITE_USER/htdocs/DOMAIN_NAME APP_PORT=<APP_PORT> ERVE_BASE_URL=https://DOMAIN_NAME \
  "$DEPLOY_ROOT/.deploy/scripts/rollback-release.sh" <full-git-sha-of-a-previous-release>
```

List available releases first with `ls "$DEPLOY_ROOT/releases"`. The script refuses anything that isn't a full 40-character SHA matching an existing, structurally-valid release directory, atomically re-points `current`, reloads PM2, health-checks, and auto-reverts if the target release fails its health check.

**Rollback never reverses Prisma migrations.** If the release you're rolling back to predates a non-backward-compatible schema change, the older code may be incompatible with the current database schema — check the migration history in `apps/api/prisma/migrations/` before rolling back across a migration boundary. Prefer expand-and-contract migrations going forward specifically so this is less likely to bite.

---

## 11. Database backups and restore testing

### 11.1 Retention configuration

`backup-database.sh` (called by `deploy-release.sh` before every migration) takes a `pg_dump --format=custom` backup into `${DEPLOY_ROOT}/shared/backups/`, then runs `cleanup-backups.sh` once that backup is confirmed non-empty:

```text
ERVE_DB_BACKUP_RETENTION=10
```

This is a **separate policy from application release retention** (`ERVE_RELEASE_RETENTION`, §6.3) — different script (`cleanup-backups.sh`, not `cleanup-releases.sh`), different lifecycle, different files. `ERVE_DB_BACKUP_RETENTION` is the total number of backup files kept under `shared/backups/`, and — same "total cap" semantics as release retention — the backup that was just created always fills one of those slots regardless of its own mtime rank; cleanup only ever deletes files matching the exact `erve-<UTC timestamp>.dump` naming convention, and only after the new backup is verified non-empty.

### 11.2 Application rollback vs. database restoration — these are not the same thing

- **Application rollback** (§10, `rollback-release.sh`) switches which compiled release `current` points at and reloads PM2. It is fast, safe to try, and auto-reverts on failure. **It never touches the database.**
- **Database restoration** (restoring a `shared/backups/*.dump` file with `pg_restore`) is a separate, manual, higher-risk operation that overwrites live data. There is no automated script for this in `scripts/deployment/` — restoring production data is deliberately not a one-command operation.

If a deployment's migration corrupted data or a schema change is incompatible with older application code, an application rollback **alone does not fix a bad migration** — you may need both a code rollback and a database restore, and should think carefully about data created *after* the bad migration that a restore would discard.

### 11.3 Off-VPS backup storage is required

`shared/backups/` on the VPS is **not** a substitute for off-server backup storage. It protects against a bad migration on the *same* deployment; it does not protect against VPS disk failure, accidental `rm -rf`, the VPS provider losing the instance, or ransomware affecting the whole filesystem. Set up a periodic off-VPS copy of `shared/backups/*.dump` (e.g. a cron'd `rsync`/`rclone` to separate storage, or your VPS provider's snapshot feature) — this is not implemented as part of this deployment pipeline and is tracked here as a pending operational task, not a completed one.

### 11.4 Restore-testing procedure (use a separate database — never production)

Backups are only as good as your last successful *restore test*. Periodically (and definitely before you actually need it in an emergency):

```bash
# On the VPS, or anywhere with network access to Postgres and the backup file:
sudo -u postgres createdb erve_restore_test
pg_restore --format=custom --dbname=erve_restore_test "$DEPLOY_ROOT/shared/backups/<chosen>.dump"

# Sanity-check the restored data:
psql "postgresql://erve_app:<PASSWORD>@127.0.0.1:5432/erve_restore_test" -c "SELECT count(*) FROM users;"

# Clean up:
sudo -u postgres dropdb erve_restore_test
```

**Never** `pg_restore` directly into the live `erve` database as a way of "testing" a backup — that overwrites production data. Do not consider backup/restore verified until this has actually been run and the row counts/spot-checked data looked correct.

---

## 12. Troubleshooting

| Symptom | Likely cause / first check |
|---|---|
| SSH authentication failure from GitHub Actions | `DEPLOY_SSH_KEY` doesn't match the key added to `SITE_USER`'s `authorized_keys`; confirm with `ssh -i <key> -p SSH_PORT SITE_USER@VPS_HOST` locally first |
| Host key mismatch / `deploy` job fails at SSH step | VPS host key rotated (reprovisioned VPS, etc.) — re-run §1.4 and update `DEPLOY_KNOWN_HOSTS`; never silence this with `StrictHostKeyChecking=no` |
| `deploy-release.sh` fails disk space preflight | `du -sk "$DEPLOY_ROOT/releases"` and `df -Pk "$DEPLOY_ROOT"` — run `cleanup-releases.sh` manually or lower `ERVE_RELEASE_RETENTION` |
| Artifact checksum failure | Re-run the `build-and-verify` job; do not manually re-upload a tarball with a stale checksum file |
| `package-production.sh` fails during `pnpm install --prod` in the artifact | Check `apps/api/package.json`'s `dependencies` — `generate-prod-package-json.mjs` only pins direct deps + `prisma`; a new direct dependency needs no script change, but a new *transitive-only* native dependency might need investigation |
| Prisma Client / migration engine mismatch on the VPS | `apps/api/prisma/schema.prisma` uses the engine-less `prisma-client` provider (WASM query compiler, no native query engine binary), but `prisma migrate deploy`'s **schema engine** is a real platform-specific binary resolved by `@prisma/engines` at install time on the GitHub Actions runner (Linux x64). Confirm the VPS is also Linux x64 — `uname -m` should print `x86_64` — before relying on this packaging approach |
| CI Postgres service fails to become healthy | Usually a transient GitHub Actions runner issue — re-run the job; if persistent, check the `postgres:18` image tag still matches §3.1's `SHOW server_version;` output |
| Migration failure on the VPS | `deploy-release.sh` takes a backup (`backup-database.sh`) *before* migrating and aborts the deployment (release not activated) on migration failure — check `pm2 logs`, fix forward, redeploy; do not attempt to hand-edit `_prisma_migrations` |
| Backup failure | Confirm `shared/api.env` exists and is readable by `SITE_USER`, and that `pg_dump`/`psql` client tools are installed and match a compatible major version |
| `cleanup-backups.sh` "refuses" or errors on a path | It only ever deletes files directly under `shared/backups/` matching the exact `erve-<timestamp>.dump` naming convention, and never the backup just created — this is intentional; investigate rather than working around it |
| Fewer backups present than `ERVE_DB_BACKUP_RETENTION` | Normal if fewer than that many deployments (and therefore backups) have happened yet — retention is a maximum, not a guarantee of that many existing |
| PM2 shows `erve-api` offline after deploy | `pm2 logs erve-api` — most likely `shared/api.env` is missing/malformed (the app's own `dotenv/config` + Zod schema will log which variables failed validation) |
| PM2 running under Node 22 instead of 24 | `pm2 startup`/`pm2 install` was run without `nvm use 24` active first — re-run §9 in full, including regenerating the systemd unit |
| PM2 startup service failure after reboot | The NVM Node 24 path baked into the old systemd unit no longer exists (patch upgrade) — regenerate per §9 |
| `nginx -t` failure | You likely edited outside the three spliced `location` blocks, or duplicated a `location /` — re-diff against `deployment/nginx/erve.vhost.example.conf` |
| Nginx 502 on `/api/` | `erve-api` PM2 process is down, or bound to the wrong `HOST`/`PORT` — check `shared/api.env`'s `HOST=127.0.0.1`/`PORT` matches the Nginx `proxy_pass` target and CloudPanel's assigned `APP_PORT` |
| SPA routes 404 instead of loading the app | The `location /` block's `try_files $uri $uri/ /index.html;` fallback is missing/misordered relative to `/api/` and `/mobile-updates/bundles/` |
| API 404s return `index.html` instead of JSON | The `/api/` `location` block is being matched *after* `location /` instead of Nginx's normal longest-prefix-first behavior — check block ordering and that `location /api/` isn't accidentally nested under `location /` |
| Refresh cookie not being set/sent behind HTTPS | Confirm `NODE_ENV=production` in `shared/api.env` (the cookie's `Secure` flag is keyed off this) and that the browser is actually on `https://` — mixed content silently drops `Secure` cookies |
| `/api/ready` returns 503 | Real DB connectivity issue — check `psql "${DATABASE_URL%%\?*}" -tAc "SELECT 1;"` on the VPS directly (`deploy-release.sh`/`backup-database.sh` use the same check via `erve_libpq_url`; the `?schema=` suffix is Prisma-only and must be stripped before handing the URL to psql/pg_dump) |
| Rollback fails | `rollback-release.sh` auto-restores the previously active release and refuses to leave the box on a failed target — check `pm2 logs` for the target release's own startup errors |
| `cleanup-releases.sh` "refuses unsafe deletion" | Working as intended — it only deletes directories directly under `releases/` named as a full Git SHA, and never the currently active one; if you need to remove something else, do it manually with `realpath` sanity checks of your own |
