import { CourierType } from '@prisma/client';
import { decrypt } from '@/lib/encryption';
import { prisma } from '@/db/prisma';
import { CourierAdapter, CourierCredentials } from './courier.types';
import { PostExAdapter } from './adapters/postex';
import { LeopardsAdapter } from './adapters/leopards';
import { TraxAdapter } from './adapters/trax';
import { BlueExAdapter } from './adapters/blueex';
import { MnxAdapter } from './adapters/mnx';
import { CallCourierAdapter } from './adapters/callcourier';

export function buildAdapter(type: CourierType, creds: CourierCredentials): CourierAdapter {
  switch (type) {
    case 'postex':      return new PostExAdapter(creds);
    case 'leopards':    return new LeopardsAdapter(creds);
    case 'trax':        return new TraxAdapter(creds);
    case 'blueex':      return new BlueExAdapter(creds);
    case 'mnx':         return new MnxAdapter(creds);
    case 'callcourier': return new CallCourierAdapter(creds);
    default: {
      const exhaustive: never = type;
      throw new Error(`Unsupported courier type: ${exhaustive as string}`);
    }
  }
}

export async function buildAdapterForConfig(courierConfigId: string): Promise<CourierAdapter> {
  const cfg = await prisma.courierConfig.findUnique({ where: { id: courierConfigId } });
  if (!cfg) throw new Error(`Courier config ${courierConfigId} not found`);
  if (!cfg.isActive) throw new Error(`Courier config ${courierConfigId} is inactive`);

  const creds: CourierCredentials = {
    accountNo: cfg.accountNo ?? undefined,
  };

  try {
    creds.apiKey = decrypt(cfg.apiKeyEncrypted);
  } catch (err) {
    // Fall through — adapter falls back to platform-level env credentials.
  }
  if (cfg.apiPasswordEncrypted) {
    try {
      creds.apiPassword = decrypt(cfg.apiPasswordEncrypted);
    } catch {
      /* ignore */
    }
  }

  return buildAdapter(cfg.courierType, creds);
}
