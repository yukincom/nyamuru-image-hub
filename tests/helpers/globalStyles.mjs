import {readFileSync} from 'node:fs';

const entry = new URL('../../src/styles/global.css', import.meta.url);

// Source assertions and the legacy viewport fixture use the application's cascade order.
export function readGlobalStyles(source = readFileSync(entry, 'utf8')) {
  return source.replace(/^@import "(\.\/[^"]+\.css)";\r?\n/gm, (_, path) =>
    readFileSync(new URL(path, entry), 'utf8'));
}
