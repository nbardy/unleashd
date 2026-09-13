import type { Message } from '@unleashd/shared';

/** A readable label for freeform exec calls; the full input stays below it. */
export function execInputPreview(toolCall: Message['toolCall']): string | null {
  if (!toolCall || !['exec', 'functions.exec'].includes(toolCall.name)) return null;
  const input = toolCall.input?.replace(/\s+/g, ' ').trim();
  if (!input) return null;
  return input.length > 120 ? `${input.slice(0, 119)}…` : input;
}
