import type { TranscriptEntry } from '../types.js';

// Normalizes OpenCode v2 messages into transcript entries (specification 4.3). User and assistant
// text is kept up to a bound; a tool part keeps only its name and state, never its input or
// output, which can hold file contents and secrets. Reasoning and unknown parts are left out.

export const maxEntryText = 8 * 1024;

interface Part {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  tool?: unknown;
  state?: { status?: unknown } | null;
}

interface Message {
  id: string;
  type: string;
  outcome?: unknown;
  text?: unknown;
  content?: unknown;
}

const bounded = (text: string) =>
  text.length > maxEntryText ? `${text.slice(0, maxEntryText)}\n[… shortened by Shift]` : text;

const textOf = (message: Message): string => {
  if (typeof message.text === 'string') return message.text;
  const parts = Array.isArray(message.content) ? (message.content as Part[]) : [];
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
};

export function normalizeTranscript(messages: readonly Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let turn: string | null = null;
  for (const message of messages) {
    if (message.type === 'user') {
      turn = message.id;
      entries.push({
        sourceKey: message.id,
        turnMessageId: turn,
        kind: 'user',
        text: bounded(textOf(message)),
      });
    } else if (message.type === 'assistant') {
      const parts = Array.isArray(message.content) ? (message.content as Part[]) : [];
      parts.forEach((part, index) => {
        const sourceKey = `${message.id}:${index}`;
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
          entries.push({
            sourceKey,
            turnMessageId: turn,
            kind: 'assistant',
            text: bounded(part.text),
          });
        else if (part?.type === 'tool') {
          const tool =
            typeof part.name === 'string'
              ? part.name
              : typeof part.tool === 'string'
                ? part.tool
                : 'tool';
          const status = typeof part.state?.status === 'string' ? part.state.status : 'unknown';
          entries.push({ sourceKey, turnMessageId: turn, kind: 'tool', tool, status });
        }
      });
    } else if (message.type === 'idle' && typeof message.outcome === 'string') {
      entries.push({
        sourceKey: message.id,
        turnMessageId: turn,
        kind: 'status',
        status: message.outcome,
      });
    }
  }
  return entries;
}
