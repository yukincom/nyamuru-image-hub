"""数値検証とagentの目視記録を揃え、共通素体をカタログへ登録する。"""
import argparse
from datetime import datetime, timezone
from pathlib import Path

from .files import read_json, save_json, sha256
from .glb import rig_contract
from .validate_catalog import require, validate_catalog


def file_record(root, relative):
    raw = (root / relative).read_bytes()
    return {'path': relative, 'sha256': sha256(raw), 'byte_size': len(raw)}


# 利用者のポーズ確認とは別に、素体の数値検証とagentの目視を記録する。
def register(root, source, visual_note):
    models = root / 'models'
    metadata_path = models / 'human_base.metadata.json'
    metadata = read_json(metadata_path)
    for item in metadata['files'].values():
        require(sha256((models / item['name']).read_bytes()) == item['sha256'], '派生素体が変更されています')
    require(sha256(source.read_bytes()) == metadata['source_sha256'], '原本が作業開始時から変更されています')
    contract = rig_contract(models / 'human_base.glb')
    blender = read_json(root / 'review/base/stress/rig-validation.json')
    three = read_json(root / 'review/base/stress/three-runtime-validation.json')
    for report in (blender, three):
        require(report['base_glb_sha256'] == contract['base_glb_sha256'] and
                report['rig_signature'] == contract['rig_signature'], '別の素体の検証結果です')
        require({case['name'] for case in report['cases']} == {'rest', 'arms', 'seated', 'deep-knees'}, '検証caseが足りません')
    require(blender['base_blend_sha256'] == metadata['files']['blend']['sha256'], '別のblendの検証結果です')
    require(all(case['roundtrip_error_m'] < 1e-5 for case in blender['cases']), 'Blender往復検証が未合格です')
    require(all(case['max_error_m'] < 1e-5 for case in three['cases']), 'runtime往復検証が未合格です')
    catalog = read_json(root / 'catalog.json')
    catalog['coordinate_contract'] = {'status': 'verified', 'rig_signature': contract['rig_signature'],
                                      'base': file_record(root, 'models/human_base.glb'),
                                      'rig': file_record(root, 'models/human_base.rig.json')}
    validate_catalog(catalog, root)
    metadata.update(validation_status='verified_for_pilot', numerical_validation=blender,
                    runtime_validation=three, agent_visual_review={'reviewer': 'Codex', 'note': visual_note,
                    'reviewed_at': datetime.now(timezone.utc).isoformat()},
                    known_limits=['runtimeは上位4ウェイトを正規化。元blendの全ウェイトは保持。',
                                  '深い関節曲げの表面と指先は近似。各ポーズで確認する。',
                                  '座面・壁・取っ手の接触はP3で姿勢ごとに検証する。'],
                    asset_license={'core_assets': 'CC0', 'new_third_party_assets': False,
                                   'basis': '同梱basemeshとdefault weightsのlicense記載、および公式core asset license',
                                   'source_url': 'https://static.makehumancommunity.org/about/license.html'})
    save_json(metadata_path, metadata)
    save_json(root / 'catalog.json', catalog)
    print('共通素体を登録しました。ポーズの利用者確認状態は変更していません。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--visual-review-note', required=True)
    args = parser.parse_args()
    require(bool(args.visual_review_note.strip()), '目視結果を記録してください')
    register(args.root, args.source, args.visual_review_note)


if __name__ == '__main__':
    main()
