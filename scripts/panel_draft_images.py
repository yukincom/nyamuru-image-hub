"""Validate, quantize, and encode the fixed manga-base draft image."""

from __future__ import annotations

import base64
import io
import zlib
from typing import Any

from panel_draft_workflow import PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT


MANGA_BASE_PALETTE = {
    "ink": "#000000",
    "dense_tone": "#E60012",
    "light_tone": "#00D7E8",
    "paper": "#FFFFFF",
}
MANGA_BASE_RGB = (
    (0, 0, 0),
    (230, 0, 18),
    (0, 215, 232),
    (255, 255, 255),
)
MAX_COMFY_IMAGE_BYTES = 20 * 1024 * 1024

class PanelDraftImages:
    @staticmethod
    def nearest_manga_base_color(red: int, green: int, blue: int, alpha: int = 255) -> tuple[int, int, int, int]:
        if alpha < 128:
            return 255, 255, 255, 255
        chroma = max(red, green, blue) - min(red, green, blue)
        if chroma <= 32:
            luminance = round(0.2126 * red + 0.7152 * green + 0.0722 * blue)
            if luminance < 72:
                return 0, 0, 0, 255
            if luminance < 170:
                return 230, 0, 18, 255
            if luminance < 225:
                return 0, 215, 232, 255
            return 255, 255, 255, 255
        # 輝度への寄与が大きい緑を重くし、生成時の色ぶれを4値へ戻す。
        color = min(
            MANGA_BASE_RGB,
            key=lambda candidate: (
                2 * (red - candidate[0]) ** 2
                + 4 * (green - candidate[1]) ** 2
                + 3 * (blue - candidate[2]) ** 2
            ),
        )
        return color[0], color[1], color[2], 255

    @staticmethod
    def paper_pixels_outside_ink(pixels: list[tuple[int, int, int, int]], width: int, height: int) -> set[int]:
        """黒い線の横または縦スパンに含まれない明るい無彩色を紙に戻す。"""

        row_bounds: list[list[int] | None] = [None] * height
        column_bounds: list[list[int] | None] = [None] * width
        for index, (red, green, blue, alpha) in enumerate(pixels):
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if alpha < 128 or luminance >= 72:
                continue
            x = index % width
            y = index // width
            if row_bounds[y] is None:
                row_bounds[y] = [x, x]
            else:
                row_bounds[y][0] = min(row_bounds[y][0], x)
                row_bounds[y][1] = max(row_bounds[y][1], x)
            if column_bounds[x] is None:
                column_bounds[x] = [y, y]
            else:
                column_bounds[x][0] = min(column_bounds[x][0], y)
                column_bounds[x][1] = max(column_bounds[x][1], y)

        paper: set[int] = set()
        for index, (red, green, blue, alpha) in enumerate(pixels):
            if alpha < 128:
                paper.add(index)
                continue
            chroma = max(red, green, blue) - min(red, green, blue)
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if chroma > 32 or luminance < 170:
                continue
            x = index % width
            y = index // width
            row = row_bounds[y]
            column = column_bounds[x]
            inside_row_ink = row is not None and row[0] <= x <= row[1]
            inside_column_ink = column is not None and column[0] <= y <= column[1]
            if not inside_row_ink and not inside_column_ink:
                paper.add(index)
        return paper

    @classmethod
    def manga_base_png(cls, image_bytes: bytes) -> bytes:
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise RuntimeError("作画用4値画像の変換にはローカルbridgeのPillowが必要です") from exc
        cls.validate_png_bytes(image_bytes)
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                source.load()
                if source.size != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                image = source.convert("RGBA")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("ComfyUIの生成画像を4値画像として読み取れません") from exc

        pixels = list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
        paper = cls.paper_pixels_outside_ink(pixels, *image.size)
        image.putdata([
            (255, 255, 255, 255) if index in paper else cls.nearest_manga_base_color(red, green, blue, alpha)
            for index, (red, green, blue, alpha) in enumerate(pixels)
        ])
        output = io.BytesIO()
        image.convert("RGB").save(output, format="PNG", optimize=True)
        result = output.getvalue()
        if not result or len(result) > MAX_COMFY_IMAGE_BYTES:
            raise ValueError("作画用4値画像が大きすぎます")
        cls.validate_png_bytes(result, require_manga_base=True)
        return result

    @staticmethod
    def _validate_png_container(image_bytes: bytes) -> None:
        if len(image_bytes) < 33 or not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("ComfyUIの生成画像が正しいPNGではありません")
        offset = 8
        saw_ihdr = False
        saw_idat = False
        saw_iend = False
        while offset < len(image_bytes):
            if offset + 12 > len(image_bytes):
                raise ValueError("ComfyUIのPNG chunkが途中で切れています")
            chunk_size = int.from_bytes(image_bytes[offset:offset + 4], "big")
            chunk_type = image_bytes[offset + 4:offset + 8]
            chunk_end = offset + 12 + chunk_size
            if chunk_end > len(image_bytes):
                raise ValueError("ComfyUIのPNG chunkが途中で切れています")
            chunk_data = image_bytes[offset + 8:offset + 8 + chunk_size]
            stored_crc = int.from_bytes(image_bytes[offset + 8 + chunk_size:chunk_end], "big")
            actual_crc = zlib.crc32(chunk_type)
            actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
            if stored_crc != actual_crc:
                raise ValueError("ComfyUIのPNG chunk CRCが一致しません")
            if not saw_ihdr:
                if chunk_type != b"IHDR" or chunk_size != 13:
                    raise ValueError("ComfyUIのPNG IHDRが正しくありません")
                width = int.from_bytes(chunk_data[0:4], "big")
                height = int.from_bytes(chunk_data[4:8], "big")
                if (width, height) != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    # Pillowが展開する前にIHDR寸法を固定し、圧縮bombをfail-closedにする。
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                saw_ihdr = True
            elif chunk_type == b"IHDR":
                raise ValueError("ComfyUIのPNGにIHDRが重複しています")
            if chunk_type == b"IDAT":
                saw_idat = True
            if chunk_type == b"IEND":
                if chunk_size != 0 or not saw_idat or chunk_end != len(image_bytes):
                    raise ValueError("ComfyUIのPNG IENDまたは末尾が正しくありません")
                saw_iend = True
                offset = chunk_end
                break
            offset = chunk_end
        if not saw_ihdr or not saw_idat or not saw_iend or offset != len(image_bytes):
            raise ValueError("ComfyUIのPNGが完全ではありません")

    @classmethod
    def validate_png_bytes(cls, image_bytes: bytes, *, require_manga_base: bool = False) -> None:
        if not isinstance(image_bytes, bytes) or len(image_bytes) > MAX_COMFY_IMAGE_BYTES:
            raise ValueError("ComfyUIの生成画像が空か大きすぎます")
        cls._validate_png_container(image_bytes)
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise RuntimeError("PNGの完全検証にはローカルbridgeのPillowが必要です") from exc
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                if source.format != "PNG" or getattr(source, "n_frames", 1) != 1:
                    raise ValueError("ComfyUIの生成画像が単一PNGではありません")
                source.verify()
            with Image.open(io.BytesIO(image_bytes)) as source:
                source.load()
                if source.size != (PANEL_DRAFT_WIDTH, PANEL_DRAFT_HEIGHT):
                    raise ValueError("ComfyUIの生成画像サイズが固定設定と一致しません")
                if require_manga_base:
                    rgba = source.convert("RGBA")
                    colors = rgba.getcolors(maxcolors=PANEL_DRAFT_WIDTH * PANEL_DRAFT_HEIGHT)
                    allowed = {(red, green, blue, 255) for red, green, blue in MANGA_BASE_RGB}
                    if colors is None or any(color not in allowed for _, color in colors):
                        raise ValueError("作画用4値artifactにパレット外のpixelがあります")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("ComfyUIの生成画像を完全なPNGとして読み取れません") from exc

    @staticmethod
    def result_payload(
        value: dict[str, Any],
        prompt_id: str,
        image_info: dict[str, str],
        manga_base_bytes: bytes,
    ) -> dict[str, Any]:
        download_name = (
            f"manga-base_page_{value['page_number']:04d}_panel_{value['panel_id']:04d}"
            f"_seed_{value['seed']}.png"
        )
        return {
            "image": f"data:image/png;base64,{base64.b64encode(manga_base_bytes).decode('ascii')}",
            "prompt_id": prompt_id,
            "file_name": image_info["filename"],
            "download_name": download_name,
            "subfolder": image_info["subfolder"],
            "profile": value["profile"],
            "palette": MANGA_BASE_PALETTE,
            "checkpoint": value["checkpoint"],
            "seed": value["seed"],
        }
