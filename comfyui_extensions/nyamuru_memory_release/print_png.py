"""Save the final ComfyUI image at its native pixel size and manuscript DPI."""
import json
from pathlib import Path

import folder_paths
import numpy as np
from comfy.cli_args import args
from nodes import SaveImage
from PIL import Image, PngImagePlugin


class NyamuruSavePrintPNG(SaveImage):
    @classmethod
    def INPUT_TYPES(cls):
        spec = super().INPUT_TYPES()
        spec["required"]["dpi"] = ("FLOAT", {"default": 600.0, "min": 1.0, "max": 10000.0})
        return spec

    def save_images(self, images, filename_prefix, dpi, prompt=None, extra_pnginfo=None):
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images.shape[2], images.shape[1])
        info = PngImagePlugin.PngInfo()
        if not args.disable_metadata:
            if prompt is not None:
                info.add_text("prompt", json.dumps(prompt))
            for key, value in (extra_pnginfo or {}).items():
                info.add_text(key, json.dumps(value))
        results = []
        for index, pixels in enumerate(images):
            filename = f'{name.replace("%batch_num%", str(index))}_{counter+index:05}_.png'
            image = Image.fromarray(np.clip(pixels.cpu().numpy()*255, 0, 255).astype(np.uint8))
            image.save(Path(folder)/filename, pnginfo=info, dpi=(dpi,dpi), compress_level=self.compress_level)
            results.append({"filename": filename, "subfolder": subfolder, "type": self.type})
        return {"ui": {"images": results}, "result": (images,)}
