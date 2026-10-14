import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.info(`API listening on port ${config.port}`);
});
