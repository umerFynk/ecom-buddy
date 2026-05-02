import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, addMinutes, set } from 'date-fns';
import { prisma } from '@/db/prisma';

/**
 * Business hours + quiet hours gate. Used by the WA worker before sending
 * any non-urgent customer message.
 *
 * Sources of truth (highest → lowest priority):
 *   1. notification_settings.quiet_hours_start/end (per event_type, per tenant)
 *   2. store.businessHoursStart/End (per store)
 *   3. Default 09:00 – 21:00 in Asia/Karachi
 *
 * Returns either { allowedNow: true } or { allowedNow: false, deferUntil: Date }.
 */

const DEFAULT_TZ = 'Asia/Karachi';
const DEFAULT_START = '09:00';
const DEFAULT_END = '21:00';

export interface SendWindowDecision {
  allowedNow: boolean;
  deferUntil?: Date;
  reason?: string;
}

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function nextOccurrenceOf(now: Date, tz: string, hhmm: string): Date {
  // Build a Date in the given tz at hhmm today; if it's already past, push to tomorrow.
  const parsed = parseHHMM(hhmm) ?? { h: 9, m: 0 };
  const localNow = toZonedTime(now, tz);
  let target = set(localNow, { hours: parsed.h, minutes: parsed.m, seconds: 0, milliseconds: 0 });
  if (target.getTime() <= localNow.getTime()) target = addDays(target, 1);
  return fromZonedTime(target, tz);
}

export interface SendWindowInput {
  tenantId: string;
  storeId?: string | null;
  eventType?: string; // for per-event quiet-hours lookup
  now?: Date;
}

export async function checkSendWindow(input: SendWindowInput): Promise<SendWindowDecision> {
  const now = input.now ?? new Date();

  let tz = DEFAULT_TZ;
  let start = DEFAULT_START;
  let end = DEFAULT_END;

  if (input.storeId) {
    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (store) {
      tz = store.timezone || DEFAULT_TZ;
      start = store.businessHoursStart || DEFAULT_START;
      end = store.businessHoursEnd || DEFAULT_END;
    }
  }

  if (input.eventType) {
    const setting = await prisma.notificationSetting.findUnique({
      where: { tenantId_eventType: { tenantId: input.tenantId, eventType: input.eventType } },
    });
    if (setting?.quietHoursStart && setting?.quietHoursEnd) {
      // Quiet hours represent a window in which we MUST NOT send. We invert it
      // into business hours by setting allowed window = end..start.
      const allowed = withinDailyWindow(now, tz, setting.quietHoursEnd, setting.quietHoursStart);
      if (!allowed) {
        return { allowedNow: false, deferUntil: nextOccurrenceOf(now, tz, setting.quietHoursEnd), reason: 'quiet_hours' };
      }
    }
  }

  if (withinDailyWindow(now, tz, start, end)) {
    return { allowedNow: true };
  }
  return { allowedNow: false, deferUntil: nextOccurrenceOf(now, tz, start), reason: 'outside_business_hours' };
}

/**
 * `windowStart` and `windowEnd` are HH:mm strings in `tz` time. Returns true
 * if `now` falls in [start, end). Handles wrap-around windows (e.g. 22:00..06:00).
 */
function withinDailyWindow(now: Date, tz: string, windowStart: string, windowEnd: string): boolean {
  const start = parseHHMM(windowStart);
  const end = parseHHMM(windowEnd);
  if (!start || !end) return true;

  const local = toZonedTime(now, tz);
  const minutes = local.getHours() * 60 + local.getMinutes();
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;

  if (startMin < endMin) {
    // Same-day window
    return minutes >= startMin && minutes < endMin;
  }
  // Wraps midnight (e.g. 22:00 → 06:00 next day)
  return minutes >= startMin || minutes < endMin;
}

/** Convenience: schedule a delay-from-now for a deferred send. */
export function delayMs(decision: SendWindowDecision, fallbackMinutes = 60): number {
  if (decision.allowedNow) return 0;
  if (decision.deferUntil) return Math.max(0, decision.deferUntil.getTime() - Date.now());
  return addMinutes(new Date(), fallbackMinutes).getTime() - Date.now();
}
