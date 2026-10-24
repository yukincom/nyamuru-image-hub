import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  BABERU_FILES,
  BABERU_REVISION,
  MODEL_REVISION,
  MODEL_SHA256,
  WD_EXPRESSION_FILES,
  WD_EXPRESSION_REVISION,
  parseSetupArgs,
  PIP_BOOTSTRAP_REQUIREMENT,
  setup,
  updatePythonCertificates,
  visionLayout,
} from '../scripts/setup-local-vision.mjs';


test('vision setup keeps RT-DETR and Baberu under one ignored root', () => {
  const root = resolve('/tmp/nyamuru-vision-test');
  const layout = visionLayout(root);
  assert.equal(layout.root, root);
  assert.ok(layout.model.startsWith(root));
  assert.ok(layout.baberu.startsWith(root));
  assert.ok(layout.wdExpression.startsWith(root));
  assert.match(layout.python, /\.venv/);
});


function certificateRuntime(pipCurrent = false, certifiCurrent = false) {
  const calls = [];
  const status = { pip: pipCurrent ? '27.0' : '24.0', certifi: certifiCurrent ? '2027.1.1' : '2026.7.22', pipCurrent, certifiCurrent };
  return {
    calls, status,
    inspect: () => ({ ...status }),
    execute: async (python, args) => {
      calls.push({ python, args });
      if (args.includes(PIP_BOOTSTRAP_REQUIREMENT)) Object.assign(status, { pip: '26.2.2', pipCurrent: true });
      else Object.assign(status, { certifi: '2026.10.19', certifiCurrent: true });
    },
  };
}


test('old environments bootstrap pinned pip before updating certifi without other dependencies', async () => {
  const runtime = certificateRuntime();
  const result = await updatePythonCertificates('/existing/python', runtime);
  assert.equal(runtime.calls.length, 2);
  assert.ok(runtime.calls.every(({ python, args }) => python === '/existing/python' && args.includes('--no-deps')));
  const bootstrap = runtime.calls[0].args;
  assert.ok(bootstrap.includes('--no-index'));
  assert.ok(bootstrap.includes('--disable-pip-version-check'));
  assert.ok(bootstrap.includes('--isolated'));
  assert.equal(bootstrap.at(-1), 'pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70');
  assert.equal(runtime.calls[1].args.at(-1), 'certifi>=2026.10.19');
  assert.equal(result.pip, '26.2.2');
  assert.equal(result.certifi, '2026.10.19');
});


test('failed pip bootstrap does not proceed to an index or certifi install', async () => {
  const runtime = certificateRuntime();
  runtime.execute = async (...call) => { runtime.calls.push(call); throw new Error('wheel checksum mismatch'); };
  await assert.rejects(updatePythonCertificates('/existing/python', runtime), /checksum mismatch/);
  assert.equal(runtime.calls.length, 1);
});


test('a bootstrap that leaves old pip cannot proceed to certifi', async () => {
  const runtime = certificateRuntime();
  runtime.execute = async (...call) => { runtime.calls.push(call); };
  await assert.rejects(updatePythonCertificates('/existing/python', runtime), /pip 26.2.2/);
  assert.equal(runtime.calls.length, 1);
});


test('already current packages are preserved without downloads or downgrades', async () => {
  const runtime = certificateRuntime(true, true);
  const result = await updatePythonCertificates('/existing/python', runtime);
  assert.equal(runtime.calls.length, 0);
  assert.equal(result.pip, '27.0');
  assert.equal(result.certifi, '2027.1.1');
});


test('current pip only updates an outdated certifi', async () => {
  const runtime = certificateRuntime(true, false);
  await updatePythonCertificates('/existing/python', runtime);
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].args.at(-1), 'certifi>=2026.10.19');
});


test('an ineffective certifi update reports failure', async () => {
  const runtime = certificateRuntime(true, false);
  runtime.execute = async (...call) => { runtime.calls.push(call); };
  await assert.rejects(updatePythonCertificates('/existing/python', runtime), /更新後のバージョン/);
});


