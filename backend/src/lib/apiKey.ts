import crypto from 'crypto';

/**
 * API key format: `eb_<env>_<random>`. We display the full key once at
 * generation time. Only the prefix (first 8 chars) and a SHA-256 hash are
 * stored. Verification = SHA-256(provided) === stored hash.
 */

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(envLabel = 'live'): GeneratedApiKey {
  const random = crypto.randomBytes(32).toString('base64url');
  const plaintext = `eb_${envLabel}_${random}`;
  const prefix = plaintext.slice(0, 8);
  const hash = hashApiKey(plaintext);
  return { plaintext, prefix, hash };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
