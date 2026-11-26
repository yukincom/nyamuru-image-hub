import { blobDataUrl, postJson } from './transport.ts';

export interface PageOrientationSuggestion {
  recommendedDegrees: 0 | 90 | 180 | 270;
  rawDegrees: 0 | 90 | 180 | 270;
  confidence: number;
  applied: boolean;
  model: string;
  fallbackReason?: string;
}

function toDegrees(value: unknown): 0 | 90 | 180 | 270 {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

async function thumbnailDataUrl(file: Blob): Promise<string> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return canvas.toDataURL('image/jpeg', 0.9);
      }
      bitmap.close();
    } catch {
      // Fallback below when createImageBitmap cannot decode the file.
    }
  }
  if (typeof FileReader !== 'undefined') return blobDataUrl(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${file.type || 'image/png'};base64,${btoa(binary)}`;
}

/** M7: 原稿サムネイルから推奨正立角度（0/90/180/270）を推定する。 */
export async function estimatePageOrientation(file: Blob): Promise<PageOrientationSuggestion> {
  const payload = await postJson('/api/layout/orientation', {
    image: await thumbnailDataUrl(file),
  }, 15_000) as Record<string, unknown>;
  const confidence = typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)
    ? Math.min(1, Math.max(0, payload.confidence))
    : 0;
  return {
    recommendedDegrees: toDegrees(payload.recommended_degrees),
    rawDegrees: toDegrees(payload.raw_degrees),
    confidence,
    applied: payload.applied === true,
    model: typeof payload.model === 'string' ? payload.model : 'none',
    ...(typeof payload.fallback_reason === 'string' && payload.fallback_reason
      ? { fallbackReason: payload.fallback_reason }
      : {}),
  };
}