test('certificate-only setup respects the selected root and does not create models or dependencies', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'nyamuru-certificates-'));
  try {
    const layout = visionLayout(root);
    mkdirSync(resolve(layout.python, '..'), { recursive: true });
    writeFileSync(layout.python, 'existing environment marker');
    const calls = [];
    await setup(parseSetupArgs(['--yes', '--update-certificates', '--root', root]), {
      updateCertificates: async (python) => calls.push(python),
    });
    assert.deepEqual(calls, [layout.python]);
    assert.deepEqual(readdirSync(root), ['.venv']);
    assert.equal(readFileSync(layout.python, 'utf8'), 'existing environment marker');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('certificate-only setup refuses a missing environment without creating it', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'nyamuru-certificates-'));
  try {
    const target = resolve(root, 'missing');
    await assert.rejects(setup(parseSetupArgs(['--yes', '--update-certificates', '--root', target])), /既存Python環境が見つかりません/);
    assert.equal(existsSync(target), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('normal setup stops before dependencies and models when certificate bootstrap fails', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'nyamuru-setup-order-'));
  try {
    const layout = visionLayout(root);
    mkdirSync(resolve(layout.python, '..'), { recursive: true });
    // Only the supported-Python probe may run; any accidental pip invocation fails.
    writeFileSync(layout.python, '#!/usr/bin/env node\nif (process.argv[2] !== "-c") process.exit(91);\nconsole.log("3.11");\n', { mode: 0o755 });
    let reachedBootstrap = false;
    await assert.rejects(setup(parseSetupArgs(['--yes', '--root', root]), {
      updateCertificates: async (python) => {
        assert.equal(python, layout.python);
        reachedBootstrap = true;
        throw new Error('bootstrap rejected fixture wheel');
      },
    }), /bootstrap rejected fixture wheel/);
    assert.equal(reachedBootstrap, true);
    assert.deepEqual(readdirSync(root), ['.venv']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('normal setup stops after a failed classifier download before installing dependencies', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'nyamuru-classifier-check-'));
  try {
    const layout = visionLayout(root);
    mkdirSync(resolve(layout.python, '..'), { recursive: true });
    writeFileSync(layout.python, `#!/usr/bin/env node
if (process.argv[2] === '-c') { console.log('3.11'); process.exit(0); }
if (process.argv[2].endsWith('/install_voice_intent.py') && process.argv[3] === '--download') process.exit(93);
process.exit(96);
`, { mode: 0o755 });
    await assert.rejects(setup(parseSetupArgs(['--yes', '--root', root]), {
      updateCertificates: async () => {},
    }), /code=93/);
    assert.deepEqual(readdirSync(root), ['.venv']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('setup options require an explicit value for a custom root', () => {
  assert.throws(() => parseSetupArgs(['--root']), /保存先/);
  const options = parseSetupArgs(['--yes', '--root', './vision-data']);
  assert.equal(options.yes, true);
  assert.equal(options.root, resolve('./vision-data'));
});


test('model download is pinned and verified', () => {
  assert.match(MODEL_REVISION, /^[0-9a-f]{40}$/);
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/);
  assert.match(BABERU_REVISION, /^[0-9a-f]{40}$/);
  assert.ok(BABERU_FILES.length >= 6);
  assert.ok(BABERU_FILES.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.match(WD_EXPRESSION_REVISION, /^[0-9a-f]{40}$/);
  assert.equal(WD_EXPRESSION_FILES.length, 3);
  assert.ok(WD_EXPRESSION_FILES.some((file) => file.path === 'README.md'));
  assert.ok(WD_EXPRESSION_FILES.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
  const wdRuntime = readFileSync(new URL('../scripts/local_wd_expression_tagger.py', import.meta.url), 'utf8');
  assert.ok(wdRuntime.includes(WD_EXPRESSION_REVISION));
  for (const file of WD_EXPRESSION_FILES.filter((entry) => entry.path !== 'README.md')) {
    assert.ok(wdRuntime.includes(file.sha256), `${file.path}のruntime provenance SHAがsetupと一致しません`);
  }
});
