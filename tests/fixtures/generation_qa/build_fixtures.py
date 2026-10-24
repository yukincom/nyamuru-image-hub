#!/usr/bin/env python3
"""Generate the project-owned synthetic PNG corpus for deterministic QA tests."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import struct
import zlib
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageDraw, PngImagePlugin


PALETTE = {
    "ink": (0, 0, 0),
    "dense_tone": (230, 0, 18),
    "light_tone": (0, 215, 232),
    "paper": (255, 255, 255),
}
GENERATOR_VERSION = 1


def _png_bytes(image: Image.Image, *, metadata: str | None = None, apng_second: Image.Image | None = None) -> bytes:
    output = io.BytesIO()
    pnginfo = None
    if metadata is not None:
        pnginfo = PngImagePlugin.PngInfo()
        pnginfo.add_text("nyamuru-fixture", metadata)
    save_args: dict[str, Any] = {"format": "PNG", "optimize": False, "compress_level": 6}
    if pnginfo is not None:
        save_args["pnginfo"] = pnginfo
    if apng_second is not None:
        save_args.update({"save_all": True, "append_images": [apng_second], "duration": 100, "loop": 0})
    image.save(output, **save_args)
    return output.getvalue()


def _base_image(width: int = 512, height: int = 512) -> Image.Image:
    image = Image.new("RGB", (width, height), PALETTE["paper"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((width // 8, height // 8, width // 3, height // 3), fill=PALETTE["ink"])
    draw.rectangle((width // 2, height // 8, width * 3 // 4, height // 3), fill=PALETTE["dense_tone"])
    draw.rectangle((width // 4, height // 2, width * 3 // 4, height * 3 // 4), fill=PALETTE["light_tone"])
    return image


def _black_white() -> Image.Image:
    image = Image.new("RGB", (512, 512), PALETTE["paper"])
    ImageDraw.Draw(image).rectangle((96, 96, 415, 415), fill=PALETTE["ink"])
    return image


def _nearly_blank() -> Image.Image:
    image = Image.new("RGB", (512, 512), PALETTE["paper"])
    ImageDraw.Draw(image).rectangle((200, 200, 219, 219), fill=PALETTE["ink"])
    return image


def _low_ink() -> Image.Image:
    image = Image.new("RGB", (512, 512), PALETTE["paper"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 100, 299, 199), fill=PALETTE["dense_tone"])
    draw.rectangle((350, 100, 359, 109), fill=PALETTE["ink"])
    return image


def _speckles() -> Image.Image:
    image = Image.new("RGB", (512, 512), PALETTE["paper"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((64, 64, 113, 113), fill=PALETTE["ink"])
    for row in range(10):
        for column in range(10):
            draw.point((300 + column * 5, 300 + row * 5), fill=PALETTE["ink"])
    return image


def _edge_contact() -> Image.Image:
    image = Image.new("RGB", (512, 512), PALETTE["paper"])
    ImageDraw.Draw(image).rectangle((0, 0, 19, 511), fill=PALETTE["ink"])
    return image


def _palette_mode() -> Image.Image:
    source = _base_image()
    image = Image.new("P", source.size, 3)
    palette = [0] * 768
    for index, color in enumerate((PALETTE["ink"], PALETTE["dense_tone"], PALETTE["light_tone"], PALETTE["paper"])):
        palette[index * 3:index * 3 + 3] = list(color)
    image.putpalette(palette)
    pixels = image.load()
    source_pixels = source.load()
    color_indexes = {
        PALETTE["ink"]: 0,
        PALETTE["dense_tone"]: 1,
        PALETTE["light_tone"]: 2,
        PALETTE["paper"]: 3,
    }
    for y in range(source.height):
        for x in range(source.width):
            pixels[x, y] = color_indexes[source_pixels[x, y]]
    return image


def _recipes() -> list[tuple[str, str, str, str, list[str], Callable[[], bytes]]]:
    base = _png_bytes(_base_image())

    def off_palette() -> bytes:
        image = _base_image()
        image.putpixel((256, 256), (1, 2, 3))
        return _png_bytes(image)

    def alpha(non_opaque: bool) -> bytes:
        image = _base_image().convert("RGBA")
        if non_opaque:
            image.putpixel((256, 256), (*PALETTE["light_tone"], 254))
        return _png_bytes(image)

    def apng() -> bytes:
        second = _base_image()
        second.putpixel((256, 256), PALETTE["ink"])
        return _png_bytes(_base_image(), apng_second=second)

    def corrupt_crc() -> bytes:
        data = bytearray(base)
        marker = data.find(b"IDAT")
        if marker < 0:
            raise RuntimeError("generated PNG has no IDAT")
        data[marker + 4] ^= 0x01
        return bytes(data)

    def unsafe_dimension_header() -> bytes:
        data = bytearray(base)
        if data[12:16] != b"IHDR":
            raise RuntimeError("generated PNG has no leading IHDR")
        data[16:24] = struct.pack(">II", 8193, 1)
        data[29:33] = struct.pack(">I", zlib.crc32(data[12:29]) & 0xFFFFFFFF)
        return bytes(data)

    return [
        ("valid-four-color", "valid-four-color.png", "exact RGB four-color manga base", "pass", [], lambda: base),
        ("valid-four-color-copy", "valid-four-color-copy.png", "exact-byte duplicate of valid-four-color", "pass", [], lambda: base),
        ("valid-black-white", "valid-black-white.png", "RGB image using only ink and paper palette slots", "pass", [], lambda: _png_bytes(_black_white())),
        ("warning-nearly-blank", "warning-nearly-blank.png", "400 isolated-from-edge ink pixels on paper", "warn", ["nearly_blank"], lambda: _png_bytes(_nearly_blank())),
        ("warning-nearly-filled", "warning-nearly-filled.png", "all pixels are ink", "warn", ["edge_contact", "nearly_filled"], lambda: _png_bytes(Image.new("RGB", (512, 512), PALETTE["ink"]))),
        ("warning-low-ink", "warning-low-ink.png", "100 ink pixels with a larger dense-tone field", "warn", ["low_ink"], lambda: _png_bytes(_low_ink())),
        ("warning-speckles", "warning-speckles.png", "100 isolated one-pixel components plus one large ink component", "warn", ["speckle_noise"], lambda: _png_bytes(_speckles())),
        ("info-edge-contact", "info-edge-contact.png", "continuous ink strip along the complete left edge", "pass", ["edge_contact"], lambda: _png_bytes(_edge_contact())),
        ("info-metadata", "info-metadata.png", "base pixels plus one project-owned tEXt chunk", "pass", ["embedded_metadata"], lambda: _png_bytes(_base_image(), metadata="project-generated")),
        ("same-pixels-different-metadata", "same-pixels-different-metadata.png", "same decoded base pixels but different PNG metadata", "pass", ["embedded_metadata"], lambda: _png_bytes(_base_image(), metadata="same-pixels-other-container")),
        ("invalid-off-palette", "invalid-off-palette.png", "one RGB pixel is outside the exact four-color palette", "fail", ["off_palette_pixels", "recomposition_mismatch"], off_palette),
        ("invalid-opaque-rgba", "invalid-opaque-rgba.png", "base pixels encoded as opaque RGBA", "fail", ["mode_mismatch"], lambda: alpha(False)),
        ("invalid-alpha", "invalid-alpha.png", "RGBA image containing one non-opaque pixel", "fail", ["mode_mismatch", "non_opaque_pixels"], lambda: alpha(True)),
        ("invalid-palette-mode", "invalid-palette-mode.png", "base pixels encoded as indexed P mode", "fail", ["mode_mismatch"], lambda: _png_bytes(_palette_mode())),
        ("invalid-size-small", "invalid-size-small.png", "511 by 512 RGB image", "fail", ["dimension_mismatch"], lambda: _png_bytes(_base_image(511, 512))),
        ("invalid-size-large", "invalid-size-large.png", "513 by 512 RGB image", "fail", ["dimension_mismatch"], lambda: _png_bytes(_base_image(513, 512))),
        ("invalid-truncated", "invalid-truncated.png", "valid PNG truncated before terminal chunks", "fail", ["png_structure_invalid"], lambda: base[:len(base) // 2]),
        ("invalid-trailing", "invalid-trailing.png", "valid PNG followed by a payload after IEND", "fail", ["png_trailing_bytes"], lambda: base + b"NYAMURU-TRAILING-PAYLOAD"),
        ("invalid-crc", "invalid-crc.png", "one IDAT byte changed without updating its CRC", "fail", ["png_structure_invalid"], corrupt_crc),
        ("invalid-signature", "invalid-signature.png", "PNG signature with the first byte changed", "fail", ["png_signature_invalid"], lambda: b"X" + base[1:]),
        ("invalid-unsafe-dimension", "invalid-unsafe-dimension.png", "IHDR width is 8193 pixels and rejected before decode", "fail", ["image_dimensions_unsafe"], unsafe_dimension_header),
        ("invalid-apng", "invalid-apng.png", "two-frame RGB APNG", "fail", ["animated_png_not_allowed"], apng),
    ]


def build(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    generator_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    cases: list[dict[str, Any]] = []
    for case_id, file_name, semantics, expected_status, finding_codes, factory in _recipes():
        image_bytes = factory()
        (output_dir / file_name).write_bytes(image_bytes)
        source_snapshot_sha256 = hashlib.sha256(
            f"generation-qa-fixture-v{GENERATOR_VERSION}:{generator_sha256}:{case_id}".encode("utf-8")
        ).hexdigest()
        cases.append({
            "case_id": case_id,
            "file_name": file_name,
            "artifact_sha256": hashlib.sha256(image_bytes).hexdigest(),
            "source_snapshot_sha256": source_snapshot_sha256,
            "expected_status": expected_status,
            "expected_finding_codes": sorted(finding_codes),
            "expected_pixel_semantics": semantics,
        })
    cases.sort(key=lambda item: item["case_id"])
    manifest = {
        "schema_name": "nyamuru-generation-qa-fixture-manifest",
        "schema_version": 1,
        "kind": "project-generated-synthetic",
        "cases": cases,
    }
    provenance = {
        "schema_name": "nyamuru-generation-qa-fixture-provenance",
        "schema_version": 1,
        "kind": "project-generated-synthetic",
        "generator": "build_fixtures.py",
        "generator_sha256": generator_sha256,
        "generator_version": GENERATOR_VERSION,
        "external_assets": False,
        "external_network": False,
        "models_used": [],
        "license": "MIT (same as project source)",
        "reproducibility_note": "PNG container bytes may vary with Pillow/zlib; tests compare checked-in hashes and regenerated decoded semantics separately.",
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output_dir / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    build(args.output_dir.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
