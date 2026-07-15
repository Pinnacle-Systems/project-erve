import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.PORT, env.HOST, () => {
  console.log(`API server listening on http://${env.HOST}:${env.PORT}`);
});
