export type RiskDecision =
  | 'auto_confirm'
  | 'wa_confirm'
  | 'otp_required'
  | 'cs_review'
  | 'auto_cancel';

export interface RiskFactorContribution {
  factor: string;
  value: number; // points added (or set)
  reason: string;
}

export interface RiskScoreBreakdown {
  base: number;
  factors: RiskFactorContribution[];
  finalScore: number;
  cappedAt0: boolean;
  forcedScore?: number; // when a custom rule used SET (e.g. prepaid → 0)
  decision: RiskDecision;
  modeUsed: 'manual' | 'ai_engine' | 'off';
  thresholds: { otp: number; cs: number; cancel: number };
}

export interface RiskInputOrder {
  amount: number; // in PKR
  paymentStatus: 'cod' | 'prepaid';
  city: string; // canonical name (post-normalization)
  cityTier: 1 | 2 | 3 | 4;
  phone: string; // normalized
  phoneIsValid: boolean;
  addressLine1: string;
  addressLine2?: string | null;
  createdAt: Date;
  customerTags: string[];
  isVip: boolean;
}

export interface RiskInputCustomer {
  exists: boolean;
  totalOrders: number;
  deliveredCount: number;
  returnedCount: number;
  blacklistLevel: 'clean' | 'watch' | 'high_risk' | 'blacklisted' | 'global';
}

export interface DefaultFactorWeights {
  phone_invalid: number;
  address_incomplete: number;
  first_time_customer: number;
  order_value_above_city_avg_2x: number;
  night_order_2am_6am: number;
}

export interface RiskConfigSnapshot {
  mode: 'off' | 'manual' | 'ai_engine';
  factorWeights: DefaultFactorWeights;
  otpThreshold: number;
  csThreshold: number;
  cancelThreshold: number;
}

export interface CustomRuleEvaluated {
  ruleId: string;
  name: string;
  triggered: boolean;
  pointsApplied: number;
  setScore?: number;
}
