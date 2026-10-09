import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['ok', 'error']);

export const readinessSchema = z.object({
  status: dependencyStatusSchema,
  checks: z.object({ database: dependencyStatusSchema, redis: dependencyStatusSchema }),
});

export type Readiness = z.infer<typeof readinessSchema>;
