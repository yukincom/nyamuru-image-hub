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
export const PIP_MINIMUM = '26.2.2';
export const CERTIFI_MINIMUM = '2026.10.19';
// Python's official incident advisory pins the first download independently of old CA bundles.
export const PIP_BOOTSTRAP_REQUIREMENT = 'pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70';
export const MODEL_REVISION = '864c3bfb837a03ecc62557d5152a5ade5566489b';
export const MODEL_URL = `https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2/resolve/${MODEL_REVISION}/model.onnx`;
export const MODEL_SHA256 = '5a5c27646a2ae2e9c85671a1db30504debc9b0b816dc585235435c5e86c2c2b9';
export const BABERU_REVISION = 'd9cc13153e9a1cd8fdfa3b7b1cc329da2020aeae';
export const BABERU_REPOSITORY = 'https://huggingface.co/genshiai-daichi/baberu-ocr';
export const BABERU_FILES = [
  { path: 'onnx/vision_int4.onnx', sha256: '9526bcf99eb8de805df7ea2f66b385cfcbcb5dff0e99a5dcfb02bdb2d4182bde' },
  { path: 'onnx/decoder_prefill_int8.onnx', sha256: '4f8d28d4e5e8b6c7f3a4510663aa0a9199a7eec06bcb1dc0afb3ca571494e97f' },
  { path: 'onnx/decoder_step_int8.onnx', sha256: '2eaf792ca70b67e55140ef0bcfbfc3c3b1e07d72ca277dcc46aae27c81f27ac8' },
  { path: 'onnx_infer.py', sha256: '1a7737e6583715be2359807bda92f53ea16091ed186569c7a85f8b82d294373f' },
  { path: 'tokenizer/tokenizer_config.json', sha256: 'c6c8004b1d310bd7c56455387c25cdf4da28594bbd5713aaa3fddfd5eac8f483' },
  { path: 'tokenizer/vocab.json', sha256: '681de4eb83154a397af49e2ddae4705041b12a22e16fe00860b829e889e5f47c' },
  { path: 'LICENSE', sha256: '186332043e82fcfdbeb0b8e0e8d77b63d97ffa3dd9d91ccf7cef1377d8ab345b' },
];
export const WD_EXPRESSION_REVISION = '7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f';
export const WD_EXPRESSION_REPOSITORY = 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3';
export const WD_EXPRESSION_FILES = [
  { path: 'model.onnx', sha256: '35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6' },
  { path: 'selected_tags.csv', sha256: '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217' },
  { path: 'README.md', sha256: 'edad0e80dcbebef5ae595387ff33d410c86589ae99e115670f6abea8888bc613' },
];


export function visionLayout(visionRoot) {
  const pythonRelativePath = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  return {
    root: visionRoot,
    venv: resolve(visionRoot, '.venv'),
    python: resolve(visionRoot, '.venv', pythonRelativePath),
    model: resolve(visionRoot, 'models', 'rtdetrv4-x-manga109s_v2', 'model.onnx'),
    baberu: resolve(visionRoot, 'models', 'baberu-ocr'),
    wdExpression: resolve(visionRoot, 'models', 'wd-vit-tagger-v3'),
  };
}


