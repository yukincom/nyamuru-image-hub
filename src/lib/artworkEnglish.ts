import translations from '../content/artwork-translations.json' with { type: 'json' };
import formats from '../content/manga-formats.json' with { type: 'json' };

type Language = 'ja' | 'en';
interface Translation { ja: string; en: string }
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcher(entry: Translation, from: Language, to: Language) {
  const names: string[] = [];
  const chunks = entry[from].split(/(\{\{[A-Za-z][A-Za-z0-9]*\}\})/);
  const pattern = chunks.map(chunk => {
    if (!chunk.startsWith('{{')) return escapePattern(chunk);
    names.push(chunk.slice(2, -2));
    return '(\\d+(?:\\.\\d+)?)';
  }).join('');
  return { pattern: new RegExp(`^${pattern}$`), names, target: entry[to] };
}

const english = translations.map(entry => matcher(entry, 'ja', 'en'));
const editable = translations.map(entry => matcher(entry, 'en', 'ja'));

/** Only reviewed, complete built-in lines are translated; arbitrary author text is not guessed. */
function translate(text: string, candidates: ReturnType<typeof matcher>[]): string {
  return text.split('\n').map(line => {
    const body = line.trim();
    if (!body) return line;
    for (const { pattern, names, target } of candidates) {
      const match = body.match(pattern);
      if (!match) continue;
      const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
      // Keep layout indentation, blank lines and the original numbers, including repeated fields.
      return line.slice(0, line.length - line.trimStart().length)
        + target.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, name: string) => values[name])
        + line.slice(line.trimEnd().length);
    }
    return line;
  }).join('\n');
}

export const toEnglishArtworkText = (text: string): string => translate(text, english);
/** Import English exports into the existing editable representation without losing numeric controls. */
export const toEditableArtworkText = (text: string): string => translate(text, editable);

export const toEnglishMangaFormat = (format: string): string => formats.find(({ ja }) => ja === format)?.en ?? format;
export const toEditableMangaFormat = (format: string): string => formats.find(({ en }) => en === format)?.ja ?? format;
