import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';

export interface Settings {
  colorPalette: string;
  ignore: string[];
}

const DEFAULT_SETTINGS: Settings = {
  colorPalette: 'solarized',
  ignore: [],
};

export class PersistedServerState {
  private readonly settingsFile: string;
  private settings: Settings | null = null;

  constructor(
    private readonly dataDirectory: string,
    private readonly applyIgnorePatterns: (patterns: string[]) => void
  ) {
    this.settingsFile = path.join(dataDirectory, 'settings.json');
  }

  async initialize(): Promise<void> {
    await this.initializeSettings();
  }

  getSettings(): Settings {
    if (!this.settings) {
      throw new Error('Settings cache not initialized — call initialize() at startup');
    }
    return this.settings;
  }

  registerRoutes(app: Express): void {
    app.get('/api/settings', (_req: Request, res: Response) => {
      res.json(this.getSettings());
    });
    app.post('/api/settings', (req: Request, res: Response) => {
      const settings = { ...this.getSettings(), ...req.body };
      this.writeSettings(settings);
      res.json(settings);
    });
  }

  private async initializeSettings(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.settingsFile, 'utf-8');
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      console.log('Settings loaded from disk');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to load settings: ${(error as Error).message}`);
      }
      this.settings = { ...DEFAULT_SETTINGS };
      console.log('Settings file not found, using defaults');
    }
    this.applyIgnorePatterns(this.getSettings().ignore ?? []);
  }

  private writeSettings(settings: Settings): void {
    this.settings = settings;
    this.applyIgnorePatterns(settings.ignore ?? []);
    void fs.promises
      .mkdir(this.dataDirectory, { recursive: true })
      .then(() => fs.promises.writeFile(this.settingsFile, JSON.stringify(settings, null, 2)))
      .catch((error) => console.error('Error saving settings to disk:', error));
  }
}
