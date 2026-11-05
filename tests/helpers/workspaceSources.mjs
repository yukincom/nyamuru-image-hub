import { readFileSync } from 'node:fs';

// Source-based UI tests use the actual App and the specific workflows they exercise.
export function workspaceSources(...workflows) {
  return ['App.tsx', ...workflows.map(name => `workspace/${name}.ts`)]
    .map(path => readFileSync(new URL('../../src/components/' + path, import.meta.url), 'utf8'))
    .join('\n');
}
