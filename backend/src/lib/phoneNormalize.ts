/**
 * Pakistani phone normalization. All accepted forms collapse to 11 digits
 * starting with "03" (e.g. 03001234567). Anything else returns { valid: false }.
 *
 * Accepted: 0300-1234567 / +923001234567 / 923001234567 / 3001234567 / 03001234567
 * Country prefix: +92 / 0092 / 92.
 *
 * Mobile prefix range: 030x – 035x is the valid Pakistan mobile range.
 */

const STRIP = /[\s()\-\.]/g;

export interface PhoneResult {
  valid: boolean;
  normalized?: string; // e.g. "03001234567"
  e164?: string; // e.g. "+923001234567"
  reason?: string;
}

export function normalizePakistaniPhone(input: string | null | undefined): PhoneResult {
  if (!input) return { valid: false, reason: 'empty' };

  let digits = String(input).replace(STRIP, '');

  // Drop "+" if present.
  if (digits.startsWith('+')) digits = digits.slice(1);

  // 0092xxxxxxxxxx → 92xxxxxxxxxx
  if (digits.startsWith('0092')) digits = digits.slice(2);

  // 923xxxxxxxxx → 03xxxxxxxxx
  if (digits.startsWith('92') && digits.length === 12) {
    digits = '0' + digits.slice(2);
  }

  // 3xxxxxxxxx (10 digits, no leading 0) → prepend 0
  if (digits.length === 10 && digits.startsWith('3')) {
    digits = '0' + digits;
  }

  // Final shape must be 11 digits, starts with 03, second digit 0-5.
  if (!/^03\d{9}$/.test(digits)) {
    return { valid: false, reason: 'invalid_format' };
  }
  const networkDigit = digits[2];
  if (!['0', '1', '2', '3', '4', '5'].includes(networkDigit!)) {
    return { valid: false, reason: 'invalid_network_prefix' };
  }

  return {
    valid: true,
    normalized: digits,
    e164: '+92' + digits.slice(1),
  };
}

export function isValidPakistaniPhone(input: string | null | undefined): boolean {
  return normalizePakistaniPhone(input).valid;
}
