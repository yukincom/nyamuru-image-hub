"""固定したMarkdownと公開ページから出典を読む。"""
from html.parser import HTMLParser
from pathlib import PurePosixPath
import re
from urllib.parse import urljoin, urlparse

from .constants import COMMON_KEYS, MODELS, PAGE_URL, TOKENS, VERBS


# 共通指定を解決しつつ、生のポーズ文を区別する。
def common_sections(markdown: str) -> dict[str, str]:
    result, key = {}, None
    for line in markdown.splitlines():
        if line.startswith("# "):
            key = line[2:].strip().replace(" ", "-")
            if key in result:
                raise ValueError(f"共通見出しが重複しています: {key}")
            result[key] = []
        elif line.startswith("- ") and key:
            result[key].append(line[2:])
    return {key: ". ".join(value) for key, value in result.items()}


def parse_study(markdown: str, common: dict[str, str]) -> list[dict]:
    entries, entry = [], None
    for number, line in enumerate(markdown.splitlines(), 1):
        if line.startswith("# "):
            heading = line[2:].strip()
            if not re.fullmatch(r"[a-z0-9-]+\.png", heading):
                raise ValueError(f"未対応の出典見出しです: {heading}")
            entry = {"slug": heading[:-4], "heading": heading, "line": number, "parts": [], "links": [], "pose": []}
            entries.append(entry)
        elif line.startswith("- ") and entry is not None:
            text = line[2:]
            link = re.fullmatch(r"\[[^\]]+\]\(\.\./\.\./common\.md#([a-z0-9-]+)\)", text)
            if link:
                key = link[1]
                if key not in COMMON_KEYS or not common.get(key):
                    raise ValueError(f"未確認の共通指定です: {key}")
                entry["links"].append(key)
                entry["parts"].append(common[key])
            else:
                if "[" in text or "]" in text:
                    raise ValueError("未対応の参照構文です")
                entry["parts"].append(text)
                entry["pose"].append(text)
    for entry in entries:
        shared = COMMON_KEYS - {"full-body", "overhead-full-body"}
        framing = set(entry["links"]) & {"full-body", "overhead-full-body"}
        if len(entry["pose"]) != 1 or set(entry["links"]) - framing != shared or len(framing) != 1 or len(entry["links"]) != 5:
            raise ValueError(f"出典の構造が変わっています: {entry['slug']}")
        entry["pose_source_text"] = entry.pop("pose")[0]
        entry["original_prompt"] = ". ".join(entry.pop("parts")) + "."
    return entries


# 語形は今回の出典だけに限定し、一般英文の自動解析にしない。
def pose_template(text: str) -> str:
    template = re.sub(r"\bshe\b", "{{subject}}", text)
    template = re.sub(r"\b(behind|beside) her\b(?! (?:back|head|knees))", r"\1 {{object}}", template)
    template = re.sub(r"\bher\b", "{{possessive_adjective}}", template)
    for lemma, singular in VERBS.items():
        template = re.sub(rf"\b{singular}\b", "{{verb:" + lemma + "}}", template)
    if not template.startswith("{{subject}} ") or re.search(r"\b(she|her|hers|herself)\b", template):
        raise ValueError("ポーズ英文のtemplateを確認してください")
    return template


def validate_template(text: str) -> None:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("空のポーズtemplateです")
    for token in re.findall(r"\{\{([^{}]+)\}\}", text):
        if token not in TOKENS and not (token.startswith("verb:") and token[5:] in VERBS):
            raise ValueError(f"未対応のtokenです: {token}")
    if re.search(r"[{}]", re.sub(r"\{\{[^{}]+\}\}", "", text)):
        raise ValueError("templateの括弧が不正です")


class ImageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()
        self.prompts = {}
        self.card = None
        self.in_prompt = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "figure" and "card" in values.get("class", "").split():
            self.card = {"urls": [], "text": []}
        if tag == "p" and self.card is not None:
            self.in_prompt = True
        if tag != "img":
            return
        for key in ("src", "data-src"):
            if values.get(key):
                self.urls.add(urljoin(PAGE_URL, values[key]))
                if self.card is not None:
                    self.card["urls"].append(urljoin(PAGE_URL, values[key]))

    def handle_data(self, data):
        if self.in_prompt and self.card is not None:
            self.card["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "p":
            self.in_prompt = False
        if tag == "figure" and self.card is not None:
            slugs = {PurePosixPath(urlparse(url).path).stem for url in self.card["urls"]}
            if len(slugs) != 1:
                raise ValueError("公開カードの画像対応が不正です")
            slug = slugs.pop()
            if slug in self.prompts:
                raise ValueError("公開カードのslugが重複しています")
            self.prompts[slug] = "".join(self.card["text"])
            self.card = None


def page_prompts(html: str) -> dict[str, str]:
    parser = ImageLinks()
    parser.feed(html)
    return parser.prompts


# 公開HTMLに実在する画像だけを取り込み対象にする。
def image_links(html: str) -> dict[tuple[str, str], str]:
    parser = ImageLinks()
    parser.feed(html)
    result = {}
    for url in sorted(parser.urls):
        parsed = urlparse(url)
        parts = PurePosixPath(parsed.path).parts
        if parsed.scheme != "https" or parsed.netloc != "pyrolistical.github.io" or len(parts) < 4:
            continue
        if parts[-3] not in MODELS or parts[-2] != "pose" or not parts[-1].endswith(".webp"):
            continue
        key = (parts[-1][:-5], parts[-3])
        if key in result and result[key] != url:
            raise ValueError(f"画像URLが重複しています: {key}")
        result[key] = url
    if not result:
        raise ValueError("公開ページにポーズ画像が見つかりません")
    return result
