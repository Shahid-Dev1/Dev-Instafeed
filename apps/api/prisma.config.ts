import { defineConfig, env } from 'prisma/config';
import { loadRootEnvFile } from './src/config/load-env-file.js';

loadRootEnvFile();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
