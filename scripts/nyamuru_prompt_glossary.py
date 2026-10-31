"""Read bundled Japanese phrase hints for the existing local prompt translator."""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
import re
import unicodedata


GLOSSARY_PATH = Path(__file__).resolve().parent / 'prompt_glossary' / 'moss_image_natural_language_ja.csv'
MAX_HINTS = 24
MAX_HINT_CHARACTERS = 6000
JAPANESE = re.compile(r'[\u3040-\u30ff\u3400-\u9fff]')


def normalized(value: str) -> str:
    return unicodedata.normalize('NFKC', value).casefold().strip()


def read_glossary(path: Path) -> tuple[tuple[str, str, str], ...]:
    """Keep Japanese aliases with one unambiguous English meaning; never execute CSV content."""
    meanings: dict[str, dict[str, str]] = {}
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, strict=True)
        if reader.fieldnames != ['tag', 'ja', 'aliases']:
            raise ValueError('画像生成用語集の列が正しくありません')
        for row in reader:
            if set(row) != {'tag', 'ja', 'aliases'} or any(value is None for value in row.values()):
                raise ValueError('画像生成用語集の行が正しくありません')
            english = row['tag'].strip()
            if not english or not row['ja'].strip():
                raise ValueError('画像生成用語集の日英対訳が正しくありません')
            # A bundled example contains authored Japanese dialogue. It must not
            # become on-page text merely because a similar instruction matched.
            if JAPANESE.search(english):
                continue
            for japanese in [row['ja'], *re.split(r'[,;]', row['aliases'])]:
                japanese = japanese.strip()
                key = normalized(japanese)
                if len(key) >= 2 and JAPANESE.search(key):
                    meanings.setdefault(key, {})[english] = japanese
    return tuple((key, next(iter(options.values())), next(iter(options)))
                 for key, options in meanings.items() if len(options) == 1)


@lru_cache(maxsize=1)
def bundled_glossary() -> tuple[tuple[str, str, str], ...]:
    return read_glossary(GLOSSARY_PATH)


def glossary_hints(texts: list[str]) -> list[dict[str, str]]:
    """Select leftmost, longest phrase matches without rewriting any source text."""
    entries = bundled_glossary()
    hints: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    characters = 0
    for text in texts:
        source = normalized(text)
        matches = []
        for key, japanese, english in entries:
            start = source.find(key)
            if start >= 0:
                matches.append((start, -len(key), japanese, english))
        end = 0
        for start, negative_length, japanese, english in sorted(matches):
            if start < end:
                continue
            end = start - negative_length
            identity = (japanese, english)
            if identity in seen:
                continue
            size = len(japanese) + len(english)
            if len(hints) >= MAX_HINTS or characters + size > MAX_HINT_CHARACTERS:
                return hints
            hints.append({'ja': japanese, 'en': english})
            seen.add(identity)
            characters += size
    return hints
