"""Explicit ComfyUI API graphs, input bindings and versioned local registration.

This module never connects to ComfyUI or submits a prompt. Runtime validation
consumes a caller-provided /object_info snapshot.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from collections import deque
import fcntl
import json
import math
import os
from pathlib import Path
import stat
from uuid import UUID, uuid4

from generation_store import canonical, directory_fd, read_regular_at, MAX_JSON

DEFAULT_ROOT = Path(__file__).resolve().parents[1] / '.local-generation' / 'workflows'
MAX_REFERENCES = 10
MAX_SEED = 2**53 - 1
_FIELDS = ('prompt', 'seed', 'width', 'height')
_BINDING_KEYS = {*_FIELDS, 'images', 'output', 'prompt_mode', 'fixed_size'}


def _identifier(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        raise ValueError('ワークフローIDは標準形式のUUIDで指定してください') from None
    return value


def _integer(value, label, minimum=0, maximum=None):
    if type(value) is not int or value < minimum or maximum is not None and value > maximum:
        bounds = f'{minimum}〜{maximum}' if maximum is not None else f'{minimum}以上'
        raise ValueError(f'{label}は{bounds}の整数で指定してください')
    return value


def _name(value, label, maximum=200):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f'{label}の形式または長さが正しくありません')
    return value


def _json_copy(value):
    def check(item):
        if item is None or type(item) in (str, bool, int):
            return
        if type(item) is float and math.isfinite(item):
            return
        if isinstance(item, list):
            for child in item:
                check(child)
            return
        if isinstance(item, dict) and all(isinstance(key, str) for key in item):
            for child in item.values():
                check(child)
            return
        raise ValueError('ワークフローにはJSONの値だけを指定してください')
    try:
        check(value)
        raw = canonical(value)
        if len(raw) > MAX_JSON:
            raise ValueError('ワークフローJSONは8MiB以内で指定してください')
        return json.loads(raw)
    except (RecursionError, OverflowError):
        raise ValueError('ワークフローJSONの構造が深すぎます') from None


def _link(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and type(value[1]) is int and value[1] >= 0


def validate_definition(body):
    """Validate a registration or saved definition; never guess missing bindings."""
    if not isinstance(body, dict):
        raise ValueError('ワークフロー登録の形式が正しくありません')
    value = _json_copy(body)
    name = _name(value.get('name'), 'ワークフロー名').strip()
    graph, binding = value.get('graph'), value.get('binding')
    if not isinstance(graph, dict) or not graph or any(
            not isinstance(node, dict) or not isinstance(node.get('inputs'), dict) or not isinstance(node.get('class_type'), str)
            for node in graph.values()):
        raise ValueError('ComfyUIのAPI形式JSON（ノードIDごとのclass_typeとinputs）を書き出してください')
    for node_id, node in graph.items():
        _name(node_id, 'ノードID')
        _name(node['class_type'], f'ノード{node_id}のclass_type')
        for key, item in node['inputs'].items():
            _name(key, f'ノード{node_id}の入力名')
            if isinstance(item, list) and (not _link(item) or item[0] not in graph):
                raise ValueError(f'ノード{node_id}の入力{key}の接続先が正しくありません')
    dependencies = {node_id: {item[0] for item in node['inputs'].values() if _link(item)} for node_id, node in graph.items()}
    consumers = {node_id: [] for node_id in graph}
    for node_id, sources in dependencies.items():
        for source in sources:
            consumers[source].append(node_id)
    ready = deque(node_id for node_id, sources in dependencies.items() if not sources)
    visited = 0
    while ready:
        source = ready.popleft()
        visited += 1
        for consumer in consumers[source]:
            dependencies[consumer].remove(source)
            if not dependencies[consumer]:
                ready.append(consumer)
    if visited != len(graph):
        raise ValueError('ワークフローの接続が循環しています')
    if not isinstance(binding, dict) or set(binding) != _BINDING_KEYS:
        raise ValueError('指示・シード・寸法・参照画像・完成画像・プロンプト処理の対応付けを指定してください')
    if binding['prompt_mode'] not in ('qwen', 'plain'):
        raise ValueError('プロンプト処理はqwenまたはplainで指定してください')
    assigned = set()

    def sinks(items, role, required=False):
        if not isinstance(items, list) or required and not items:
            raise ValueError(f'{role}の受け渡し先を1つ以上指定してください')
        for sink in items:
            if not isinstance(sink, dict) or set(sink) != {'node', 'input'}:
                raise ValueError(f'{role}の受け渡し先はnodeとinputで指定してください')
            node_id = _name(sink['node'], f'{role}のノードID')
            key = _name(sink['input'], f'{role}の入力名')
            if node_id not in graph or key not in graph[node_id]['inputs']:
                raise ValueError(f'{role}の受け渡し先{node_id}.{key}がグラフにありません')
            item = graph[node_id]['inputs'][key]
            expected = str if role in ('prompt', 'images') else int
            if type(item) is not expected:
                raise ValueError(f'{role}の受け渡し先{node_id}.{key}は接続ではなく{expected.__name__}の値にしてください')
            if (node_id, key) in assigned:
                raise ValueError(f'受け渡し先{node_id}.{key}が重複しています')
            assigned.add((node_id, key))

    for field in _FIELDS:
        sinks(binding[field], field, field in ('prompt', 'seed'))
    images = binding['images']
    if not isinstance(images, list) or len(images) > MAX_REFERENCES:
        raise ValueError('参照画像の対応は0〜10枚で指定してください')
    for items in images:
        sinks(items, 'images', True)
    if bool(binding['width']) != bool(binding['height']):
        raise ValueError('幅と高さの受け渡し先を両方指定してください')
    fixed = binding['fixed_size']
    if binding['width']:
        if fixed is not None:
            raise ValueError('寸法の受け渡し先と固定寸法は同時に指定できません')
    elif not isinstance(fixed, list) or len(fixed) != 2:
        raise ValueError('寸法の受け渡し先がない場合はfixed_sizeに幅と高さを指定してください')
    else:
        _integer(fixed[0], '固定幅', 32, 4096)
        _integer(fixed[1], '固定高さ', 32, 4096)
    output = binding['output']
    if not isinstance(output, dict) or set(output) != {'node', 'index'}:
        raise ValueError('完成画像はnodeとindexで指定してください')
    if not isinstance(output['node'], str) or output['node'] not in graph:
        raise ValueError('完成画像のノードがグラフにありません')
    _integer(output['index'], '完成画像の位置', 0, 63)
    result = {'name': name, 'graph': graph, 'binding': binding}
    if 'id' in value:
        result['id'] = _identifier(value['id'])
    if 'version' in value:
        result['version'] = _integer(value['version'], '登録の版', 1)
    return result


def validate_request(definition, reference_count):
    definition = validate_definition(definition)
    _integer(reference_count, '参照画像の枚数', 0, MAX_REFERENCES)
    expected = len(definition['binding']['images'])
    if reference_count != expected:
        raise ValueError(f'このワークフローの参照画像は{expected}枚です（入力は{reference_count}枚）')


def bind_graph(definition, prompt, images, seed, width, height):
    definition = validate_definition(definition)
    if not isinstance(prompt, str):
        raise ValueError('指示文は文字列で指定してください')
    if not isinstance(images, list) or any(not isinstance(item, str) or not item.strip() for item in images):
        raise ValueError('アップロード済み参照画像の名前を順番どおり指定してください')
    validate_request(definition, len(images))
    _integer(seed, 'シード', 0, MAX_SEED)
    binding, graph = definition['binding'], deepcopy(definition['graph'])

    def put(sinks, value):
        for sink in sinks:
            graph[sink['node']]['inputs'][sink['input']] = value

    put(binding['prompt'], prompt)
    put(binding['seed'], seed)
    if binding['width']:
        put(binding['width'], _integer(width, '幅', 32, 4096))
        put(binding['height'], _integer(height, '高さ', 32, 4096))
    for sinks, filename in zip(binding['images'], images):
        put(sinks, filename)
    return graph


def _input_schema(schema):
    """Expand the explicit names of standard V3 Autogrow sockets."""
    available, required = {}, set()
    inputs = schema.get('input', {})
    if not isinstance(inputs, dict):
        raise ValueError('入力仕様がありません')
    for category in ('required', 'optional'):
        entries = inputs.get(category, {})
        if not isinstance(entries, dict):
            raise ValueError('入力仕様が正しくありません')
        for name, spec in entries.items():
            if not isinstance(spec, (list, tuple)) or not spec:
                raise ValueError(f'入力{name}の型がありません')
            if not isinstance(spec[0], (str, list)):
                raise ValueError(f'入力{name}の型が正しくありません')
            if spec[0] == 'COMBO' and (len(spec) < 2 or not isinstance(spec[1], dict) or not isinstance(spec[1].get('options'), list)):
                raise ValueError(f'入力{name}の選択肢がありません')
            if spec[0] != 'COMFY_AUTOGROW_V3':
                available[name] = spec
                if category == 'required':
                    required.add(name)
                continue
            template = spec[1]['template']
            names = template.get('names')
            if names is None:
                maximum = _integer(template['max'], 'Autogrowの上限', 1, 100)
                names = [f"{template['prefix']}{i}" for i in range(maximum)]
            minimum = template['min']
            if not isinstance(names, list) or len(names) > 100 or any(not isinstance(name, str) for name in names):
                raise ValueError('Autogrowの入力名が正しくありません')
            _integer(minimum, 'Autogrowの最小入力数', 0, len(names))
            template_inputs = template['input']
            template_required = bool(template_inputs.get('required'))
            template_spec = next(iter((template_inputs.get('required') or template_inputs.get('optional')).values()))
            if not isinstance(template_spec, (list, tuple)) or not template_spec:
                raise ValueError('Autogrowの入力型がありません')
            for i, suffix in enumerate(names):
                key = f'{name}.{suffix}'
                available[key] = template_spec
                if template_required and i < minimum:
                    required.add(key)
    return available, required


def _spec_parts(spec):
    kind = spec[0]
    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
    choices = kind if isinstance(kind, list) else options.get('options') if kind == 'COMBO' else None
    return kind, options, choices


def _compatible(source, target):
    if isinstance(target, list):
        target = 'COMBO'
    if not isinstance(source, str) or not isinstance(target, str):
        return False
    return '*' in (source, target) or bool(set(source.split(',')) & set(target.split(',')))


def validate_runtime(definition, object_info):
    """Report static incompatibilities; image uploads and inference are not run."""
    try:
        definition = validate_definition(definition)
    except ValueError as error:
        return [str(error)]
    if not isinstance(object_info, dict):
        return ['ComfyUIのobject_infoが取得できません']
    graph, binding = definition['graph'], definition['binding']
    mapped = {(sink['node'], sink['input']): role for role in _FIELDS for sink in binding[role]}
    mapped.update({(sink['node'], sink['input']): 'images' for slots in binding['images'] for sink in slots})
    errors, schemas = [], {}
    for node_id, node in graph.items():
        schema = object_info.get(node['class_type'])
        if not isinstance(schema, dict):
            errors.append(f"ノード{node_id}: {node['class_type']}がComfyUIにありません")
            continue
        try:
            inputs, required = _input_schema(schema)
            schemas[node_id] = schema, inputs
        except (ValueError, KeyError, TypeError, IndexError, AttributeError, StopIteration) as error:
            errors.append(f'ノード{node_id}: object_infoの入力仕様を確認できません（{error}）')
            continue
        for name in sorted(required - node['inputs'].keys()):
            errors.append(f'ノード{node_id}: 必須入力{name}がありません')
        for name, value in node['inputs'].items():
            label = f'ノード{node_id}の入力{name}'
            if name not in inputs:
                errors.append(f'{label}がComfyUIの入力仕様にありません')
                continue
            kind, options, choices = _spec_parts(inputs[name])
            role = mapped.get((node_id, name))
            if role:
                expected = 'STRING' if role in ('prompt', 'images') else 'INT'
                upload = role == 'images' and choices is not None and options.get('image_upload') is True
                if kind != expected and not upload:
                    errors.append(f'{label}: {role}には{expected}入力が必要です')
                # Values mapped at submit time are placeholders, including upload enums.
                continue
            if _link(value):
                source = graph[value[0]]
                source_schema = object_info.get(source['class_type'])
                outputs = source_schema.get('output') if isinstance(source_schema, dict) else None
                if not isinstance(outputs, (list, tuple)) or value[1] >= len(outputs):
                    errors.append(f'{label}: 接続先{value[0]}の出力{value[1]}がありません')
                elif not _compatible(outputs[value[1]], kind):
                    errors.append(f'{label}: 接続の型{outputs[value[1]]}と{kind}が一致しません')
                continue
            if choices is not None:
                if value not in choices:
                    errors.append(f'{label}: 選択値「{value}」がComfyUIにありません')
                continue
            valid_literal = (kind == 'STRING' and isinstance(value, str)
                             or kind == 'INT' and type(value) is int
                             or kind == 'FLOAT' and type(value) in (int, float)
                             or kind == 'BOOLEAN' and type(value) is bool
                             or kind == '*')
            if not valid_literal:
                errors.append(f'{label}: {kind}型の値または接続が必要です')
            elif type(value) in (int, float) and (
                    'min' in options and value < options['min'] or 'max' in options and value > options['max']):
                errors.append(f'{label}: ComfyUIの入力範囲を外れています')
    output_id = binding['output']['node']
    if output_id in schemas:
        schema, inputs = schemas[output_id]
        outputs = schema.get('output')
        image_capable = isinstance(outputs, (list, tuple)) and 'IMAGE' in outputs or any(spec[0] == 'IMAGE' for spec in inputs.values())
        if schema.get('output_node') is not True or not image_capable:
            errors.append(f'完成画像のノード{output_id}は画像を保存する出力ノードではありません')
    return errors


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
            value = validate_definition(json.loads(raw))
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError(f'保存したワークフロー{identifier}を読み取れません: {error}') from error
        if value.get('id') != identifier or 'version' not in value:
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

    def save(self, body):
        value = validate_definition(body)
        updating = 'id' in value
        expected = body.get('expected_version')
        if updating:
            _integer(expected, '更新元の版', 1)
        elif expected is not None:
            raise ValueError('新規登録には更新元の版を指定しないでください')
        identifier = value.get('id') or str(uuid4())
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
