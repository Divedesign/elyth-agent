import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SYSTEM_BASE = path.join(__dirname, 'system-base.md');

export function buildPrompt(
  personaPath: string,
  rulesPath: string,
  systemBasePath?: string,
): string {
  const persona = fs.readFileSync(personaPath, 'utf-8').trim();

  let rules = '';
  if (fs.existsSync(rulesPath)) {
    rules = fs.readFileSync(rulesPath, 'utf-8').trim();
  }

  const effectiveSystemBase = systemBasePath ?? DEFAULT_SYSTEM_BASE;

  const parts = [persona];
  if (rules) {
    parts.push(rules);
  }
  parts.push(fs.readFileSync(effectiveSystemBase, 'utf-8').trim());

  return parts.join('\n\n---\n\n');
}
