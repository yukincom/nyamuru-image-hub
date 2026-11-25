"""Explicit ComfyUI API graphs, input bindings and versioned local registration.

This module never connects to ComfyUI or submits a prompt. Runtime validation
consumes a caller-provided /object_info snapshot.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path
from uuid import uuid4
from generation_store import canonical, directory_fd, read_regular_at, MAX_JSON

from workflow_graph import (
    MAX_REFERENCES,
    MAX_SEED,
    _FIELDS,
    _BINDING_KEYS,
    _identifier,
    _integer,
    _name,
    _json_copy,
    _link,
    validate_definition,
    validate_request,
    negative_prompt_nodes,
    prompt_upsampler_nodes,
    bind_graph,
    _declared_inputs,
    validate_runtime,
)


DEFAULT_ROOT = Path(__file__).resolve().parents[1] / '.local-generation' / 'workflows'

class WorkflowStore:
    def __init__(self, root=None):
        self.root = Path(root if root is not None else DEFAULT_ROOT).absolute()

    @contextmanager
    def _lock(self, create=False):
        with directory_fd(self.root, create=create) as directory:
            fd = os.open('.workflows.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError('ワークフローのlock fileが通常ファイルではありません')
                fcntl.flock(fd, fcntl.LOCK_EX)
                yield directory
            finally:
                os.close(fd)

    @staticmethod
    def _read(directory, identifier):
        raw, _ = read_regular_at(directory, f'{identifier}.json', MAX_JSON)
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError(f'保存したワークフロー{identifier}を読み取れません: {error}') from error
        if not isinstance(value, dict) or value.get('id') != identifier or 'version' not in value:
            raise ValueError('保存したワークフローのIDまたは版が一致しません')
        return value

    def list(self):
        try:
            with self._lock() as directory:
                result = []
                for name in sorted(os.listdir(directory)):
                    if not name.endswith('.json'):
                        continue
                    try:
                        identifier = _identifier(name[:-5])
                    except ValueError:
                        continue
                    result.append(self._read(directory, identifier))
                return result
        except FileNotFoundError:
            if not self.root.exists():
                return []
            raise

    def get(self, identifier):
        identifier = _identifier(identifier)
        with self._lock() as directory:
            return self._read(directory, identifier)

    def save(self, body, *, initial_id=None):
        value = validate_definition(body)
        updating = 'id' in value
        expected = body.get('expected_version')
        if updating:
            _integer(expected, '更新元の版', 1)
        elif expected is not None:
            raise ValueError('新規登録には更新元の版を指定しないでください')
        identifier = value.get('id') or (_identifier(initial_id) if initial_id is not None else str(uuid4()))
        with self._lock(create=not updating) as directory:
            if updating:
                previous = self._read(directory, identifier)
                if previous['version'] != expected:
                    raise ValueError('ワークフローは別の操作で更新されています。一覧を読み直してください')
                version = previous['version'] + 1
            else:
                version = 1
                try:
                    os.stat(f'{identifier}.json', dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    if initial_id is not None:
                        return self._read(directory, identifier)
                    raise ValueError('ワークフローIDが重複しました')
            value.update(id=identifier, version=version)
            raw = canonical(value)
            if len(raw) > MAX_JSON:
                raise ValueError('ワークフローJSONは8MiB以内で指定してください')
            temporary = f'.pending-{uuid4()}'
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                remaining = memoryview(raw)
                while remaining:
                    written = os.write(fd, remaining)
                    if written <= 0:
                        raise OSError('ワークフローを書き込めません')
                    remaining = remaining[written:]
                os.fsync(fd)
                os.replace(temporary, f'{identifier}.json', src_dir_fd=directory, dst_dir_fd=directory)
                os.fsync(directory)
            finally:
                os.close(fd)
                try:
                    os.unlink(temporary, dir_fd=directory)
                except FileNotFoundError:
                    pass
        return value

    def delete(self, identifier, expected_version):
        identifier = _identifier(identifier)
        _integer(expected_version, '解除元の版', 1)
        with self._lock() as directory:
            value = self._read(directory, identifier)
            if value['version'] != expected_version:
                raise ValueError('ワークフローは別の操作で更新されています。一覧を読み直してください')
            os.unlink(f'{identifier}.json', dir_fd=directory)
            os.fsync(directory)
        return value


# Stable identities let the normal client use the supplied graphs without a browser setup step.
QWEN_FIGURE_ID = '132c3a87-8f0a-4591-b2e0-4a28a7b7b002'
P_H3_TWO_IMAGE_ID = '2a8f4c1e-7b3d-4e9a-9c1f-5d6e7f8a9b01'
QWEN_STANDARD_PREFIX = 'c7b07cf5-7e69-43e4-b380-'

# 旧->新: 旧=install_qwen_defaults(特定モデル名) -> 新=install_default_generation_workflows(機能体現名)へ統一
def install_default_generation_workflows(store):
    marker = '.bundled-qwen-1'
    ph3_marker = '.bundled-p-h3-4'
    with store._lock(create=True) as directory:
        try:
            if not stat.S_ISREG(os.stat(marker, dir_fd=directory, follow_symlinks=False).st_mode):
                raise ValueError("既定ワークフローの登録記録が不正です")
            installed = True
        except FileNotFoundError:
            installed = False
        try:
            if not stat.S_ISREG(os.stat(ph3_marker, dir_fd=directory, follow_symlinks=False).st_mode):
                raise ValueError("既定ワークフローの登録記録が不正です")
            ph3_installed = True
        except FileNotFoundError:
            ph3_installed = False
    examples = Path(__file__).resolve().parents[1] / 'examples' / 'comfyui'

    def read(name, kind):
        return json.loads((examples / f'{name}.{kind}.json').read_text(encoding='utf-8'))

    if not ph3_installed:
        ph3_name = 'p_h3_image_edit_mac_bf16_v2'
        ph3_def = dict(name='P-H3-Image_Edit_Mac_bf16_v2', graph=read(ph3_name, 'api'), binding=read(ph3_name, 'binding'))
        try:
            current_ph3 = store.get(P_H3_TWO_IMAGE_ID)
            store.save({**ph3_def, 'name': current_ph3['name'], 'id': current_ph3['id'], 'expected_version': current_ph3['version']})
        except (FileNotFoundError, ValueError):
            store.save(ph3_def, initial_id=P_H3_TWO_IMAGE_ID)
        with store._lock() as directory:
            fd = os.open(ph3_marker, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            os.close(fd)

    name = 'nyamuru_qwen_turbo_3images'
    figure = dict(name=name, graph=read(name, 'api'), binding=read(name, 'binding'))
    if installed:
        try:
            current = store.get(QWEN_FIGURE_ID)
        except (FileNotFoundError, ValueError):
            return
        # Update only the exact shipped graph; keep user edits, renames and deleted presets.
        previous = {key: current[key] for key in ('graph', 'binding')}
        if hashlib.sha256(canonical(previous)).hexdigest() in {
            'fe427df378bb686284604ad997cb39a87490f85ea13990b2047e4db8e1310596',
            'b883dbec6548fef076e23cb0bb911837f7dd88fcef44e59a2da8095bf863729f',
            '024936763209c1c5f14db72a830f6ba576a56bdbe7fa5b834bb2775de22a6aae',
        }:
            store.save({**figure, 'name': current['name'], 'id': current['id'], 'expected_version': current['version']})
        return
    store.save(figure, initial_id=QWEN_FIGURE_ID)
    # The usual editing graph accepts exactly the number of occupied inputs.
    # Keep it separate from the three-image figure instructions.
    name = 'qwen-turbo-10-refs'
    template, ports = read(name, 'api'), read(name, 'binding')
    for count in range(11):
        graph, binding = deepcopy(template), deepcopy(ports)
        for slot in range(count + 1, 11):
            del graph['6']['inputs'][f'images.image_{slot}']
            del graph[str(20 + slot)]
        binding['images'] = binding['images'][:count]
        graph['12']['inputs']['filename_prefix'] = f'nyamuru/qwen-turbo-{count}-refs'
        store.save(dict(name=f'Qwen Turbo · 参照{count}枚', graph=graph, binding=binding),
                   initial_id=f'{QWEN_STANDARD_PREFIX}{count:012d}')

    with store._lock() as directory:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        os.close(fd)
