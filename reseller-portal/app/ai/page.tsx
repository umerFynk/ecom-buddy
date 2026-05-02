'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Input, ErrorBox } from '@/components/ui';
import { useApiMutation } from '@/lib/useApi';

interface Turn { role: 'user' | 'assistant'; content: string }

export default function AiPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [convId, setConvId] = useState<string | undefined>();
  const mut = useApiMutation<{ conversationId: string; reply: string }>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const next = [...turns, { role: 'user' as const, content: text }];
    setTurns(next);
    const userText = text;
    setText('');
    const r = await mut.mutate('POST', '/v1/ai/chat', { message: userText, conversationId: convId });
    if (r) {
      setConvId(r.conversationId);
      setTurns([...next, { role: 'assistant' as const, content: r.reply }]);
    }
  }

  return (
    <AppLayout>
      <Topbar title="AI Assistant" subtitle="Ask anything about your store" />
      <Card className="h-[calc(100vh-220px)] flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-3">
          {turns.length === 0 && (
            <div className="text-sm text-zinc-500">
              Try: <em>&quot;How many RTOs this week?&quot;</em>, <em>&quot;Best selling product this month?&quot;</em>, <em>&quot;Tips for Eid sale?&quot;</em>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${t.role === 'user' ? 'bg-brand text-white' : 'bg-zinc-900 text-zinc-100'}`}>
                {t.content}
              </div>
            </div>
          ))}
          {mut.loading && <div className="text-xs text-zinc-500">Thinking…</div>}
        </div>
        <ErrorBox error={mut.error} />
        <form onSubmit={send} className="flex gap-2 pt-2 border-t border-zinc-900">
          <Input value={text} onChange={setText} placeholder="Ask the assistant…" />
          <Button type="submit" disabled={mut.loading || !text.trim()}>Send</Button>
        </form>
      </Card>
    </AppLayout>
  );
}
