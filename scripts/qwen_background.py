"""Remove edge-connected white background without loading an image model."""
import io
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def remove_chroma_background(raw, settings, *, dpi=None, polygon=None):
    """Key the chosen colour throughout the image, preserving interior foreground RGB."""
    import numpy as np
    colors = {'#00FF00': (0, 255, 0), '#0000FF': (0, 0, 255), '#FF00FF': (255, 0, 255)}
    color = colors[settings['color']]
    with Image.open(io.BytesIO(raw)) as source:
        pixels = np.array(source.convert('RGBA'), dtype=np.uint8)
    rgb = pixels[:, :, :3].astype(np.float32) / 255
    key = np.array(color, dtype=np.float32) / 255
    active = key > 0
    primary = np.min(rgb[:, :, active], axis=2)
    secondary = np.max(rgb[:, :, ~active], axis=2)
    pure = (secondary <= 0.05) & (primary >= 0.65)
    scale = float(np.percentile(primary[pure], 10)) if np.any(pure) else 1.0
    keyed_rgb = rgb.copy()
    keyed_rgb[:, :, active] = np.clip(rgb[:, :, active] / max(scale, 0.65), 0, 1)
    distance = np.sqrt(np.mean((keyed_rgb - key) ** 2, axis=2))
    alpha = np.clip((distance - settings['similarity']) / settings['blend'], 0, 1)
    if settings.get('despill'):
        cut = Image.fromarray(np.where(alpha < 1, 255, 0).astype(np.uint8))
        boundary = (np.asarray(cut.filter(ImageFilter.MaxFilter(5))) > 0) & (alpha > 0)
        corrected = rgb.copy()
        if settings['color'] == '#00FF00':
            corrected[:, :, 1] = np.minimum(rgb[:, :, 1], np.maximum(rgb[:, :, 0], rgb[:, :, 2]))
        elif settings['color'] == '#0000FF':
            corrected[:, :, 2] = np.minimum(rgb[:, :, 2], np.maximum(rgb[:, :, 0], rgb[:, :, 1]))
        else:
            excess = np.maximum(0, np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1])
            corrected[:, :, 0] -= excess
            corrected[:, :, 2] -= excess
        pixels[:, :, :3][boundary] = np.rint(np.clip(corrected[boundary], 0, 1) * 255).astype(np.uint8)
    pixels[:, :, 3] = np.rint(pixels[:, :, 3].astype(np.float32) * alpha).astype(np.uint8)
    output = io.BytesIO()
    image = Image.fromarray(pixels)
    if polygon:
        mask = Image.new('L', image.size, 0)
        ImageDraw.Draw(mask).polygon([(x*image.width, y*image.height) for x,y in polygon], fill=255)
        image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    image.save(output, format='PNG', **({'dpi': (dpi,dpi)} if dpi else {}))
    return output.getvalue()


def remove_white_background(raw):
    """Keep enclosed white areas. Feather only the exterior antialiased edge."""
    with Image.open(io.BytesIO(raw)) as source:
        image = source.convert('RGBA')
    rgb = image.convert('RGB')
    red, green, blue = rgb.split()
    light = ImageChops.darker(ImageChops.darker(red, green), blue)
    # The added white border lets a single fill reach all four canvas edges.
    walkable = light.point(lambda value: 255 if value >= 240 else 0)
    padded = Image.new('L', (image.width + 2, image.height + 2), 255)
    padded.paste(walkable, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    exterior = padded.crop((1, 1, image.width + 1, image.height + 1)).point(lambda value: 255 if value == 128 else 0)
    alpha = ImageChops.multiply(image.getchannel('A'), ImageChops.invert(exterior))
    # Unmatte just the one-pixel neutral edge against white, avoiding a white halo.
    edge = ImageChops.subtract(exterior.filter(ImageFilter.MaxFilter(3)), exterior)
    pixels, opacity, border = image.load(), alpha.load(), edge.load()
    bounds = edge.getbbox()
    if bounds:
        for y in range(bounds[1], bounds[3]):
            for x in range(bounds[0], bounds[2]):
                if not border[x, y]:
                    continue
                r, g, b, _ = pixels[x, y]
                if min(r, g, b) < 32 or max(r, g, b) - min(r, g, b) > 16:
                    continue
                coverage = 255 - min(r, g, b)
                if coverage:
                    pixels[x, y] = tuple(max(0, min(255, round((channel - 255 + coverage) * 255 / coverage))) for channel in (r, g, b)) + (255,)
                    opacity[x, y] = round(opacity[x, y] * coverage / 255)
    image.putalpha(alpha)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()
