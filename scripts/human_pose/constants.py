"""取得元とカタログの固定条件。"""
from pathlib import Path
import json

REVISION = "5fcb3705e02a2fa7777708e432ac00aa73e43dd1"
REPOSITORY = "Pyrolistical/krea-2-qwen-image-2-1-study"
PAGE_URL = "https://pyrolistical.github.io/krea-2-qwen-image-2-1-study/pose"
RAW_URL = f"https://raw.githubusercontent.com/{REPOSITORY}/{REVISION}/"
ROOT = Path(__file__).resolve().parents[2] / ".human_pose"
DATA = Path(__file__).with_name("data")
CATEGORIES = {
    "01-standing": 12,
    "02-leaning-and-supported": 11,
    "03-holding-a-handle-with-one-arm": 10,
    "04-holding-a-handle-with-both-arms": 10,
    "05-sitting": 11,
    "06-squatting": 8,
    "07-lying-down": 6,
}
MODELS = ("krea-2", "qwen-image-2.1")
COMMON_KEYS = {"full-body", "overhead-full-body", "slim-woman", "study-hair", "white-t-shirt-and-jeans", "looking-left"}
TOKENS = {"subject", "object", "possessive_adjective", "possessive_pronoun", "reflexive"}
VERBS = json.loads((DATA / "grammar.json").read_text())["verbs"]
SOURCE_HASHES = {
    "common.md": "5c72d11f26246855181bd161f7d1651dfaeff74179397e845f1e20f1240615d6",
    "LICENSE": "728ba988dc014aabc72fe62d2aa77c55ba908f7ed72d5c6a9328b1b8f31340f9",
    "study/pose/01-standing.md": "cc977c2e58e163d366f63fa2a9c1c7d8bb3cdab532ce9c5d5dc74d7b3b30c074",
    "study/pose/02-leaning-and-supported.md": "633f2ed89c90fc0b7d07d4211c5caffdafca56f53462f399eea2c22f46708f0e",
    "study/pose/03-holding-a-handle-with-one-arm.md": "8c145e9f4141ad462ee5b0d02a70aa0289146ed3d433ffb3ec923d831e6f06da",
    "study/pose/04-holding-a-handle-with-both-arms.md": "5eafad5e9ef53bc48db6cc6713fa6ad7e8b8e60aa8cd8ddfdffe406321065f47",
    "study/pose/05-sitting.md": "0ece990c975695ec7b328015d59aa8973788288218d607f50639ebc27e115432",
    "study/pose/06-squatting.md": "3a29ae4fbc772a005629adab6989f5205ab13253b75a91ba3c195032737a2045",
    "study/pose/07-lying-down.md": "7c3780c0533196431f32004a34d4daf6ac5e030417b682d22c9304de6b9224f0",
}
