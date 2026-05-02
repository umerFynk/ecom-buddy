import OpenAI from 'openai';
import { env } from '@/config/env';

let _client: OpenAI | undefined;

export function getOpenAi(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

export const AI_MODEL = env.OPENAI_MODEL;
