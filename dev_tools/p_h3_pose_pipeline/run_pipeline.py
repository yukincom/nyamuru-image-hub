#!/usr/bin/env python3
"""
ポーズ画像フォルダ -> ComfyUI(P-H3-Image Edit) -> 結果フォルダ の自動生成パイプライン

- ポーズ画像 page01_1_1.png -> 生成結果 page01_1_1_gen.png
- 結果フォルダに <名前>_gen.png が既にあるポーズはスキップ = 中断しても再実行で続きから再開
- 標準ライブラリのみ (pip install 不要)
- ComfyUI Desktop を起動したままにして実行する

使い方 (VSCode の実行ボタン or ターミナル):
    python run_pipeline.py              # 未生成のポーズを全部生成
    python run_pipeline.py --dry-run    # 何を生成するか表示だけ
    python run_pipeline.py --limit 1    # 1枚だけ試す
"""
import argparse
import csv
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

# =====================================================================
# 設定 (ここだけ自分の環境に合わせて書き換える。コマンドライン引数でも上書き可)
# =====================================================================
HERE = Path(__file__).resolve().parent
TOOLS_ROOT = HERE.parents[2]  # この専用runnerはDesktop/tools/Comic_image_Hub/dev_tools配下に置く

COMFY_URL     = "http://127.0.0.1:8188"
WORKFLOW_API  = TOOLS_ROOT / "workflow_api.json"  # 新しいワークフローをComfyUIから「エクスポート(API)」したもの
CHARACTER_IMG = TOOLS_ROOT / "nyamuruテスト用シリーズフォルダ" / "character_data" / "できたやつ" / "koyuki_pin.png"  # image_1 (キャラ画像)
POSES_DIR     = Path("/Users/yukin_co/Desktop/pose")  # image_2 (ポーズ画像)
OUT_DIR       = Path("/Users/yukin_co/Desktop/test")  # 生成結果の保存先

MEGAPIXELS = 1.0   # P-H3 workflowの初回確認用サイズ (image_2 の縦横比で出力)
REQUEST = (
    "Change the pose and the facial expression of the character in <Picture 1> "
    "to match <Picture 2>. Keep the character's face shape, eyes, nose, hairstyle, "
    "headband, clothes, and drawing style from <Picture 1> exactly the same. "
    "Only the pose and the expression should change."
)

OUT_SUFFIX    = "_gen"    # page01_1_1.png -> page01_1_1_gen.png
POLL_SEC      = 5         # 完了確認の間隔
TIMEOUT_SEC   = 40 * 60   # 1枚あたりの待ち時間の上限
RELEASE_TIMEOUT_SEC = 15 * 60  # 解放確認の待ち時間の上限
PREVIEW_ONLY  = True      # True: ComfyUI側の output フォルダには保存せず、このスクリプトの保存先だけに残す

# ワークフロー(API形式)のノードID。ワークフローを改造したらここを合わせる
NODE_CHARACTER = "4"    # LoadImage  (image_1)
NODE_POSE      = "5"    # LoadImage  (image_2)
NODE_REQUEST   = "17"   # PrimitiveStringMultiline (Request)
NODE_NOISE     = "10"   # RandomNoise (seed)
NODE_SIZE      = "31"   # ImageScaleToTotalPixels (出力サイズ)
NODE_UPSAMPLER = "24"   # ComfySwitchNode (自動プロンプト補助)
NODE_SAVE      = "13"   # SaveImage

POSE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


# =====================================================================
# ComfyUI との通信 (HTTP API)
# =====================================================================
def http_json(method, path, payload=None):
    """JSONでやりとりするAPI呼び出し"""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(COMFY_URL + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
    return json.loads(body) if body else {}


def upload_image(path: Path) -> str:
    """画像を ComfyUI の input フォルダへアップロードし、LoadImage に渡す名前を返す"""
    boundary = uuid.uuid4().hex
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    parts = []
    for name, value in (("overwrite", "true"), ("type", "input")):
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; '
         f'filename="{path.name}"\r\nContent-Type: {mime}\r\n\r\n').encode()
        + path.read_bytes() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        COMFY_URL + "/upload/image", data=b"".join(parts), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read())
    return f"{res['subfolder']}/{res['name']}" if res.get("subfolder") else res["name"]


def fetch_image(info: dict) -> bytes:
    """/view で生成画像のバイト列を取得"""
    q = urllib.parse.urlencode({"filename": info["filename"],
                                "subfolder": info.get("subfolder", ""),
                                "type": info.get("type", "output")})
    with urllib.request.urlopen(f"{COMFY_URL}/view?{q}", timeout=60) as r:
        return r.read()


def wait_for_result(prompt_id: str) -> dict:
    """/history を見て完了(or エラー)まで待ち、history エントリを返す"""
    start = time.time()
    while time.time() - start < TIMEOUT_SEC:
        hist = http_json("GET", f"/history/{prompt_id}")
        if prompt_id in hist:
            return hist[prompt_id]
        time.sleep(POLL_SEC)
    raise TimeoutError(f"{TIMEOUT_SEC // 60}分待っても完了しませんでした")


