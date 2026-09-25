// The sigil render worker (client.ts explains why it exists). One WebGL2
// context lives here for the page's lifetime, as it used to on the main thread.
import type { SigilReply, SigilRequest } from './client';
import { nameGenome } from './genome';
import { renderSigil } from './render';

const scope = self as unknown as {
  onmessage: (event: MessageEvent<SigilRequest>) => void;
  postMessage(reply: SigilReply): void;
};

scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ kind: 'png', id: data.id, png: await renderSigil(nameGenome(data.name)) });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    scope.postMessage({ kind: 'failed', id: data.id, error });
  }
};
