import { buildApp } from './app.js';
import { parseEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { closeDeps, createDeps } from './lib/deps-factory.js';

loadRootEnvFile();
const deps = createDeps(parseEnv(process.env));
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDeps(deps);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: deps.env.API_PORT, host: '0.0.0.0' });