def require_memory_release_extension() -> None:
    """処理を始める前に、完了確認対応のNyamuru拡張が使えることを確認"""
    result = http_json("GET", "/nyamuru/memory/capabilities")
    if type(result.get("protocol")) is not int or result["protocol"] != 1:
        raise RuntimeError("Nyamuruメモリ解放拡張のprotocol 1に対応していません")


def release_models_and_wait() -> None:
    """同じtokenで解放を依頼・確認し、worker側で全モデル解放するまで待つ"""
    token = str(uuid.uuid4())
    deadline = time.monotonic() + RELEASE_TIMEOUT_SEC
    last_state = None
    while time.monotonic() < deadline:
        result = http_json("POST", "/nyamuru/memory/release", {"token": token})
        if type(result.get("protocol")) is not int or result["protocol"] != 1 \
                or result.get("token") != token:
            raise RuntimeError("メモリ解放APIのprotocolまたはtokenが一致しません")

        state = result.get("state")
        if state != last_state:
            log(f"メモリ解放: {state}")
            last_state = state
        if state == "released":
            if result.get("queue_idle") is not True \
                    or type(result.get("loaded_model_count")) is not int \
                    or result["loaded_model_count"] != 0:
                raise RuntimeError("APIはreleasedを返しましたが、idleまたは全モデル解放を確認できません")
            return
        if state == "failed":
            raise RuntimeError(f"ComfyUI側のメモリ解放に失敗しました: {result.get('error', '不明')}")
        if state not in {"pending", "busy"}:
            raise RuntimeError(f"メモリ解放APIから不明なstateが返りました: {state!r}")
        time.sleep(POLL_SEC)
    raise TimeoutError(f"{RELEASE_TIMEOUT_SEC // 60}分待ってもメモリ解放を確認できませんでした")


# =====================================================================
# ワークフローの組み立て
# =====================================================================
def load_workflow() -> dict:
    wf = json.loads(WORKFLOW_API.read_text(encoding="utf-8"))
    # 必要なノード・入力欄があるか最初に確認 (ID違いなどを早く気づくため)
    need = {NODE_CHARACTER: "image", NODE_POSE: "image", NODE_NOISE: "noise_seed",
            NODE_SIZE: "megapixels", NODE_REQUEST: "value",
            NODE_UPSAMPLER: "switch", NODE_SAVE: "images"}
    for nid, key in need.items():
        if nid not in wf or key not in wf[nid].get("inputs", {}):
            have = list(wf.get(nid, {}).get("inputs", {}).keys()) if nid in wf else "ノードなし"
            sys.exit(f"workflow_api.json のノード {nid} に入力 '{key}' がありません (実際: {have})。"
                     f"ファイル先頭のノードID設定を確認してください。")
    return wf


def build_prompt(base: dict, char_name: str, pose_name: str, seed: int) -> dict:
    wf = json.loads(json.dumps(base))  # ディープコピー
    wf[NODE_CHARACTER]["inputs"]["image"] = char_name
    wf[NODE_POSE]["inputs"]["image"] = pose_name
    wf[NODE_REQUEST]["inputs"]["value"] = REQUEST
    wf[NODE_NOISE]["inputs"]["noise_seed"] = seed
    wf[NODE_SIZE]["inputs"]["megapixels"] = MEGAPIXELS
    wf[NODE_UPSAMPLER]["inputs"]["switch"] = True
    if PREVIEW_ONLY:  # SaveImage -> PreviewImage (ComfyUIのoutputに残さない)
        wf[NODE_SAVE] = {"class_type": "PreviewImage",
                         "inputs": {"images": wf[NODE_SAVE]["inputs"]["images"]}}
    return wf


# =====================================================================
# 生成1枚分 (他のツールに組み込むときはここを呼べばよい)
# =====================================================================
def generate_one(base_wf: dict, char_name: str, pose_path: Path, out_path: Path) -> int:
    """pose_path を image_2 にして生成し、out_path に保存する。使った seed を返す"""
    pose_name = upload_image(pose_path)
    seed = random.randint(0, 2**53)
    res = http_json("POST", "/prompt", {"prompt": build_prompt(base_wf, char_name, pose_name, seed)})
    entry = wait_for_result(res["prompt_id"])

    status = entry.get("status", {})
    if status.get("status_str") == "error":
        msgs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
        detail = msgs[-1][1].get("exception_message", "") if msgs else "不明"
        raise RuntimeError(f"ComfyUI側でエラー: {detail[:300]}")

    images = entry.get("outputs", {}).get(NODE_SAVE, {}).get("images")
    if not images:
        raise RuntimeError("出力画像が見つかりません")

    # 書き込み途中で止まっても「生成済み」扱いにならないよう、一時ファイル経由で保存
    tmp = out_path.with_name(out_path.name + ".part")
    tmp.write_bytes(fetch_image(images[0]))
    os.replace(tmp, out_path)
    return seed


