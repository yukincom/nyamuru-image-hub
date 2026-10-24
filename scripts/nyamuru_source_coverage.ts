#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { link, open, readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMangaYaml, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import {
  buildSourceCoverageReport,
  MAX_REPORT_BYTES,
  MAX_SOURCE_BYTES,
} from '../src/lib/sourceCoverage.ts';

const MAX_OMNY_BYTES = 5 * 1024 * 1024;

interface CliOptions {
  sourcePath: string;
  omnyPath: string;
  outputPath: string | null;
  sourceRelativePath: string | null;
}

function usage(): string {
  return [
    'Nyamuru source coverage v1',
    '',
    'Usage:',
    '  npm run source:coverage -- --source episode.md --omny story.omny.yaml [--output report.json]',
    '',
    'Options:',
    '  --source PATH               UTF-8 Markdown/text source (max 5 MiB)',
    '  --omny PATH                 Current story OMNY YAML (max 5 MiB)',
    '  --output PATH               Write once; an existing file is never overwritten',
    '  --source-relative-path PATH Workspace-relative source identity stored in the report',
    '  --help                      Show this help',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): CliOptions | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--source', '--omny', '--output', '--source-relative-path'].includes(key)) {
      throw new Error(`\u4e0d\u660e\u306a\u5f15\u6570\u3067\u3059: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key}\u306bpath\u304c\u5fc5\u8981\u3067\u3059`);
    if (values.has(key)) throw new Error(`${key}\u304c\u91cd\u8907\u3057\u3066\u3044\u307e\u3059`);
    values.set(key, value);
    index += 1;
  }
  const sourcePath = values.get('--source');
  const omnyPath = values.get('--omny');
  if (!sourcePath || !omnyPath) throw new Error('--source\u3068--omny\u306f\u5fc5\u9808\u3067\u3059');
  return {
    sourcePath: resolve(sourcePath),
    omnyPath: resolve(omnyPath),
    outputPath: values.has('--output') ? resolve(values.get('--output')!) : null,
    sourceRelativePath: values.get('--source-relative-path') ?? null,
  };
}

async function readBoundedUtf8(path: string, maximum: number, label: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label}\u306f\u901a\u5e38\u30d5\u30a1\u30a4\u30eb\u3092\u6307\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044`);
  if (metadata.size > maximum) throw new Error(`${label}\u304c${Math.floor(maximum / 1024 / 1024)}MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
  const bytes = await readFile(path);
  if (bytes.byteLength > maximum) throw new Error(`${label}\u304c${Math.floor(maximum / 1024 / 1024)}MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function checkedReportOutput(report: unknown): string {
  const output = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(output, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error('coverage reportの実出力が8MiBを超えています');
  }
  return output;
}

async function writeExclusiveReport(outputPath: string, output: string): Promise<void> {
  const outputDirectory = dirname(outputPath);
  const temporaryPath = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(output, { encoding: 'utf8' });
    await handle.sync();
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== Buffer.byteLength(output, 'utf8')) {
      throw new Error('coverage reportのstaging fileを検証できません');
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = null;
    await unlinkIfPresent(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close();
  }

  const directoryHandle = await open(outputDirectory, 'r').catch(async (error) => {
    await unlinkIfPresent(temporaryPath).catch(() => undefined);
    throw error;
  });
  let published = false;
  try {
    await link(temporaryPath, outputPath);
    published = true;
    await directoryHandle.sync();
  } catch (error) {
    if (published) {
      try {
        const [temporaryMetadata, outputMetadata] = await Promise.all([stat(temporaryPath), stat(outputPath)]);
        if (temporaryMetadata.dev === outputMetadata.dev && temporaryMetadata.ino === outputMetadata.ino) {
          await unlinkIfPresent(outputPath);
        }
      } catch { /* leave a path whose identity is no longer ours */ }
    }
    await unlinkIfPresent(temporaryPath).catch(() => undefined);
    await directoryHandle.sync().catch(() => undefined);
    throw error;
  } finally {
    await directoryHandle.close();
  }
  await unlinkIfPresent(temporaryPath).catch(() => undefined);
  const cleanupDirectory = await open(outputDirectory, 'r').catch(() => null);
  await cleanupDirectory?.sync().catch(() => undefined);
  await cleanupDirectory?.close().catch(() => undefined);
}

export async function runSourceCoverageCli(argv: readonly string[]): Promise<number> {
  const options = parseArguments(argv);
  if (!options) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const [sourceText, omnyText] = await Promise.all([
    readBoundedUtf8(options.sourcePath, MAX_SOURCE_BYTES, '\u539f\u4f5c\u30fb\u53f0\u672c'),
    readBoundedUtf8(options.omnyPath, MAX_OMNY_BYTES, 'OMNY'),
  ]);
  if (!['.md', '.markdown', '.txt', '.text'].includes(extname(options.sourcePath).toLowerCase())) {
    throw new Error('原作・台本は.md/.markdown/.txt/.textを指定してください');
  }
  const document = parseMangaYaml(omnyText);
  const report = await buildSourceCoverageReport({
    fileName: basename(options.sourcePath),
    relativePath: options.sourceRelativePath,
    text: sourceText,
  }, document, { omnyYaml: toSeparatedMangaYaml(document) });
  const output = checkedReportOutput(report);
  if (!options.outputPath) {
    process.stdout.write(output);
    return 0;
  }
  await writeExclusiveReport(options.outputPath, output);
  process.stdout.write(`${options.outputPath}\n`);
  return 0;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  runSourceCoverageCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`source coverage\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
