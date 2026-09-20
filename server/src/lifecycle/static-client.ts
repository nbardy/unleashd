import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';

export function registerStaticClient(app: Express, clientDirectory: string): void {
  // Missing API routes must never receive the SPA's successful HTML response.
  app.use('/api', (_request: Request, response: Response) => {
    response.status(404).json({ error: 'API endpoint unavailable on this server.' });
  });
  app.use(express.static(clientDirectory));
  app.get('*', (_request: Request, response: Response) => {
    response.sendFile(path.join(clientDirectory, 'index.html'));
  });
}
