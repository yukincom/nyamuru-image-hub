#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';


const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(scriptDirectory, '..');
export const NDLOCR_VERSION = '1.2.3';
export const NDLOCR_REPOSITORY = 'https://github.com/ndl-lab/ndlocr-lite.git';
export const MODEL_REVISION = '864c3bfb837a03ecc62557d5152a5ade5566489b';
export const MODEL_URL = `https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2/resolve/${MODEL_REVISION}/model.onnx`;
export const MODEL_SHA256 = '5a5c27646a2ae2e9c85671a1db30504debc9b0b816dc585235435c5e86c2c2b9';


export function visionLayout(visionRoot) {
  const pythonRelativePath = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  return {
    root: visionRoot,
    venv: resolve(visionRoot, '.venv'),
    python: resolve(visionRoot, '.venv', pythonRelativePath),
    ndlocr: resolve(visionRoot, 'ndlocr-lite'),
    model: resolve(visionRoot, 'models', 'rtdetrv4-x-manga109s_v2', 'model.onnx'),
  };
}


export function parseSetupArgs(argv) {
  const options = {
    yes: false,
    help: false,
    root: resolve(process.env.NYAMURU_VISION_ROOT || resolve(REPO_ROOT, '.local-vision')),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--yes' || argument === '-y') {
      options.yes = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--rootには保存先が必要です。');
      options.root = resolve(value);
      index += 1;
    } else {
      throw new Error(`不明なオプションです: ${argument}`);
    }
  }
  return options;
}


function printHelp() {
  console.log(`Nyamuru ローカル画像解析セットアップ

Usage:
  npm run setup:vision
  npm run setup:vision -- --yes
  npm run setup:vision -- --root /path/to/vision-data

Options:
  -y, --yes     確認に同意して非対話で進める
  -h, --help    この説明を表示する
  --root PATH   Git対象外の保存先を変更する`);
}


function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} が終了しました (code=${code ?? 'null'}, signal=${signal ?? 'none'})`));
      }
    });
  });
}


function supportedPython(command) {
  const result = spawnSync(command, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  const [major, minor] = result.stdout.trim().split('.').map(Number);
  return major === 3 && minor >= 10 && minor <= 13;
}


function findPython() {
  const candidates = [
    process.env.PYTHON,
    'python3.13',
    'python3.12',
    'python3.11',
    'python3.10',
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (supportedPython(candidate)) return candidate;
  }
  throw new Error('対応するPython 3.10〜3.13が見つかりません。対応版を導入してから再実行してください。');
}


async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}


async function downloadModel(destination) {
  try {
    await access(destination);
    const existingHash = await sha256(destination);
    if (existingHash !== MODEL_SHA256) {
      throw new Error(`既存モデルのSHA-256が一致しません: ${destination}`);
    }
    console.log('RT-DETRモデル: 検証済みの既存ファイルを使用します。');
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  await rm(partial, { force: true });
  console.log('RT-DETRモデルを公式配布元から取得します（約239MB）...');
  const response = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`モデルを取得できませんでした: HTTP ${response.status}`);
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    const downloadedHash = await sha256(partial);
    if (downloadedHash !== MODEL_SHA256) {
      throw new Error(`ダウンロードしたモデルのSHA-256が一致しません: ${downloadedHash}`);
    }
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}


async function ensureNdlocr(directory) {
  if (existsSync(directory)) {
    if (!existsSync(resolve(directory, 'requirements.txt')) || !existsSync(resolve(directory, 'src', 'model'))) {
      throw new Error(`NDLOCR-Liteの保存先が不完全です: ${directory}`);
    }
    console.log('NDLOCR-Lite: 既存のローカルコピーを使用します。');
    return;
  }
  await mkdir(dirname(directory), { recursive: true });
  console.log(`NDLOCR-Lite v${NDLOCR_VERSION}を公式GitHubから取得します...`);
  await run('git', [
    'clone',
    '--depth', '1',
    '--branch', NDLOCR_VERSION,
    NDLOCR_REPOSITORY,
    directory,
  ]);
}


async function confirmSetup(layout, assumeYes) {
  console.log(`
次の外部コンポーネントを取得します。

- RT-DETRv4-X Manga109-s v2（Apache-2.0、モデル約239MB）
  https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2
- NDLOCR-Lite v${NDLOCR_VERSION}（CC BY 4.0、モデル約150MBを含む）
  https://github.com/ndl-lab/ndlocr-lite
- Python依存パッケージ

保存先: ${layout.root}
この保存先はNyamuruのGit対象外です。
アプリ起動時に自動取得することはありません。`);
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('非対話環境では、内容を確認してから --yes を指定してください。');
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question('\nセットアップを続けますか？ [y/N] ');
  readline.close();
  return /^y(?:es)?$/i.test(answer.trim());
}


async function setup(options) {
  const layout = visionLayout(options.root);
  if (!(await confirmSetup(layout, options.yes))) {
    console.log('セットアップを中止しました。');
    return;
  }

  const systemPython = findPython();
  await mkdir(layout.root, { recursive: true });
  if (!existsSync(layout.python)) {
    console.log('画像解析専用のPython仮想環境を作成します...');
    await run(systemPython, ['-m', 'venv', layout.venv]);
  } else if (!supportedPython(layout.python)) {
    throw new Error(`既存の画像解析環境がPython 3.10〜3.13ではありません: ${layout.python}`);
  }

  await ensureNdlocr(layout.ndlocr);
  console.log('画像解析用Python依存を導入します...');
  await run(layout.python, ['-m', 'pip', 'install', '-r', resolve(REPO_ROOT, 'requirements-vision.txt')]);
  await run(layout.python, ['-m', 'pip', 'install', '-r', resolve(layout.ndlocr, 'requirements.txt')]);
  await downloadModel(layout.model);

  console.log('導入状態を検査します...');
  await run(layout.python, [
    '-c',
    'import cv2, lxml, numpy, onnxruntime; from PIL import Image; print("Python画像解析依存: OK")',
  ]);
  await run(layout.python, [resolve(REPO_ROOT, 'scripts', 'nyamuru_local_bridge.py'), '--check'], {
    env: {
      ...process.env,
      NYAMURU_VISION_ROOT: layout.root,
      NYAMURU_VISION_PYTHON: layout.python,
      NYAMURU_NDLOCR_PYTHON: layout.python,
    },
  });
  console.log('\nセットアップが完了しました。`npm run bridge` でローカル解析を起動できます。');
}


async function main() {
  const options = parseSetupArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await setup(options);
}


const isEntryPoint = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`\nセットアップに失敗しました: ${error.message}`);
    process.exitCode = 1;
  });
}
