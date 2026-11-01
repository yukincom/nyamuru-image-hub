import type { Character, CharacterReferenceView, MangaDocument } from '../types.ts';

export const CHARACTER_REFERENCE_VIEWS: Array<{ value: CharacterReferenceView; label: string }> = [
  { value: 'turnaround', label: '三面図・設定画' },
  { value: 'front', label: '正面' },
  { value: 'three-quarter', label: '斜め' },
  { value: 'side', label: '横' },
  { value: 'back', label: '背面' },
  { value: 'expression', label: '表情差分' },
  { value: 'costume', label: '衣装差分' },
  { value: 'other', label: 'その他' },
];

/** 一括解析は未分類だけを補完し、人間が付けた既存分類を上書きしない。 */
export function applySuggestedReferenceView(
  current: CharacterReferenceView | undefined,
  suggested: CharacterReferenceView | undefined,
): CharacterReferenceView {
  const existing = current ?? 'other';
  if (existing !== 'other' || !suggested || suggested === 'other') return existing;
  return suggested;
}

export const CHARACTER_RECOGNITION_FIELDS = [
  { key: 'accessories', label: '装飾・固有マーク' },
  { key: 'hair', label: '髪型' },
  { key: 'face', label: '顔' },
  { key: 'silhouette', label: 'シルエット' },
  { key: 'outfit', label: '衣装' },
] as const;

export interface CharacterReferenceDestination {
  document: MangaDocument;
  seriesId: string;
  characterCatalogId: string;
}

/** 新規シリーズ／人物でも、画像保存より先に台帳と安定IDを確定する。 */
export async function prepareCharacterReferenceDestination(
  document: MangaDocument,
  character: Character,
  persistSeriesCatalog: (source: MangaDocument) => Promise<MangaDocument>,
): Promise<CharacterReferenceDestination> {
  const prepared = await persistSeriesCatalog(document);
  const owner = prepared.manga.characters.find((entry) => (
    entry.localId === character.localId
    || Boolean(character.catalog_id && entry.catalog_id === character.catalog_id)
  ));
  const seriesId = prepared.manga.meta.series_id;
  const characterCatalogId = owner?.catalog_id ?? '';
  if (!seriesId || !characterCatalogId) throw new Error('シリーズ人物の保存先を準備できませんでした');
  return { document: prepared, seriesId, characterCatalogId };
}

function imageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('人物資料画像を読み込めませんでした')); };
    image.src = url;
  });
}

export const CHARACTER_REFERENCE_LONG_EDGE = 351;
export const CHARACTER_REFERENCE_SHORT_EDGE = 248;

export function checkCharacterReferenceSize(width: number, height: number): void {
  if (width < 1 || height < 1) throw new Error('設定画の寸法を確認できません');
  const maxWidth = width >= height ? CHARACTER_REFERENCE_LONG_EDGE : CHARACTER_REFERENCE_SHORT_EDGE;
  const maxHeight = width >= height ? CHARACTER_REFERENCE_SHORT_EDGE : CHARACTER_REFERENCE_LONG_EDGE;
  if (width <= maxWidth && height <= maxHeight) return;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  throw new Error(`設定画は ${width} × ${height} px です（上限 ${maxWidth} × ${maxHeight} px）。推奨寸法 ${targetWidth} × ${targetHeight} px に縮小して選び直してください。`);
}

/** bridgeへ保存する前にブラウザ内でPNGへ統一する。画像選択だけではVLMへ送らない。 */
export async function imageFileToPng(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') && !/\.(?:png|jpe?g|webp|gif|bmp)$/iu.test(file.name)) {
    throw new Error(`${file.name}は画像として読み込めません`);
  }
  const image = await imageElement(file);
  const { naturalWidth: width, naturalHeight: height } = image;
  checkCharacterReferenceSize(width, height);
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('人物資料画像を変換できませんでした');
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('人物資料画像をPNGへ変換できませんでした')),
    'image/png',
  ));
}