# =====================================================================
# 未生成リストの作成・メイン処理
# =====================================================================
def natural_key(p: Path):
    """page2 < page10 の順に並べる"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def find_pending(poses_dir: Path, out_dir: Path):
    poses = sorted((p for p in poses_dir.iterdir() if p.suffix.lower() in POSE_EXTS), key=natural_key)
    stems = [p.stem for p in poses]
    for s in {s for s in stems if stems.count(s) > 1}:
        print(f"[警告] 同名のポーズ画像があります (拡張子違い): {s} -> 結果が上書きされます")
    pending = [p for p in poses if not (out_dir / f"{p.stem}{OUT_SUFFIX}.png").exists()]
    return poses, pending


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def main():
    global COMFY_URL, WORKFLOW_API, CHARACTER_IMG, POSES_DIR, OUT_DIR, MEGAPIXELS, POLL_SEC
    ap = argparse.ArgumentParser()
    ap.add_argument("--poses");  ap.add_argument("--out");  ap.add_argument("--char")
    ap.add_argument("--workflow"); ap.add_argument("--url"); ap.add_argument("--mp", type=float)
    ap.add_argument("--poll", type=float); ap.add_argument("--limit", type=int, help="最大N枚で止める")
    ap.add_argument("--dry-run", action="store_true", help="生成せず対象だけ表示")
    a = ap.parse_args()
    if a.poses:    POSES_DIR = Path(a.poses)
    if a.out:      OUT_DIR = Path(a.out)
    if a.char:     CHARACTER_IMG = Path(a.char)
    if a.workflow: WORKFLOW_API = Path(a.workflow)
    if a.url:      COMFY_URL = a.url
    if a.mp:       MEGAPIXELS = a.mp
    if a.poll:     POLL_SEC = a.poll

    for label, p in (("ポーズフォルダ", POSES_DIR), ("workflow_api.json", WORKFLOW_API),
                     ("キャラ画像", CHARACTER_IMG)):
        if not p.exists():
            sys.exit(f"{label} が見つかりません: {p}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    poses, pending = find_pending(POSES_DIR, OUT_DIR)
    log(f"ポーズ {len(poses)} 枚 / 生成済み {len(poses) - len(pending)} 枚 / 未生成 {len(pending)} 枚")
    if a.limit:
        pending = pending[:a.limit]
    if a.dry_run or not pending:
        for p in pending:
            print(f"  -> {p.name}  =>  {p.stem}{OUT_SUFFIX}.png")
        return

    base_wf = load_workflow()
    try:
        require_memory_release_extension()
        char_name = upload_image(CHARACTER_IMG)
    except urllib.error.URLError as e:
        sys.exit(f"ComfyUIまたはNyamuruメモリ解放拡張に接続できません ({COMFY_URL}): {e}")
    except Exception as e:
        sys.exit(f"Nyamuruメモリ解放拡張を確認できません。生成前に配置と再起動を確認してください: {e}")

    failed_txt = OUT_DIR / "failed.txt"
    log_csv = OUT_DIR / "generation_log.csv"
    new_log = not log_csv.exists()

    done = 0
    try:
        for i, pose in enumerate(pending, 1):
            out_path = OUT_DIR / f"{pose.stem}{OUT_SUFFIX}.png"
            log(f"({i}/{len(pending)}) {pose.name} を生成中...")
            t0 = time.time()
            try:
                seed = generate_one(base_wf, char_name, pose, out_path)
            except KeyboardInterrupt:
                raise
            except Exception as e:  # 1枚の失敗で全体を止めず、記録して次へ
                log(f"  失敗: {e}")
                with failed_txt.open("a", encoding="utf-8") as f:
                    f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}\t{pose.name}\t{e}\n")
            else:
                sec = time.time() - t0
                done += 1
                log(f"  保存: {out_path.name} ({sec / 60:.1f}分, seed={seed})")
                with log_csv.open("a", newline="", encoding="utf-8") as f:
                    w = csv.writer(f)
                    if new_log:
                        w.writerow(["time", "pose", "output", "seed", "megapixels", "seconds"])
                        new_log = False
                    w.writerow([datetime.now().isoformat(timespec="seconds"), pose.name,
                                out_path.name, seed, MEGAPIXELS, round(sec)])

            # 成功・失敗にかかわらず、次の画像を送る前にworker側の解放完了を待つ。
            try:
                release_models_and_wait()
            except Exception as e:
                log(f"メモリ解放を確認できないため、次の画像は送らず停止します: {e}")
                with (OUT_DIR / "memory_release_failed.txt").open("a", encoding="utf-8") as f:
                    f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}\t{pose.name}\t{e}\n")
                sys.exit(1)
    except KeyboardInterrupt:
        log("中断します。ComfyUI側の生成も止めます...")
        try:
            http_json("POST", "/interrupt")
        except Exception:
            pass
        log("再実行すれば未生成のポーズから再開します。")
        sys.exit(130)

    log(f"完了: {done}/{len(pending)} 枚。失敗は {failed_txt.name} を見てください。")


if __name__ == "__main__":
    main()
