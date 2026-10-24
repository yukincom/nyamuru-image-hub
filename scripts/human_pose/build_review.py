"""fetch不要の静的HTMLで、原文・元画像・姿勢の比較入口を作る。"""
import argparse
from html import escape
from pathlib import Path
from urllib.parse import quote

from .constants import CATEGORIES, ROOT
from .files import asset_path, read_json
from .validate_catalog import validate_catalog
from .register_pilot import load_pilot


def figure(image, label):
    url = "../" + quote(image["path"], safe="/")
    return f'<figure><img src="{url}" alt="{escape(label)}" loading="lazy"><figcaption>{escape(label)}</figcaption></figure>'


# 未制作と未確認を明示し、元画像を3Dの成果と取り違えない。
def pose_card(pose, pilot=None):
    source = pose["source"]
    images = "".join(figure(image, model) for image, model in zip(source["images"], ("Krea 2 の元画像", "Qwen Image 2.1 の元画像")))
    preview = pose["asset_files"].get("preview")
    if pilot:
        images += figure({'path': pilot['guide']}, '共通素体の試作（未確認）')
    images += figure(preview, "一覧用の単純なポーズ絵") if preview else '<div class="pending">3Dは未制作</div>'
    status = "利用者確認済み" if pose["review"]["user_confirmed"] else "利用者未確認"
    notes = "".join(f"<li>{escape(note)}</li>" for note in pose["normalization_notes"] + pose["contact_notes"] + pose["approximation_notes"])
    comparison = ''
    if pilot:
        comparison = '<h4>姿勢の補完と元画像との違い</h4><ul>' + ''.join(
            f'<li>{escape(note)}</li>' for note in pilot['notes']) + '</ul>'
    return f'''<article id="{escape(pose['id'])}">
<h3>{escape(pose['label_ja'])}</h3><p class="status">{status} · 画像参照{'可' if pose['image_reference_eligible'] else '未承認'}</p>
<div class="images">{images}</div><p>{escape(pose['pose_text_ja'])}</p>
<p lang="en">{escape(pose['pose_normalized_text'])}</p>{comparison}
<details><summary>原文と正規化の記録</summary><dl>
<dt>出典</dt><dd>{escape(source['path'])}:{source['line']}</dd>
<dt>共通指定を含む全文</dt><dd>{escape(source['original_prompt'])}</dd>
<dt>ポーズ箇所の原文</dt><dd>{escape(source['pose_source_text'])}</dd>
<dt>性別に依存しないtemplate</dt><dd>{escape(pose['pose_template'])}</dd></dl><ul>{notes}</ul></details></article>'''


def build_review(root, pilot=None):
    catalog = read_json(asset_path(root, "catalog.json"))
    validate_catalog(catalog, root)
    selected = {}
    if pilot:
        registered = {entry['id']: entry for entry in catalog['poses']}
        for case, pose, _ in load_pilot(root, pilot):
            if registered[case['pose_id']]['asset_files'].get('pose', {}).get('sha256') != case['files']['pose.json']['sha256']:
                raise ValueError('比較画像と登録姿勢のrevisionが一致しません')
            selected[case['pose_id']] = {'guide': f"{pilot}/{case['name']}/guide.png",
                                        'notes': pose['interpretation_notes'] + pose['source_comparison']}
    labels = ["立位", "もたれ・支持", "片手で取っ手", "両手で取っ手", "座位", "しゃがみ", "横たわり"]
    navigation, sections = [], []
    for category, label in zip(CATEGORIES, labels):
        name = category[3:]
        navigation.append(f'<a href="#{name}">{label}</a>')
        cards = "".join(pose_card(pose, selected.get(pose['id'])) for pose in catalog["poses"] if pose["category"] == name)
        sections.append(f'<section id="{name}"><h2>{label}</h2>{cards}</section>')
    html = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
<title>人物ポーズ・出典比較</title><style>
body{font:16px/1.65 system-ui,sans-serif;background:#f2f4f7;color:#182335;margin:0 auto;max-width:1150px;padding:28px}
h1,h2,h3{line-height:1.3}header,article{background:white;padding:24px;border:1px solid #d4dce7;border-radius:12px;margin-bottom:24px}
nav{display:flex;flex-wrap:wrap;gap:16px}a{color:#1354a1}h2{margin-top:48px}h3{margin-top:0}.status{color:#78540f}
.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}figure{margin:0}img{display:block;width:100%;height:330px;object-fit:contain;background:#edf0f4}
figcaption{text-align:center;font-size:14px}.pending{display:grid;place-items:center;background:#edf0f4;color:#64748b;min-height:200px}
dt{font-weight:600;margin-top:12px}dd{margin:0;overflow-wrap:anywhere}summary{cursor:pointer}details{border-top:1px solid #d4dce7;padding-top:12px}
@media(max-width:600px){body{padding:12px}article{padding:16px}.images{grid-template-columns:1fr 1fr}.pending{grid-column:1/-1}img{height:240px}}
</style><header><h1>人物ポーズ・出典比較</h1><p>68件の日本語・英文・元画像を比較できます。元画像は各モデルの生成例です。3D素材と利用者確認の状態は別に表示します。</p><nav>'''
    shortcuts = ''.join(f'<a href="#{escape(pose["id"])}">{escape(pose["label_ja"])}</a>'
                        for pose in catalog['poses'] if pose['id'] in selected)
    html += "".join(navigation) + '</nav>'
    if selected:
        html += f'<h2>代表6件の試作</h2><nav>{shortcuts}</nav>'
    html += "</header><main>" + "".join(sections) + "</main></html>"
    output = asset_path(root, "review/index.html")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--pilot", help="root内の試作folder（例: review/pilot-04）")
    args = parser.parse_args()
    build_review(args.root, args.pilot)
