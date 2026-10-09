import { execFileSync } from 'node:child_process';
import { testEnv } from './env.js';

export default function setup() {
  const env = testEnv();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });
}
