"""Verify, download, or import the hash-pinned seed43 checkpoint."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import ssl
import tempfile
import urllib.request
from zipfile import ZipFile
from nyamuru_voice_intent import DEFAULT_MODEL_NAME, LABELS

ARCHIVE_SHA256 = '60ab33731267593c3de8322a496883cf7e3f6503c415a4f26e6963772f9a28dc'
ROOT = Path(__file__).resolve().parents[1]
WEIGHT_BYTES = 147111548
WEIGHT_URL = 'https://github.com/yukincom/nyamuru-image-hub/releases/download/nyamuru-voice-v04-seed43/model.safetensors'
SELECTED_FILES = {
    'config.json': 'df473280ceddf7a2e0a1c16a972d9e7e56412bc19f398f271dd2c3b8c290f8fc',
    'model.safetensors': '1cb98d06dffde79f234a29b1c78e679634aae6e1357272c85948da6d57c3c3e1',
    'tokenizer.json': '6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d',
    'tokenizer_config.json': '930dd278b2f45e3fdb6814699eaa23297a8ba534e0756ce0d194ec7dd4deccec',
}

def checked_checkpoint(source: Path):
    try:
        files = {name: (source/name).read_bytes() for name in SELECTED_FILES}
    except FileNotFoundError as error:
        raise ValueError('分類モデルがありません。npm run setup:vision を実行してください') from error
    for name, data in files.items():
        if data.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
            raise ValueError('分類モデルが旧Git LFSポインターのままです。モデル導入手順を確認してください')
        if hashlib.sha256(data).hexdigest() != SELECTED_FILES[name]:
            raise ValueError(f'採用済みのv0.4 seed43と一致しません: {name}')
    config = json.loads(files['config.json'])
    if (config.get('id2label') != {str(i):name for i,name in enumerate(LABELS)} or
        config.get('label2id') != {name:i for i,name in enumerate(LABELS)}):
        raise ValueError('音声操作モデルの19ラベル契約が一致しません')
    return files

def verify_bundle(source: Path = None):
    source = source if source is not None else ROOT / 'models' / DEFAULT_MODEL_NAME
    if source.is_symlink() or any((source/name).is_symlink() for name in (*SELECTED_FILES, 'provenance.json')):
        raise ValueError('同梱分類モデルにsymlinkは使えません')
    checked_checkpoint(source)
    metadata = json.loads((source/'provenance.json').read_text())
    if metadata.get('model_id') != DEFAULT_MODEL_NAME or metadata.get('files') != SELECTED_FILES:
        raise ValueError('分類モデルの出典と採用済みファイルが一致しません')
    return source

def download_ssl_context():
    """Use setup's maintained CA bundle while retaining TLS verification."""
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def download_bundle():
    """Fetch only the missing weight; never replace an existing model."""
    destination = ROOT / 'models' / DEFAULT_MODEL_NAME
    if destination.is_symlink() or any((destination/name).is_symlink() for name in (*SELECTED_FILES, 'provenance.json')):
        raise ValueError('同梱分類モデルにsymlinkは使えません')
    target = destination / 'model.safetensors'
    if target.exists():
        return verify_bundle(destination)
    metadata = json.loads((destination/'provenance.json').read_text())
    if metadata.get('model_id') != DEFAULT_MODEL_NAME or metadata.get('files') != SELECTED_FILES:
        raise ValueError('分類モデルの出典と採用済みファイルが一致しません')
    for name, expected in SELECTED_FILES.items():
        if name != 'model.safetensors' and hashlib.sha256((destination/name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'採用済みのv0.4 seed43と一致しません: {name}')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination, prefix='.download-', delete=False) as output:
            temporary = Path(output.name)
            digest, size = hashlib.sha256(), 0
            with urllib.request.urlopen(WEIGHT_URL, timeout=120, context=download_ssl_context()) as response:
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    size += len(chunk)
                    if size > WEIGHT_BYTES:
                        raise ValueError('分類モデルのダウンロードサイズが一致しません')
                    digest.update(chunk)
                    output.write(chunk)
        if size != WEIGHT_BYTES or digest.hexdigest() != SELECTED_FILES['model.safetensors']:
            raise ValueError('分類モデルのダウンロードサイズまたはSHA-256が一致しません')
        try:
            # Publishing a verified file must not overwrite a concurrent install.
            os.link(temporary, target)
        except FileExistsError:
            pass
        return verify_bundle(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def install_checkpoint(source: Path):
    """Only the four hash-pinned files are copied; the source remains unchanged."""
    files = checked_checkpoint(source)
    destination = ROOT / 'models' / DEFAULT_MODEL_NAME
    metadata = dict(model_id=DEFAULT_MODEL_NAME, version='v0.4', equivalent='v0.5.1 baseline',
                    seed=43, trial='trial-4', epoch=8, learning_rate=5e-5,
                    selection='User-approved 2026-10-20 after fixed73 and daily112 evaluation; not the historical dev-selected primary.',
                    files=SELECTED_FILES)
    encoded = json.dumps(metadata, indent=2) + '\n'
    if destination.is_symlink():
        raise ValueError('モデルの保存先にsymlinkは使えません')
    for name, data in {**files, 'provenance.json':encoded.encode()}.items():
        target = destination/name
        if target.is_symlink() or target.exists() and target.read_bytes() != data:
            raise ValueError(f'既存のモデルファイルが異なります: {name}')
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in {**files, 'provenance.json':encoded.encode()}.items():
        target = destination/name
        if not target.exists():
            target.write_bytes(data)
    return destination

def install(archive: Path):
    if archive.is_dir():
        return install_checkpoint(archive)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != ARCHIVE_SHA256:
            raise ValueError('確認済みのv0.2 Colab成果物と一致しません')
    destination = ROOT / 'models/nyamuru-voice-v02'
    with ZipFile(archive) as source:
        files = {name: source.read('weights/trial-4/best/' + name) for name in
                 ('config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json')}
        metadata = dict(archive_sha256=ARCHIVE_SHA256, trial=4, seed=43,
                        selection='highest development macro F1; provisional v0.2',
                        files={name: hashlib.sha256(data).hexdigest() for name, data in files.items()})
        destination.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            path = destination / name
            if path.exists() and path.read_bytes() != data:
                raise ValueError(f'既存のモデルファイルが異なります: {name}')
        for name, data in files.items():
            (destination / name).write_bytes(data)
        (destination / 'provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return destination

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, help='approved v0.4 seed43 checkpoint directory, or legacy v0.2 results ZIP')
    parser.add_argument('--check', action='store_true', help='verify the bundled model without copying or downloading')
    parser.add_argument('--download', action='store_true', help='fetch the missing adopted weight from this repository Release, then verify')
    args = parser.parse_args()
    if sum([args.check, args.download, args.source is not None]) != 1:
        parser.error('source、--check、--download のいずれか1つを指定してください')
    print(verify_bundle() if args.check else download_bundle() if args.download else install(args.source))
