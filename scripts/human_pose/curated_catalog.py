"""利用者が選んだ30ポーズの出典・登録情報・画像・ボーンの姿勢データを検証する。"""
import json
import re

from .curated_source import REVISION, TAGS, definitions, prompt_fields
from .files import image_info, asset_path, sha256
from .pose_contract import validate_pose
from .source import validate_template


# 素材ファイルと共通素体の検証処理を、研究用68件のカタログと共用する。
# 配布元と登録内容の照合には、採用30件の定義を使う。
def validate_curated_catalog(catalog, root):
    from .validate_catalog import file_record, require, validate_coordinate_contract
    require(root is not None, '素材の保存先ディレクトリが指定されていません')
    require(catalog.get('source_revision') == REVISION, '採用版のリビジョンが不正です')
    require(catalog.get('tags') == TAGS, 'タグ定義が固定値と一致しません')
    expected = definitions()
    poses = catalog.get('poses')
    require(isinstance(poses, list) and len(poses) == len(expected), 'ポーズ一覧は30件のリストである必要があります')
    contract = validate_coordinate_contract(catalog.get('coordinate_contract'), root)
    require(contract is not None, '共通素体の検証が完了していません')
    source_raw = asset_path(root, 'sources/curated/index.json').read_bytes()
    require(sha256(source_raw) == catalog.get('source_manifest_sha256'), '採用出典マニフェストのハッシュ値が一致しません')
    manifest = json.loads(source_raw)
    require(manifest.get('revision') == REVISION and isinstance(manifest.get('poses'), list), '採用出典マニフェストの形式が不正です')
    require(len(manifest['poses']) == 30, '採用出典ポーズ一覧は30件のリストである必要があります')
    categories = {}
    for pose, row, provenance in zip(poses, expected, manifest['poses']):
        identifier = row['id']
        require(pose.get('id') == identifier and provenance.get('id') == identifier, '採用ポーズのID対応が不正です')
        for key, value in prompt_fields(row).items():
            require(pose.get(key) == value, f'登録項目が採用時の定義と一致しません: {identifier}/{key}')
        validate_template(pose['pose_template'])
        require(provenance.get('source') == row['source'], '配布元（source）の情報が一致しません')
        require(provenance.get('original_gemini_prompt') == row['original_gemini_prompt'], '元プロンプト原文が一致しません')
        source = pose.get('source', {})
        require(source == {'revision': REVISION, 'path': 'sources/curated/index.json',
                          'license': 'CC0-1.0', 'images': []}, '採用版の出典情報（source）が不正です')
        bvh = provenance.get('bvh', {})
        require(bvh.get('path') == f'poses/{identifier}/source.bvh' and
                bvh.get('sha256') == row['source']['sha256'], '配布BVHファイルの情報が一致しません')
        file_record(bvh, root)
        scene = provenance.get('scene', {})
        require(isinstance(scene.get('sha256'), str) and bool(re.fullmatch('[a-f0-9]{64}', scene['sha256'])),
                '変換元.blendファイルのSHA-256の形式が不正です')
        require(scene.get('user_corrected') is (row['display_number'] in {17, 23}), '手動修正フラグ（user_corrected）の設定が不正です')
        require(pose.get('production_status') == 'ready', '制作状態（production_status）がreadyではありません')
        require(pose.get('image_reference_eligible') is False,
                '画像参照（image_reference_eligible）は撮影確認機能の実装後に有効化してください')
        review = pose.get('review', {})
        require(review.get('status') == 'confirmed' and review.get('user_confirmed') is True and
                review.get('reviewer') == 'user' and bool(review.get('reviewed_at')), '素材採用の確認レビュー記録（review）が必要です')
        assets = pose.get('asset_files', {})
        require(set(assets) == {'pose', 'preview'}, 'ポーズ定義（pose）とプレビュー画像（preview）の2アセットが必要です')
        for kind, filename in [('pose', 'pose.json'), ('preview', 'preview.png')]:
            record = assets[kind]
            require(record.get('path') == f'poses/{identifier}/{filename}', 'アセットファイルの配置パスが不正です')
            raw = file_record(record, root)
            require(provenance.get(kind) == record, 'アセット情報と出典マニフェストが一致しません')
            if kind == 'preview':
                require(image_info(raw) == {'width': 1024, 'height': 1024, 'format': 'PNG'}, 'プレビュー画像（PNG）の解像度または形式が不正です')
            else:
                saved = json.loads(raw)
                validate_pose(saved, contract)
                require(saved.get('pose_id') == identifier and saved.get('revision') == pose.get('asset_revision'),
                        'ポーズのIDまたはリビジョンが一致しません')
                require(saved.get('user_confirmed') is True and saved.get('reviewer') == review['reviewer'] and
                        saved.get('reviewed_at') == review['reviewed_at'], 'ポーズの確認レビュー記録が一致しません')
        category = row['category']
        categories[category] = categories.get(category, 0) + 1
    return {'poses': len(poses), 'images': len(poses), 'categories': categories}
