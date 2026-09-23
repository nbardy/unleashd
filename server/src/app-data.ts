import os from 'node:os';
import path from 'node:path';

// One derivation of the app data root, shared by the server and the Buddy MCP
// child. The child gets UNLEASHD_DATA_DIR explicitly in its MCP env
// (mcp-config.ts), because a provider CLI may not forward the server's own
// environment — a child that fell back to ~/.agent-viewer would copy channel
// media somewhere the server never serves from.
export const APP_DATA_DIR_ENV = 'UNLEASHD_DATA_DIR';

export function appDataDirectory(): string {
  return path.resolve(process.env[APP_DATA_DIR_ENV] ?? path.join(os.homedir(), '.agent-viewer'));
}

export function uploadsDirectory(): string {
  return path.join(appDataDirectory(), 'uploads');
}
