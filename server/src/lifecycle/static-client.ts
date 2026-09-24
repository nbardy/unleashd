import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';

// Vite writes every build output with a content hash in its name under
// `assets/`, so a URL there names one immutable byte sequence forever and the
// browser never needs to revalidate it. Everything else (index.html, the
// manifest, icons) keeps its name across builds and must revalidate, or a
// deploy leaves phones running the previous shell pointing at chunks that no
// longer exist. Before 2026-09-25 express.static sent `max-age=0` for both.
const HASHED_ASSET_CACHE = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE = 'no-cache';

export function registerStaticClient(app: Express, clientDirectory: string): void {
  const assetsDirectory = path.join(clientDirectory, 'assets') + path.sep;
  // Missing API routes must never receive the SPA's successful HTML response.
  app.use('/api', (_request: Request, response: Response) => {
    response.status(404).json({ error: 'API endpoint unavailable on this server.' });
  });
  app.use(
    express.static(clientDirectory, {
      setHeaders: (response, filePath) => {
        response.setHeader(
          'Cache-Control',
          filePath.startsWith(assetsDirectory) ? HASHED_ASSET_CACHE : REVALIDATE_CACHE
        );
      },
    })
  );
  // A hashed chunk from a previous build is gone after a deploy. Answering its
  // URL with index.html (200, text/html) makes the stale page fail with a
  // MIME-type error instead of a clean 404 the loader can report.
  app.use('/assets', (_request: Request, response: Response) => {
    response.status(404).end();
  });
  app.get('*', (_request: Request, response: Response) => {
    response.sendFile(path.join(clientDirectory, 'index.html'), {
      headers: { 'Cache-Control': REVALIDATE_CACHE },
    });
  });
}
