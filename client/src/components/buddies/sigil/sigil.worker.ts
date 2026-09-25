// The sigil render worker (client.ts explains why it exists). One WebGL2
// context lives here for the page's lifetime, as it used to on the main thread.
import type { SigilKind, SigilReply, SigilRequest } from './client';
import { workspaceEmblemGenome } from './emblem';
import { nameGenome } from './genome';
import { renderEmblem, renderSigil } from './render';

const RENDER: Record<SigilKind, (name: string) => Promise<Blob>> = {
  sigil: (name) => renderSigil(nameGenome(name)),
  emblem: (name) => renderEmblem(workspaceEmblemGenome(name)),
};

const scope = self as unknown as {
  onmessage: (event: MessageEvent<SigilRequest>) => void;
  postMessage(reply: SigilReply): void;
};

scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ kind: 'png', id: data.id, png: await RENDER[data.kind](data.name) });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    scope.postMessage({ kind: 'failed', id: data.id, error });
  }
};
