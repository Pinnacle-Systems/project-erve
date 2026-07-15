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
// scripts/deployment/package-production.sh and is always started through
// the stable `current` symlink, so the exact command below never changes
// between deployments:
//
//   pm2 startOrReload ${DEPLOY_ROOT}/current/api/ecosystem.config.cjs \
//     --only erve-api --update-env
//   pm2 save
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
