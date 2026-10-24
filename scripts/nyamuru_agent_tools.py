"""The editor tools offered to the local agent; execution belongs to the UI."""

from copy import deepcopy


BUBBLE_SHAPES = (
    "normal", "thought", "square", "caption", "flash", "uniflash", "wobbly",
    "whisper", "handwritten", "critical", "tense", "toge", "announce", "toge_natural",
)


def _point(minimum=None, maximum=None):
    coordinate = {"type": "number"}
    if minimum is not None:
        coordinate["minimum"] = minimum
    if maximum is not None:
        coordinate["maximum"] = maximum
    return {
        "type": "object",
        "properties": {"x": dict(coordinate), "y": dict(coordinate)},
        "required": ["x", "y"],
        "additionalProperties": False,
    }


_BEZIER_NODE = _point(0, 100)
_BEZIER_NODE["properties"].update({
    "handleIn": _point(-100, 100),
    "handleOut": _point(-100, 100),
})
_NODE_UPDATE = deepcopy(_BEZIER_NODE)
_NODE_UPDATE["properties"]["index"] = {"type": "integer", "minimum": 0, "maximum": 63}
_NODE_UPDATE["required"] = ["index"]
_NODE_UPDATE["minProperties"] = 2

_INSPECT = {
    "type": "function",
    "function": {
        "name": "editor_inspect",
        "description": "現在の原稿、選択対象、revision、吹き出しの輪郭・位置・しっぽと利用可能な素材を確認します。編集前と変更後の確認に使います。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}

_BUBBLE_EDIT = {
    "type": "function",
    "function": {
        "name": "editor_bubble_edit",
        "description": "直前のeditor_inspectで確認した選択中の吹き出しを編集します。revisionとtargetは確認結果をそのまま使います。省略した項目は保持します。輪郭だけの編集では本文・話者・発話の種類・しっぽ・位置を保持します。",
        "parameters": {
            "type": "object",
            "properties": {
                "revision": {"type": "string", "minLength": 1, "maxLength": 256},
                "target": {
                    "type": "object",
                    "properties": {
                        "pageIndex": {"type": "integer", "minimum": 0},
                        "panelIndex": {"type": "integer", "minimum": 0},
                        "index": {"type": "integer", "minimum": 0},
                        "kind": {"type": "string", "enum": ["bubble"]},
                        "overlay": {"type": "boolean"},
                    },
                    "required": ["pageIndex", "panelIndex", "index", "kind", "overlay"],
                    "additionalProperties": False,
                },
                "changes": {
                    "type": "object",
                    "description": "preset・bezier・node_updatesは一度に一つだけ指定できます。shapeは発話の種類も変更する明示的な依頼がある場合に指定します。",
                    "properties": {
                        "preset": {"type": "string", "enum": ["ellipse", "rounded", "cloud", "burst"]},
                        "shape": {"type": "string", "enum": list(BUBBLE_SHAPES)},
                        "bezier": {
                            "type": "object",
                            "description": "ノードは吹き出し内の0〜100の正規化座標。handleIn/handleOutはノードからの相対ベクトルで、ノードと足した制御点も0〜100内に収めます。",
                            "properties": {"nodes": {"type": "array", "items": _BEZIER_NODE, "minItems": 3, "maxItems": 64}},
                            "required": ["nodes"], "additionalProperties": False,
                        },
                        "node_updates": {
                            "type": "array", "items": _NODE_UPDATE, "minItems": 1, "maxItems": 64,
                            "description": "現在のベジェ輪郭の部分調整に使います。0始まりindexと変更する座標・ハンドルだけ指定し、それ以外の点を正確に保持します。上側だけの丸み調整などでは輪郭全体をコピーせず、この差分を使います。ハンドルは点からの相対ベクトルです。",
                        },
                        "bbox": {
                            "type": "object",
                            "description": "用紙上のミリメートル単位の位置x,yと幅w・高さh。",
                            "properties": {
                                "x": {"type": "number"}, "y": {"type": "number"},
                                "w": {"type": "number", "exclusiveMinimum": 0},
                                "h": {"type": "number", "exclusiveMinimum": 0},
                            },
                            "required": ["x", "y", "w", "h"], "additionalProperties": False,
                        },
                        "tail_mode": {
                            "type": "string", "enum": ["auto", "none"],
                            "description": "autoでしっぽの先端を自動に戻し、noneでしっぽを消します。tail_pointと同時には指定しません。",
                        },
                        "tail_point": {
                            **_point(),
                            "description": "しっぽ先端の用紙上のミリメートル座標です。話者の枠の外にも指定できます。tail_modeと同時には指定しません。",
                        },
                    },
                    "minProperties": 1,
                    "allOf": [
                        {"not": {"required": ["preset", "bezier"]}},
                        {"not": {"required": ["preset", "node_updates"]}},
                        {"not": {"required": ["bezier", "node_updates"]}},
                    ],
                    "additionalProperties": False,
                },
            },
            "required": ["revision", "target", "changes"],
            "additionalProperties": False,
        },
    },
}


_MODEL_CONNECTIONS = {
    "type": "function",
    "function": {
        "name": "model_connections",
        "description": "画像生成に使うQwenとComfyUIの実行環境・モデルファイル、および環境設定に保存されたComfyUIサーバーへの接続を確認します。モデルの読込や画像生成、設定変更は行いません。availableはファイル確認の結果で、生成成功を意味しません。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}


def agent_tools(allow_edits: bool = True):
    """Return fresh schemas so one request cannot change later requests."""
    return deepcopy([_INSPECT, _BUBBLE_EDIT, _MODEL_CONNECTIONS, _IMAGE_GENERATION] if allow_edits else [_INSPECT, _MODEL_CONNECTIONS])


_IMAGE_GENERATION = {
    'type': 'function',
    'function': {
        'name': 'image_generation',
        'description': '利用者がローカル画像生成をつなぐよう依頼したらconnectで設定済みのQwen Turboを内蔵エージェントの生成先に接続します。選択対象への明示的な「生成して」にはgenerateで既存生成処理を実行し元のあたりへ差し込みます。質問や相談だけでは実行しません。文章LLMの会話終了後に処理されるので、このツールを一つだけ呼び出します。',
        'parameters': {'type': 'object', 'properties': {'action': {'type': 'string', 'enum': ['connect', 'generate']}},
                       'required': ['action'], 'additionalProperties': False},
    },
}
