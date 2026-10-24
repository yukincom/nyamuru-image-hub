const STORAGE_KEY = 'nyamuru.paint-bleed-px.v1';
export const DEFAULT_PAINT_BLEED_PX = 200;

export function normalizePaintBleed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 4000) {
    throw new Error('ぬりたしは0〜4000pxの整数で指定してください');
  }
  return value;
}

export function loadPaintBleed(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw == null ? DEFAULT_PAINT_BLEED_PX : normalizePaintBleed(JSON.parse(raw));
  } catch { return DEFAULT_PAINT_BLEED_PX; }
}

export function savePaintBleed(storage: Pick<Storage, 'setItem'>, value: number): number {
  const next = normalizePaintBleed(value);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

const SMOOTHING_KEY='nyamuru.paint-smoothing.v1';
export function loadPaintSmoothing(storage?:Pick<Storage,'getItem'>):number {
  try {const value=JSON.parse(storage?.getItem(SMOOTHING_KEY)??'0');return Number.isInteger(value)&&value>=0&&value<=15?value:0;}catch{return 0;}
}
export function savePaintSmoothing(storage:Pick<Storage,'setItem'>,value:number):number {
  if(!Number.isInteger(value)||value<0||value>15)throw new Error('手ぶれ補正は0〜15で指定してください');
  storage.setItem(SMOOTHING_KEY,JSON.stringify(value));return value;
}

const EDIT_GUIDE_KEY='nyamuru.edit-guide.v1';
export function loadEditGuide(storage?:Pick<Storage,'getItem'>):boolean {
  try{return storage?.getItem(EDIT_GUIDE_KEY)!=='false';}catch{return true;}
}
export function saveEditGuide(storage:Pick<Storage,'setItem'>,enabled:boolean):boolean {
  storage.setItem(EDIT_GUIDE_KEY,String(enabled));return enabled;
}

export type PaintCursorMode='circle'|'crosshair';
const CURSOR_KEY='nyamuru.paint-cursor.v1';
export function loadPaintCursor(storage?:Pick<Storage,'getItem'>):PaintCursorMode {
  try{return storage?.getItem(CURSOR_KEY)==='crosshair'?'crosshair':'circle';}catch{return 'circle';}
}
export function savePaintCursor(storage:Pick<Storage,'setItem'>,mode:PaintCursorMode):void {
  storage.setItem(CURSOR_KEY,mode);
}
