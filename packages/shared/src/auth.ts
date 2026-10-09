import { z } from 'zod';

export const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'ANALYST'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = { ANALYST: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };

/** True when `role` grants at least the privileges of `min`. */
export function hasRole(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const emailSchema = z.email().max(254).transform((e) => e.toLowerCase());
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Include letters and numbers');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const membershipSchema = z.object({
  storeId: z.string(),
  shopDomain: z.string(),
  storeName: z.string().nullable(),
  role: roleSchema,
});

export const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().nullable(), name: z.string().nullable() }),
  memberships: z.array(membershipSchema),
  current: membershipSchema.nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const teamMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: roleSchema,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;
export const teamListSchema = z.object({ members: z.array(teamMemberSchema) });

/** Ownership is never assigned through role updates. */
export const updateRoleSchema = z.object({ role: z.enum(['ADMIN', 'EDITOR', 'ANALYST']) });
