import { ReplyParse } from './confirmation.types';

/**
 * Parse customer WA reply for confirmation intent.
 * Supports English + Roman Urdu + Urdu script + numeric OTP.
 *   Confirm: y, yes, ok, okay, confirm, han, haan, हाँ, ہاں, ji, jee, sahi
 *   Cancel:  n, no, cancel, nahi, nahin, نہیں, stop
 *   OTP:     any standalone 4-digit number
 */

const CONFIRM_TOKENS = new Set([
  'y', 'yes', 'ok', 'okay', 'confirm', 'confirmed', 'confirms',
  'han', 'haan', 'ji', 'jee', 'sahi', 'sahih', 'theek', 'thek', 'g',
  'ہاں', 'هاں', 'جی',
]);

const CANCEL_TOKENS = new Set([
  'n', 'no', 'cancel', 'cancelled', 'nope',
  'nahi', 'nahin', 'nai', 'mat', 'stop',
  'نہیں', 'نہی', 'بند',
]);

export function parseReply(raw: string): ReplyParse {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // OTP first — exact 4-digit number with no other words.
  const otpMatch = trimmed.match(/^\s*(\d{4})\s*$/);
  if (otpMatch) {
    return { intent: 'otp', otpCandidate: otpMatch[1], raw };
  }

  // Single token: check directly
  const firstToken = lower.split(/\s+/)[0] ?? '';
  if (CONFIRM_TOKENS.has(firstToken)) return { intent: 'confirm', raw };
  if (CANCEL_TOKENS.has(firstToken)) return { intent: 'cancel', raw };

  // Multi-token contains a confirm/cancel word
  const tokens = lower.split(/\s+/);
  if (tokens.some((t) => CONFIRM_TOKENS.has(t))) return { intent: 'confirm', raw };
  if (tokens.some((t) => CANCEL_TOKENS.has(t))) return { intent: 'cancel', raw };

  // OTP embedded in a longer message ("my code is 1234")
  const embeddedOtp = trimmed.match(/(?<![\d])(\d{4})(?![\d])/);
  if (embeddedOtp) return { intent: 'otp', otpCandidate: embeddedOtp[1], raw };

  return { intent: 'unknown', raw };
}
