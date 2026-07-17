import { createApp } from './app.js';
import { env } from './config/env.js';
import { initFileStorage } from './storage/index.js';

try {
  await initFileStorage();
} catch (error) {
  console.error('File storage is misconfigured:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = createApp();

app.listen(env.PORT, env.HOST, () => {
  console.log(`API server listening on http://${env.HOST}:${env.PORT}`);
});
