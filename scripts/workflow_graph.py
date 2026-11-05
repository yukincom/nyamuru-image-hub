"""Validate ComfyUI graphs and bind inputs for a generation request."""

from __future__ import annotations

from copy import deepcopy
import json
import math
from uuid import UUID
from generation_store import canonical, MAX_JSON


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
    """Validate Nyamuru's registration boundary, leaving graph execution to ComfyUI."""
    if not isinstance(body, dict):
        raise ValueError('ワークフロー登録の形式が正しくありません')
    value = _json_copy(body)
    name = _name(value.get('name'), 'ワークフロー名').strip()
    graph, binding = value.get('graph'), value.get('binding')
    if not isinstance(graph, dict) or not graph or any(
            not isinstance(node, dict) or not isinstance(node.get('inputs'), dict)
            or not isinstance(node.get('class_type'), str) or not node['class_type'].strip()
            for node in graph.values()):
        raise ValueError('ComfyUIのAPI形式JSON（ノードIDごとのclass_typeとinputs）を書き出してください')
    if not isinstance(binding, dict) or set(binding) != _BINDING_KEYS:
        raise ValueError('指示・シード・寸法・参照画像・完成画像・プロンプト処理の対応付けを指定してください')
    if binding['prompt_mode'] not in ('qwen', 'plain', 'qwen-three-images'):
        raise ValueError('指示文の扱いを選択してください')
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
            if _link(graph[node_id]['inputs'][key]):
                raise ValueError(f'{role}の受け渡し先{node_id}.{key}は接続ではなく差し替える値にしてください')
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
    if binding['prompt_mode'] == 'qwen-three-images' and (len(images) != 3 or fixed is not None):
        raise ValueError('人物3枚参照には参照画像3枚と可変の出力寸法を指定してください')
    if binding['width']:
        if fixed is not None:
            raise ValueError('寸法の受け渡し先と固定寸法は同時に指定できません')
    elif binding['prompt_mode'] == 'qwen-three-images' and fixed is None:
        pass  # The panel-sized pose drives both the native latent and the final crop.
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
    """Check reference count for a definition validated at the registration/job boundary."""
    _integer(reference_count, '参照画像の枚数', 0, MAX_REFERENCES)
    expected = len(definition['binding']['images'])
    if reference_count != expected:
        raise ValueError(f'このワークフローの参照画像は{expected}枚です（入力は{reference_count}枚）')


def negative_prompt_nodes(definition):
    return [sink['node'] for sink in definition['binding']['prompt']
            if sink['input'] == 'prompt'
            and definition['graph'][sink['node']]['class_type'] == 'TextEncodeQwenImage21'
            and isinstance(definition['graph'][sink['node']]['inputs'].get('negative_prompt'), str)]


def bind_graph(definition, prompt, images, seed, width, height, *, negative_prompt=None, dpi=None):
    """Bind request values to a previously validated definition, copying its graph once."""
    if not isinstance(prompt, str):
        raise ValueError('指示文は文字列で指定してください')
    if not isinstance(images, list) or any(not isinstance(item, str) or not item.strip() for item in images):
        raise ValueError('アップロード済み参照画像の名前を順番どおり指定してください')
    validate_request(definition, len(images))
    _integer(seed, 'シード', 0, MAX_SEED)
    binding = definition['binding']
    if binding['width']:
        _integer(width, '幅', 32, 4096)
        _integer(height, '高さ', 32, 4096)
    graph = deepcopy(definition['graph'])

    def put(sinks, value):
        for sink in sinks:
            graph[sink['node']]['inputs'][sink['input']] = value

    if dpi is not None:
        save = graph[binding['output']['node']]
        if save['class_type'] != 'NyamuruSavePrintPNG':
            raise ValueError('コマの解像度を受け取る保存ノードを指定してください')
        save['inputs']['dpi'] = dpi
    put(binding['prompt'], prompt)
    if negative_prompt is not None:
        for node_id in negative_prompt_nodes(definition):
            graph[node_id]['inputs']['negative_prompt'] = negative_prompt
    put(binding['seed'], seed)
    if binding['width']:
        put(binding['width'], width)
        put(binding['height'], height)
    for sinks, filename in zip(binding['images'], images):
        put(sinks, filename)
    return graph


def _declared_inputs(schema):
    """Read input names only; ComfyUI resolves dynamic paths and validates their values."""
    available = set()
    inputs = schema.get('input', {})
    if not isinstance(inputs, dict):
        raise ValueError('入力仕様がありません')
    for category in ('required', 'optional'):
        entries = inputs.get(category, {})
        if not isinstance(entries, dict):
            raise ValueError('入力仕様が正しくありません')
        available.update(entries)
    return available


def validate_runtime(definition, object_info):
    """Check bound input/output existence for a definition already validated at its boundary."""
    if not isinstance(object_info, dict):
        return ['ComfyUIのobject_infoが取得できません']
    graph, binding = definition['graph'], definition['binding']
    mapped = {}
    for sinks in [*(binding[field] for field in _FIELDS), *binding['images']]:
        for sink in sinks:
            mapped.setdefault(sink['node'], set()).add(sink['input'])
    mapped.setdefault(binding['output']['node'], set())
    errors = []
    for node_id, names in mapped.items():
        node = graph.get(node_id)
        if node is None:
            errors.append(f'ノード{node_id}が登録グラフにありません')
            continue
        schema = object_info.get(node['class_type'])
        if not isinstance(schema, dict):
            errors.append(f"ノード{node_id}: {node['class_type']}がComfyUIにありません")
            continue
        if not names:
            continue
        try:
            inputs = _declared_inputs(schema)
        except ValueError as error:
            errors.append(f'ノード{node_id}: object_infoの入力仕様を確認できません（{error}）')
            continue
        for name in sorted(names):
            label = f'ノード{node_id}の入力{name}'
            if name not in node['inputs']:
                errors.append(f'{label}が登録グラフにありません')
            elif name not in inputs and name.partition('.')[0] not in inputs:
                errors.append(f'{label}がComfyUIの入力仕様にありません')
    return errors
