import fs from 'node:fs';

export function buildPrompt(
  personaPath: string,
  rulesPath: string,
  systemBasePath: string,
): string {
  const persona = fs.readFileSync(personaPath, 'utf-8').trim();

  let rules = '';
  if (fs.existsSync(rulesPath)) {
    rules = fs.readFileSync(rulesPath, 'utf-8').trim();
  }

  const systemBase = fs.readFileSync(systemBasePath, 'utf-8').trim();

  const parts = [persona];
  if (rules) {
    parts.push(rules);
  }
  parts.push(systemBase);

  return parts.join('\n\n---\n\n');
}
