import { z } from 'zod';

// trim -> lowercase -> validate, so "  Amina@Shop.co.ke " and "amina@shop.co.ke" are the same account.
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

// bcrypt only uses the first 72 bytes of a password, so we cap the length instead of silently truncating.
const password = z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters');

export const registerSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is too short').max(100),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  // On login we don't enforce strength rules; we only check it against the stored hash.
  password: z.string().min(1, 'Password is required').max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
