import bcrypt from "bcryptjs";

const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function checkPasswordStrength(plain: string): string | null {
  if (plain.length < 12) return "Passwords must be at least 12 characters.";
  return null;
}
