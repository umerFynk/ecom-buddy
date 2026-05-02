export type RecognitionMode = 'cash_basis' | 'accrual_delivered' | 'accrual_dispatched';

/** Per-courier remittance fee + COD collection % (rough industry defaults).
 *  Overridable per courier_config in tenant.settings.courier_fees later. */
export const DEFAULT_COURIER_FEES: Record<string, { bookingFeePkr: number; codFeePct: number }> = {
  postex:      { bookingFeePkr: 200, codFeePct: 1.0 },
  leopards:    { bookingFeePkr: 220, codFeePct: 1.0 },
  trax:        { bookingFeePkr: 210, codFeePct: 1.5 },
  blueex:      { bookingFeePkr: 230, codFeePct: 1.0 },
  mnx:         { bookingFeePkr: 200, codFeePct: 1.0 },
  callcourier: { bookingFeePkr: 195, codFeePct: 1.5 },
};

export interface FinancialBreakdown {
  grossRevenue: number;
  cogs: number;
  grossProfit: number;
  courierFee: number;
  codFee: number;
  waCost: number;
  rtoLoss: number;
  returnShipping: number;
  netProfit: number;
  margin: number; // percent
  recognitionMode: RecognitionMode;
  recognizedAt?: Date;
  notes: string[];
}
