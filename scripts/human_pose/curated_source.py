"""利用者が選んだ30件の配布poseと、了承済みの文面を対応づける。"""
from .constants import DATA
from .files import read_json

REVISION = 'curated-makehuman-20261009-v1'
CATEGORIES = {'standing': '立つ・待つ', 'gestures': '会話・身振り',
              'seated': '座る・休む', 'actions': '物を持つ・動作'}
NUMBERS = set(range(10, 18)) | set(range(20, 29)) | set(range(30, 38)) | {41, 42, 43, 44, 50}
TAGS = [
    {'id': key, 'label_ja': name, 'aliases': aliases}
    for key, name, aliases in [
        ('standing', '立つ', ['立位', '立ち', 'standing']),
        ('gestures', '身振り', ['会話', 'ジェスチャー', 'gesture']),
        ('seated', '座る', ['座位', '座り', 'sitting', 'seated']),
        ('actions', '動作', ['動く', 'action']),
        ('chair', '椅子', ['いす', 'chair']),
        ('floor', '床', ['地面', 'floor']),
        ('crossed-legs', '足を組む', ['脚を組む', '組み脚', 'crossed legs']),
        ('mime', '持つ形', ['持つ', '小物', 'holding']),
    ]
]


# 原文と修正文をともに保持し、実験用の服装・背景を本文に混ぜない。
def definitions():
    rows = [row for category in CATEGORIES for row in read_json(DATA / f'curated-{category}.json')]
    if len(rows) != 30 or {row['display_number'] for row in rows} != NUMBERS:
        raise ValueError('採用した30件の番号が一致しません')
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError('採用pose IDが重複しています')
    return sorted(rows, key=lambda row: row['display_number'])


def prompt_fields(row):
    return {key: row[key] for key in ('display_number', 'category', 'label_ja', 'label_en',
            'tags', 'search_aliases', 'pose_text_ja', 'pose_template', 'prompt_validation')} | {
        'pose_normalized_text': row['pose_template'], 'template_revision': 1,
        'prompt_segments': [{'id': 'pose', 'text_ja': row['pose_text_ja'], 'template_en': row['pose_template']}],
    }
