import fs from 'node:fs';
import path from 'node:path';
import type {
  ExecuteCommandHandle,
  ExecuteCommandRequest,
  UnifiedAgentEvent,
} from '@nbardy/agent-cli';
import type { Express, Request, Response } from 'express';

const PALETTE_KEYS = [
  'bgCanvas',
  'bgSurface',
  'textMuted',
  'textSubtle',
  'textBody',
  'textBright',
  'primary',
  'user',
  'ai',
  'success',
  'warning',
  'queue',
  'danger',
  'meta',
] as const;

type Palette = Record<string, string>;

interface StoredPalette extends Palette {
  name: string;
  description: string;
}

export interface PaletteServicePorts {
  startGeneration(request: ExecuteCommandRequest): ExecuteCommandHandle;
  validateProvider(provider: string): void;
  buildPrompt(description: string): string;
}

export interface PaletteServiceOptions {
  directory: string;
  generationTimeoutMs: number;
  debugRawEvents: boolean;
  cwd: string;
  ports: PaletteServicePorts;
}

export interface PaletteService {
  initialize(): Promise<void>;
  registerRoutes(app: Express): void;
}

export function createPaletteService(options: PaletteServiceOptions): PaletteService {
  let cache: Record<string, Palette> = {};
  let nextNumber = 1;

  async function initialize(): Promise<void> {
    cache = {};
    nextNumber = 1;
    try {
      const entries = await fs.promises.readdir(options.directory, { withFileTypes: true });
      const results = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^palette_\d+\.json$/.test(entry.name))
          .map(async (entry) => {
            const match = entry.name.match(/^palette_(\d+)\.json$/);
            if (!match) return null;
            const number = Number.parseInt(match[1], 10);
            try {
              const content = await fs.promises.readFile(
                path.join(options.directory, entry.name),
                'utf8'
              );
              const stored = JSON.parse(content) as StoredPalette;
              const palette: Palette = { name: stored.name };
              for (const key of PALETTE_KEYS) palette[key] = stored[key];
              return { key: `custom_${number}`, number, palette };
            } catch (error) {
              console.error(`Failed to parse palette file ${entry.name}:`, error);
              return null;
            }
          })
      );
      for (const result of results) {
        if (!result) continue;
        cache[result.key] = result.palette;
        nextNumber = Math.max(nextNumber, result.number + 1);
      }
      console.log(
        `Palette cache initialized: ${Object.keys(cache).length} palettes, next number: ${nextNumber}`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('Palettes directory not found, starting with empty cache');
        return;
      }
      throw new Error(`Failed to initialize palette cache: ${(error as Error).message}`);
    }
  }

  function registerRoutes(app: Express): void {
    app.get('/api/custom-palettes', (_request: Request, response: Response) => {
      response.json(cache);
    });

    app.delete('/api/custom-palettes/:key', (request: Request, response: Response) => {
      const { key } = request.params;
      if (!cache[key]) {
        response.status(404).json({ error: 'Palette not found' });
        return;
      }
      const match = key.match(/^custom_(\d+)$/);
      delete cache[key];
      if (match) {
        const filePath = path.join(options.directory, `palette_${match[1]}.json`);
        fs.promises.unlink(filePath).catch((error) => {
          console.error(`[delete-palette] Failed to delete ${filePath}:`, error);
        });
      }
      response.json({ ok: true });
    });

    app.post('/api/generate-palette', (request: Request, response: Response) => {
      const { description } = request.body as { description?: string };
      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        response.status(400).json({ error: 'description is required' });
        return;
      }
      const provider = (request.query.provider as string) || 'claude';
      options.ports.validateProvider(provider);
      const number = nextNumber++;
      void generatePalette(description.trim(), provider, number, response);
    });
  }

  async function generatePalette(
    description: string,
    provider: string,
    number: number,
    response: Response
  ): Promise<void> {
    let stdout = '';
    let stderr = '';
    let responded = false;
    const sendError = (status: number, error: string) => {
      if (responded) return;
      responded = true;
      console.error(`[generate-palette] Error: ${error}`);
      response.status(status).json({ error });
    };
    const turn = options.ports.startGeneration({
      harness: provider as ExecuteCommandRequest['harness'],
      mode: 'single-shot',
      prompt: options.ports.buildPrompt(description),
      cwd: options.cwd,
      yolo: true,
      debugRawEvents: options.debugRawEvents,
    });
    const timeout = setTimeout(() => {
      console.error(
        `[generate-palette] Timed out after ${options.generationTimeoutMs / 1000}s — killing process`
      );
      turn.stop('SIGTERM');
      sendError(504, `Palette generation timed out after ${options.generationTimeoutMs / 1000}s`);
    }, options.generationTimeoutMs);

    try {
      for await (const event of turn.events) {
        collectOutput(event, {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
        });
      }
      const completion = await turn.completed;
      clearTimeout(timeout);
      if (completion.exitCode !== 0 || completion.reason !== 'success') {
        sendError(
          500,
          `${provider} process failed (exit code ${completion.exitCode})${stderr ? `: ${stderr.slice(0, 500)}` : ''}`
        );
        return;
      }

      let parsed: Palette;
      try {
        const json = stdout
          .trim()
          .replace(/^```(?:json)?\s*\n?/, '')
          .replace(/\n?\s*```$/, '');
        parsed = JSON.parse(json) as Palette;
        validatePalette(parsed);
      } catch (error) {
        console.error(
          '[generate-palette] Failed to parse provider response:',
          error,
          'Raw stdout (first 500 chars):',
          stdout.substring(0, 500)
        );
        const message = error instanceof Error ? error.message : 'Unknown parse error';
        sendError(500, `Failed to parse palette from ${provider} response: ${message}`);
        return;
      }

      const stored: StoredPalette = { ...parsed, name: parsed.name, description };
      const key = `custom_${number}`;
      const palette: Palette = { name: parsed.name };
      for (const paletteKey of PALETTE_KEYS) palette[paletteKey] = parsed[paletteKey];
      cache[key] = palette;

      void persistPalette(number, stored, key);
      if (responded) return;
      responded = true;
      console.log(`[generate-palette] Success: "${parsed.name}" -> ${key}`);
      response.json({ key, palette });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[generate-palette] Palette generation failed:', error);
      sendError(
        500,
        `Palette generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function persistPalette(number: number, stored: StoredPalette, key: string): Promise<void> {
    try {
      await fs.promises.mkdir(options.directory, { recursive: true });
      const filePath = path.join(options.directory, `palette_${number}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(stored, null, 2));
      console.log(`[generate-palette] Saved palette to ${filePath}`);
    } catch (error) {
      console.error('[generate-palette] Failed to save palette file:', error);
      delete cache[key];
    }
  }

  return { initialize, registerRoutes };
}

function validatePalette(palette: Palette): void {
  if (!palette.name) throw new Error('Missing "name" field');
  for (const key of PALETTE_KEYS) {
    if (!palette[key] || !/^#[0-9a-fA-F]{6}$/.test(palette[key])) {
      throw new Error(`Missing or invalid hex for key "${key}": ${palette[key]}`);
    }
  }
}

function collectOutput(
  event: UnifiedAgentEvent,
  sinks: { stdout(text: string): void; stderr(text: string): void }
): void {
  switch (event.type) {
    case 'text.delta':
      sinks.stdout(event.text);
      break;
    case 'stderr':
      sinks.stderr(event.text);
      break;
    case 'out_of_tokens':
    case 'error':
      sinks.stderr(`${event.message}\n`);
      break;
    default:
      break;
  }
}
