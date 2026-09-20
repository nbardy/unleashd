import { OOMPA_RUN_TOOL_FRAGMENT_RE } from './structured-message-segments';

export const TOOL_LINE_RE = /^(?:📖|✍️|✏️|⚡|💻|📂|🔍|🌐|📓|📝|🔧|▶️|📦|🔀|📁|🔒|🗑️|❌)\s+\S/;

type ToolActivitySegment =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; content: string; count: number };

/** Live providers embed tool summaries in prose; saved history stores separate messages. */
export function splitToolActivity(content: string): ToolActivitySegment[] {
  const segments: ToolActivitySegment[] = [];
  let text: string[] = [];
  let tools: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flushText = () => {
    if (text.some((line) => line.trim())) segments.push({ type: 'text', content: text.join('\n') });
    text = [];
  };
  const flushTools = () => {
    if (tools.length) {
      segments.push({ type: 'tool_calls', content: tools.join('\n'), count: tools.length });
    }
    tools = [];
  };

  for (const line of content.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
    }
    if (!fence && TOOL_LINE_RE.test(line) && !OOMPA_RUN_TOOL_FRAGMENT_RE.test(line)) {
      flushText();
      tools.push(line);
    } else if (line.trim() || !tools.length) {
      // Blank separators between streamed calls do not split one activity run.
      flushTools();
      text.push(line);
    }
  }
  flushTools();
  flushText();
  return segments;
}
