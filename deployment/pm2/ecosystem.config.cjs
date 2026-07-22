// PM2 process configuration for the Erve API.
//
// Deliberately contains no secrets and no PORT/DATABASE_URL/etc. Runtime
// configuration is loaded by the application itself from a `.env` file in
// its working directory, via the existing `import 'dotenv/config'` in
// apps/api/src/config/env.ts. That `.env` is a symlink to
// `${DEPLOY_ROOT}/shared/api.env`, created by
// scripts/deployment/deploy-release.sh — this file never needs secrets
// injected into it.
//
// This file is copied into every release's `api/` directory by
// scripts/deployment/package-production.sh. It is always started directly
// against a specific release directory under `releases/<sha>/api/` — never
// through the `current` symlink. PM2 stores the resolved absolute script
// path and cwd a process was started with and does not reliably re-resolve
// them on `pm2 restart`/`pm2 reload`/`pm2 startOrReload` against an
// already-registered name (only environment variables get refreshed by
// `--update-env`) — starting through `current` let Node's module
// resolution silently bake in whatever release the symlink happened to
// point at when the process was first registered, and every later
// deploy/rollback then kept reloading that stale target. See
// erve_start_api_release / erve_activate_pm2_release in
// scripts/deployment/lib/common.sh, which delete and freshly start this
// app directly against the target release on every activation and
// rollback:
//
//   cd ${DEPLOY_ROOT}/releases/<sha>/api
//   pm2 delete erve-api || true
//   pm2 start ecosystem.config.cjs --only erve-api --update-env
//   pm2 save   # only after the release passes its health check
module.exports = {
  apps: [
    {
      name: 'erve-api',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
