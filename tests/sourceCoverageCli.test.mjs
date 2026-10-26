import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = resolve('scripts/nyamuru_source_coverage.ts');
const omny = resolve('tests/fixtures/source-coverage.yaml');

function run(args, execArgs = []) {
  return spawnSync(process.execPath, [...execArgs, '--no-warnings', '--experimental-strip-types', cli, ...args], {
    encoding: 'utf8',
  });
}

test('CLIはstdoutへstrict reportを出しnetworkやLLMを要求しない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nyamuru-coverage-cli-'));
  try {
    const source = join(directory, 'episode.md');
    await writeFile(source, 'SOURCE_TEXT_A\n', 'utf8');
    const result = run(['--source', source, '--omny', omny, '--source-relative-path', 'origin_data/episode.md']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema_name, 'nyamuru-source-coverage');
    assert.equal(report.source.relative_path, 'origin_data/episode.md');
    assert.equal(report.scan_complete, true);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 8 * 1024 * 1024);
    assert.ok(!result.stdout.includes('\n  "'), 'CLI report must use the size-checked compact representation');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI outputはexclusive作成し既存fileを上書きしない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nyamuru-coverage-cli-'));
  try {
    const source = join(directory, 'episode.txt');
    const output = join(directory, 'report.json');
    await writeFile(source, '未知の原文\n', 'utf8');
    const first = run(['--source', source, '--omny', omny, '--output', output]);
    assert.equal(first.status, 0, first.stderr);
    const original = await readFile(output, 'utf8');
    const second = run(['--source', source, '--omny', omny, '--output', output]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /exist|\u5b58\u5728|EEXIST/i);
    assert.equal(await readFile(output, 'utf8'), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI write失敗時はpartial finalを残さず同じpathへ再試行できる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nyamuru-coverage-cli-'));
  try {
    const source = join(directory, 'episode.txt');
    const output = join(directory, 'report.json');
    await writeFile(source, '未知の原文\n', 'utf8');
    const preloadSource = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const originalOpen = fs.promises.open.bind(fs.promises);
      fs.promises.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (String(args[0]).includes('report.json')) {
          const originalWriteFile = handle.writeFile.bind(handle);
          handle.writeFile = async () => {
            await originalWriteFile('partial');
            throw new Error('INJECTED_COVERAGE_WRITE_FAILURE');
          };
        }
        return handle;
      };
      syncBuiltinESMExports();
    `;
    const preload = `data:text/javascript,${encodeURIComponent(preloadSource)}`;
    const failed = run(['--source', source, '--omny', omny, '--output', output], ['--import', preload]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /INJECTED_COVERAGE_WRITE_FAILURE/);
    assert.equal(failed.stdout, '');
    await assert.rejects(() => readFile(output), { code: 'ENOENT' });
    assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.tmp')));

    const retried = run(['--source', source, '--omny', omny, '--output', output]);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).schema_name, 'nyamuru-source-coverage');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLIはworkspace外を表すrelative pathを拒否する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nyamuru-coverage-cli-'));
  try {
    const source = join(directory, 'episode.txt');
    await writeFile(source, '本文\n', 'utf8');
    const result = run(['--source', source, '--omny', omny, '--source-relative-path', '../outside.txt']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /relative|\u76f8\u5bfe|path/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