export function parseSetupArgs(argv) {
  const options = {
    yes: false,
    help: false,
    updateCertificates: false,
    root: resolve(process.env.NYAMURU_VISION_ROOT || resolve(REPO_ROOT, '.local-vision')),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--yes' || argument === '-y') {
      options.yes = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--update-certificates') {
      options.updateCertificates = true;
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
  npm run setup:vision -- --update-certificates

Options:
  -y, --yes     確認に同意して非対話で進める
  -h, --help    この説明を表示する
  --root PATH   Git対象外の保存先を変更する
  --update-certificates  既存のROOT/.venvのpip・certifiだけを更新する`);
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


function certificatePackageStatus(python) {
  const result = spawnSync(python, ['-I', '-c', `
import json
from importlib.metadata import version, PackageNotFoundError
from pip._vendor.packaging.version import Version
def installed(name):
    try: return version(name)
    except PackageNotFoundError: return None
pip = installed('pip')
certifi = installed('certifi')
print(json.dumps({'pip': pip, 'certifi': certifi,
    'pipCurrent': bool(pip and Version(pip) >= Version('${PIP_MINIMUM}')),
    'certifiCurrent': bool(certifi and Version(certifi) >= Version('${CERTIFI_MINIMUM}'))}))
`], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pip・certifiの状態を取得できません: ${python}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}


export async function updatePythonCertificates(python, { inspect = certificatePackageStatus, execute = run } = {}) {
  let status = inspect(python);
  const pipArgs = ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check'];
  if (!status.pipCurrent) {
    await execute(python, [...pipArgs, 'install', '--no-index', '--no-deps', '--no-cache-dir', PIP_BOOTSTRAP_REQUIREMENT]);
    status = inspect(python);
    if (!status.pipCurrent) throw new Error(`pip ${PIP_MINIMUM}以上への更新を確認できませんでした。`);
  }
  if (!status.certifiCurrent) {
    await execute(python, [...pipArgs, 'install', '--no-deps', '--only-binary=:all:', `certifi>=${CERTIFI_MINIMUM}`]);
  }
  status = inspect(python);
  if (!status.pipCurrent || !status.certifiCurrent) {
    throw new Error('pip・certifiの更新後のバージョンを確認できませんでした。');
  }
  console.log(`Python証明書パッケージ: pip ${status.pip}, certifi ${status.certifi}`);
  return status;
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


async function downloadVerifiedFile(url, destination, expectedHash, label) {
  try {
    await access(destination);
    const existingHash = await sha256(destination);
    if (existingHash !== expectedHash) throw new Error(`既存ファイルのSHA-256が一致しません: ${destination}`);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  await rm(partial, { force: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${label}を取得できませんでした: HTTP ${response.status}`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    const downloadedHash = await sha256(partial);
    if (downloadedHash !== expectedHash) throw new Error(`${label}のSHA-256が一致しません: ${downloadedHash}`);
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}


async function downloadBaberuModel(directory) {
  console.log('Baberu OCRの小型ONNXモデルを検査・取得します（約116MB）...');
  for (const file of BABERU_FILES) {
    await downloadVerifiedFile(
      `${BABERU_REPOSITORY}/resolve/${BABERU_REVISION}/${file.path}`,
      resolve(directory, file.path),
      file.sha256,
      `Baberu OCR ${file.path}`,
    );
  }
}


async function downloadWdExpressionModel(directory) {
  console.log('WD Taggerの表情補助モデルを検査・取得します（約379MB）...');
  for (const file of WD_EXPRESSION_FILES) {
    await downloadVerifiedFile(
      `${WD_EXPRESSION_REPOSITORY}/resolve/${WD_EXPRESSION_REVISION}/${file.path}`,
      resolve(directory, file.path),
      file.sha256,
      `WD Tagger ${file.path}`,
    );
  }
}


async function confirmSetup(layout, assumeYes, updateCertificates) {
  console.log(updateCertificates ? `
既存Python環境のpip・certifiを更新します。

対象: ${layout.python}
最低版: pip ${PIP_MINIMUM}, certifi ${CERTIFI_MINIMUM}
取得量は最大約2MB、追加ディスク使用は数MBです。
モデル・他のPython依存・仮想環境の構成は変更しません。` : `
次の外部コンポーネントを取得します。

- RT-DETRv4-X Manga109-s v2（Apache-2.0、モデル約239MB）
  https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2
- Baberu OCR（Apache-2.0、小型ONNXモデル約116MB）
  ${BABERU_REPOSITORY}
- WD ViT Tagger v3（Apache-2.0、ONNXモデルと表情語彙 約379MB）
  ${WD_EXPRESSION_REPOSITORY}
- Python依存パッケージ（操作分類器のPyTorch・Transformersを含む）
- 採用操作分類モデルを検証し、不足時だけこのリポジトリのReleaseから重み約147MBを取得
  保存先: ${resolve(REPO_ROOT, 'models', 'nyamuru-voice-v04-seed43')}

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


export async function setup(options, { updateCertificates = updatePythonCertificates } = {}) {
  const layout = visionLayout(options.root);
  if (options.updateCertificates && !existsSync(layout.python)) {
    throw new Error(`更新対象の既存Python環境が見つかりません: ${layout.python}`);
  }
  if (!(await confirmSetup(layout, options.yes, options.updateCertificates))) {
    console.log('セットアップを中止しました。');
    return;
  }

  if (options.updateCertificates) {
    await updateCertificates(layout.python);
    return;
  }

  await mkdir(layout.root, { recursive: true });
  if (!existsSync(layout.python)) {
    const systemPython = findPython();
    console.log('画像解析専用のPython仮想環境を作成します...');
    await run(systemPython, ['-m', 'venv', layout.venv]);
  } else if (!supportedPython(layout.python)) {
    throw new Error(`既存の画像解析環境がPython 3.10〜3.13ではありません: ${layout.python}`);
  }

  await updateCertificates(layout.python);
  await run(layout.python, [resolve(REPO_ROOT, 'scripts', 'install_voice_intent.py'), '--download']);
  console.log('画像解析・操作分類用Python依存を導入します...');
  await run(layout.python, ['-m', 'pip', 'install', '-r', resolve(REPO_ROOT, 'requirements-vision.txt')]);
  await downloadModel(layout.model);
  await downloadBaberuModel(layout.baberu);
  await downloadWdExpressionModel(layout.wdExpression);

  console.log('導入状態を検査します...');
  await run(layout.python, [
    '-c',
    'import cv2, numpy, onnxruntime, torch, transformers; from PIL import Image; print("Python画像解析・操作分類依存: OK")',
  ]);
  await run(layout.python, [resolve(REPO_ROOT, 'scripts', 'nyamuru_local_bridge.py'), '--check'], {
    env: {
      ...process.env,
      NYAMURU_VISION_ROOT: layout.root,
      NYAMURU_VISION_PYTHON: layout.python,
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
