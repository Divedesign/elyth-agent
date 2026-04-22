import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SYSTEM_BASE = path.join(__dirname, 'system-base.md');
const DEV_BASE = path.join(__dirname, 'dev-base.md');

function readPersonaAndRules(personaPath: string, rulesPath: string): string[] {
  const persona = fs.readFileSync(personaPath, 'utf-8').trim();
  const parts = [persona];
  if (fs.existsSync(rulesPath)) {
    const rules = fs.readFileSync(rulesPath, 'utf-8').trim();
    if (rules) parts.push(rules);
  }
  return parts;
}

export function buildPrompt(
  personaPath: string,
  rulesPath: string,
  systemBasePath?: string,
): string {
  const effectiveSystemBase = systemBasePath ?? DEFAULT_SYSTEM_BASE;
  const parts = readPersonaAndRules(personaPath, rulesPath);
  parts.push(fs.readFileSync(effectiveSystemBase, 'utf-8').trim());
  return parts.join('\n\n---\n\n');
}

export function buildDevPrompt(personaPath: string, rulesPath: string): string {
  const parts = readPersonaAndRules(personaPath, rulesPath);
  parts.push(fs.readFileSync(DEV_BASE, 'utf-8').trim());
  return parts.join('\n\n---\n\n');
}
