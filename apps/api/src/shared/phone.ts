import { z } from 'zod';

/**
 * Normalises a Kenyan mobile number to the format M-Pesa uses: 2547XXXXXXXX / 2541XXXXXXXX.
 * Accepts 0712345678, 0112345678, +254712345678, 254712345678, 712345678 (spaces/dashes ok).
 * Returns null if it isn't a plausible Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith('254') && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;

  // Kenyan mobile numbers start with 7 or 1 (07xx / 01xx) and have 9 digits after the country code.
  return /^[71]\d{8}$/.test(national) ? `254${national}` : null;
}

/** Zod schema that validates AND normalises a phone number. */
export const phoneSchema = z
  .string()
  .trim()
  .refine((value) => normalizeKenyanPhone(value) !== null, 'Enter a valid Kenyan phone number, e.g. 0712345678')
  .transform((value) => normalizeKenyanPhone(value)!);
