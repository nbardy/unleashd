import type { Provider as ProviderName } from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import { getProvider, providers } from '../providers';
import { createProviderCatalog } from '../providers/catalog-service';

export function registerCoreRoutes(app: Express, getAuditResults: () => unknown): void {
  app.get('/api/audit', (_request: Request, response: Response) => {
    response.json(getAuditResults());
  });

  app.get('/api/provider-catalog', (_request: Request, response: Response) => {
    response.json(createProviderCatalog());
  });

  app.get('/api/models', (request: Request, response: Response) => {
    // Defaults to 'claude' when ?provider= is omitted; callers should send it explicitly.
    const providerName = (request.query.provider as string) || 'claude';
    if (!(providerName in providers)) {
      response.status(400).json({
        error: `Invalid provider: ${providerName}. Must be one of: ${Object.keys(providers).join(', ')}.`,
      });
      return;
    }
    response.json(getProvider(providerName as ProviderName).listModels());
  });
}
