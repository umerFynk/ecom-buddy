export type ConfirmationPath = 'A' | 'B' | 'C' | 'D' | 'E' | 'ai_engine';

export interface ReplyParse {
  intent: 'confirm' | 'cancel' | 'otp' | 'unknown';
  otpCandidate?: string;
  raw: string;
}
