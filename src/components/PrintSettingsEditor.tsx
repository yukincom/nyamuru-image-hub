import { useState } from 'preact/hooks';
import { OUTPUT_FORMAT_OPTIONS } from '../lib/finishLayout';
import { mmToUnit, unitToMm, PRINTER_NAMES, paperSizesForPrinter, applyPrinterPreset, printerDpi, paperSizeId, validatePrintSetup, type PrintSetup, type PrintUnit } from '../lib/printSettings';
import { innerFrameBounds } from '../lib/canvasGeometry';
import '../styles/print-settings.css';

interface Props {
  initial: PrintSetup;
  onConfirm: (setup: PrintSetup) => void;
  onCancel?: () => void;
  lockedPageCount?: number;
  confirmLabel?: string;
  /** Form id for a submit button in the parent's navigation; hides local actions. */
  externalFormId?: string;
}
const dpiOptions = (format: string) => format === 'モノクロ漫画' ? [600, 1200] : format === 'グレースケール漫画' ? [350, 600] : [350];

export default function PrintSettingsEditor({ initial, onConfirm, onCancel, lockedPageCount, confirmLabel = '設定完了', externalFormId }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [paper, setPaper] = useState(() => paperSizeId(initial));
  const [purposeDrafts, setPurposeDrafts] = useState<Partial<Record<PrintSetup['purpose'], PrintSetup>>>({});
  const [error, setError] = useState('');
  const [dpiKeepsPixels, setDpiKeepsPixels] = useState(false);
  const manga = draft.purpose === 'manga';
  const paperSizes = paperSizesForPrinter(draft.printer);
  const unit = manga ? 'mm' : draft.unit;
  const bodyCount = lockedPageCount ?? (manga ? draft.body_pages : 1);
  const patch = (change: Partial<PrintSetup>) => { setDraft(current => ({ ...current, ...change })); setError(''); };
  const changePurpose = (purpose: PrintSetup['purpose']) => {
    if (purpose === draft.purpose) return;
    const next = purposeDrafts[purpose] ?? { ...structuredClone(draft), purpose,
      format: purpose === 'illustration' ? 'カラー漫画' : 'モノクロ漫画',
      dpi: purpose === 'illustration' ? 350 : 600,
      bleed_mm: purpose === 'illustration' ? 0 : 3,
      safe_margin_mm: purpose === 'illustration' ? 0 : 5,
    };
    setPurposeDrafts({ ...purposeDrafts, [draft.purpose]: draft });
    patch(next);
    setPaper(paperSizeId(next));
  };
  const changeDpi = (dpi: number, extra: Partial<PrintSetup> = {}) => {
    if (unit === 'px' && dpiKeepsPixels && Number.isFinite(dpi) && dpi > 0) {
      patch({ ...extra, dpi, width_mm: draft.width_mm * draft.dpi / dpi, height_mm: draft.height_mm * draft.dpi / dpi });
      setPaper('custom');
    } else patch({ ...extra, dpi });
  };
  const numberInput = (label: string, value: number, update: (value: number) => void, min = 0, step: number | string = 'any') => <label class="print-field"><span>{label}</span><input aria-label={label} type="number" min={min} step={step} value={Number.isFinite(value) ? value : ''} onInput={e => update(e.currentTarget.valueAsNumber)} /></label>;
  const colors = (label: string, value: string, update: (value: string) => void) => <label class="print-field"><span>{label}</span><select aria-label={label} value={value} onChange={e => update(e.currentTarget.value)}>
    {!OUTPUT_FORMAT_OPTIONS.some(p => p.value === value) && <option value={value}>{value}（現在の設定）</option>}
    {OUTPUT_FORMAT_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
  </select></label>;
  const resolution = (label: string, format: string, value: number, update: (value: number) => void) => <label class="print-field"><span>{label}</span><select aria-label={label} value={value} onChange={e => update(Number(e.currentTarget.value))}>
    {!dpiOptions(format).includes(value) && <option value={value}>カスタム</option>}
    {dpiOptions(format).map(dpi => <option key={dpi} value={dpi}>{dpi} dpi</option>)}
  </select></label>;
  const width = Math.max(1, Number.isFinite(draft.width_mm) ? draft.width_mm : 1);
  const height = Math.max(1, Number.isFinite(draft.height_mm) ? draft.height_mm : 1);
  const bleedMm = Math.max(0, Number.isFinite(draft.bleed_mm) ? draft.bleed_mm : 0);
  // 定型用紙は同一縮尺。大きなカスタム原稿だけ表示枠へ収める。
  const scale = Math.min(0.38, 296 / (width * 2 + bleedMm * 4), 184 / (height + bleedMm * 2));
  const bleed = bleedMm * scale;
  const gap = Math.max(12, bleed * 2 + 4);
  const paperY = (200 - height * scale) / 2;
  const previewPages = manga ? [
    { x: (320 - gap) / 2 - width * scale, number: draft.binding === 'right' ? '❷' : '❶' },
    { x: (320 + gap) / 2, number: draft.binding === 'right' ? '❶' : '❷' },
  ] : [{ x: (320 - width * scale) / 2, number: '' }];
  const inner = innerFrameBounds({ w: width, h: height });
  const colorDpi = (format: string, current: number, part: 'body' | 'cover') =>
    printerDpi(draft.printer, format, part) ?? (PRINTER_NAMES.includes(draft.printer) || dpiOptions(format).includes(current) ? current : dpiOptions(format)[0]);
  return <form id={externalFormId} class="print-settings-editor" aria-label="印刷・原稿設定" noValidate onSubmit={event => {
    event.preventDefault();
    try { onConfirm(validatePrintSetup({ ...draft, body_pages: bodyCount })); }
    catch (err) { setError(err instanceof Error ? err.message : '設定を確認してください'); }
  }}>
    <div class="print-settings-heading"><h3>印刷・原稿設定</h3><div class="print-purpose" role="group" aria-label="作品の用途">
      <button type="button" aria-pressed={manga} onClick={() => changePurpose('manga')}>漫画</button>
      <button type="button" aria-pressed={!manga} onClick={() => changePurpose('illustration')}>イラスト</button>
    </div></div>
    <div class="print-paper-layout"><div class="print-main-fields">
      <div class="print-field-grid">
        <div class="print-field"><div class="print-size-label"><span>{manga ? '仕上がりサイズ' : '出力サイズ'}</span>{!manga && <select aria-label="サイズの単位" value={unit} onChange={e => patch({ unit: e.currentTarget.value as PrintUnit })}>{(['mm', 'cm', 'in', 'px', 'pt'] as const).map(u => <option key={u} value={u}>{u}</option>)}</select>}</div><select aria-label="用紙サイズ" value={paper} onChange={e => {
          const id = e.currentTarget.value; setPaper(id);
          const size = paperSizes.find(p => p.id === id);
          if (size) patch(draft.width_mm > draft.height_mm ? { width_mm: size.height, height_mm: size.width } : { width_mm: size.width, height_mm: size.height });
        }}>{paperSizes.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}<option value="custom">カスタム</option></select></div>
        <label class="print-field"><span>向き</span><select aria-label="用紙の向き" value={draft.width_mm > draft.height_mm ? 'landscape' : 'portrait'} onChange={e => {
          const landscape = e.currentTarget.value === 'landscape';
          if (landscape !== (draft.width_mm > draft.height_mm)) patch({ width_mm: draft.height_mm, height_mm: draft.width_mm });
        }}><option value="portrait">縦</option><option value="landscape">横</option></select></label>
        {colors('基本表現色', draft.format, format => changeDpi(colorDpi(format, draft.dpi, 'body'), { format }))}
        {resolution('解像度', draft.format, draft.dpi, changeDpi)}
        {paper === 'custom' && <>
          {numberInput(`幅（${unit}）`, Number(mmToUnit(draft.width_mm, unit, draft.dpi).toFixed(5)), value => patch({ width_mm: unitToMm(value, unit, draft.dpi) }), 0.001)}
          {numberInput(`高さ（${unit}）`, Number(mmToUnit(draft.height_mm, unit, draft.dpi).toFixed(5)), value => patch({ height_mm: unitToMm(value, unit, draft.dpi) }), 0.001)}
        </>}
        {manga && numberInput('塗り足し（mm）', draft.bleed_mm, bleed_mm => patch({ bleed_mm }), 0, 0.1)}
        {manga && <label class="print-field"><span>綴じ方向</span><select aria-label="綴じ方向" value={draft.binding} onChange={e => patch({ binding: e.currentTarget.value as PrintSetup['binding'] })}><option value="right">右綴じ</option><option value="left">左綴じ</option></select></label>}
      </div>
      {manga && <label class="print-check"><input type="checkbox" checked={draft.cover.enabled} onChange={e => patch({ cover: { ...draft.cover, enabled: e.currentTarget.checked } })} />表紙を付ける</label>}
    </div>
    <figure class="print-paper-preview"><svg viewBox="0 0 320 200" role="img" aria-label={manga ? `${draft.binding === 'right' ? '右綴じ：右から左' : '左綴じ：左から右'}へ読む紙の見本` : '出力サイズと塗り足しのプレビュー'}>
      {previewPages.map(({ x, number }, index) => <g key={index}>
        <rect data-print-region="bleed" x={x - bleed} y={paperY - bleed} width={width * scale + bleed * 2} height={height * scale + bleed * 2} fill="#dce8e0" stroke="#729087" stroke-width="0.6" />
        <rect data-print-region="trim" x={x} y={paperY} width={width * scale} height={height * scale} fill="white" stroke="#344840" stroke-width="1" />
        {manga && <rect data-print-region="inner" x={x + inner.x * scale} y={paperY + inner.y * scale} width={inner.w * scale} height={inner.h * scale} fill="none" stroke="#729087" stroke-width="0.6" stroke-dasharray="3 2" />}
        {number && <text x={x + width * scale / 2} y="100" text-anchor="middle" dominant-baseline="central" font-size="32" font-weight="700" fill="#273e35">{number}</text>}
      </g>)}
    </svg></figure></div>
    {manga && draft.cover.enabled && <div class="print-cover"><h4>表紙</h4><div class="print-field-grid">
      {colors('表紙の表現色', draft.cover.format, format => patch({ cover: { ...draft.cover, format, dpi: colorDpi(format, draft.cover.dpi, 'cover') } }))}
      {resolution('表紙の解像度', draft.cover.format, draft.cover.dpi, dpi => patch({ cover: { ...draft.cover, dpi } }))}
      <label class="print-field"><span>表紙の構成</span><select aria-label="表紙の構成" value={draft.cover.layout} onChange={e => patch({ cover: { ...draft.cover, layout: e.currentTarget.value as 'separate' | 'spread' } })}><option value="spread">表1・表4を見開きで作る</option><option value="separate">1ページずつ作る</option></select></label>
    </div></div>}
    <details class="print-details"><summary>印刷所を指定する（任意）</summary><div class="print-field-grid">
      <label class="print-field"><span>印刷所</span><select aria-label="印刷所" value={draft.printer} onChange={e => {
        const next = applyPrinterPreset(draft, e.currentTarget.value, paper);
        patch(next); setPaper(paper === 'custom' ? 'custom' : paperSizeId(next));
      }}><option value="">あとで指定する</option>{draft.printer && !PRINTER_NAMES.includes(draft.printer) && <option value={draft.printer}>{draft.printer}</option>}{PRINTER_NAMES.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {draft.printer && <label class="print-field"><span>商品・セット名（任意）</span><input value={draft.product} onInput={e => patch({ product: e.currentTarget.value })} /></label>}
    </div>{draft.printer && <p class="print-note">印刷所を選ぶと標準の寸法・塗り足し・解像度を反映します。商品ごとの指定は調整できます。</p>}</details>
    <details class="print-details"><summary>詳細設定</summary><div class="print-field-grid">
      {!manga && numberInput('塗り足し（mm）', draft.bleed_mm, bleed_mm => patch({ bleed_mm }), 0, 0.1)}
      {numberInput('解像度を数値で指定（dpi）', draft.dpi, changeDpi, 1, 1)}
      {!manga && unit === 'px' && <label class="print-field"><span>解像度を変えるとき</span><select value={dpiKeepsPixels ? 'pixels' : 'physical'} onChange={e => setDpiKeepsPixels(e.currentTarget.value === 'pixels')}><option value="physical">印刷する実寸を保つ</option><option value="pixels">画素数を保つ</option></select></label>}
      {draft.format !== 'カラー漫画' && numberInput('基本線数（lpi）', draft.tone_lpi, tone_lpi => patch({ tone_lpi }), 1, 0.1)}
      {numberInput('安全余白（mm）', draft.safe_margin_mm, safe_margin_mm => patch({ safe_margin_mm }), 0, 0.1)}
      {manga && <label class="print-field"><span>製本方法</span><select value={draft.binding_style} onChange={e => patch({ binding_style: e.currentTarget.value as PrintSetup['binding_style'] })}><option value="unspecified">未指定</option><option value="perfect">無線綴じ</option><option value="saddle">中綴じ</option></select></label>}
      {manga && draft.cover.enabled && <>
        {numberInput('表紙の解像度を数値で指定（dpi）', draft.cover.dpi, dpi => patch({ cover: { ...draft.cover, dpi } }), 1, 1)}
        {draft.cover.layout === 'spread' && numberInput('背幅（mm）', draft.cover.spine_mm, spine_mm => patch({ cover: { ...draft.cover, spine_mm } }), 0, 0.1)}
      </>}
    </div>
      <label class="print-check"><input type="checkbox" checked={draft.crop_marks} onChange={e => patch({ crop_marks: e.currentTarget.checked })} />出力にトンボを付ける</label>
      {manga && <>
        <label class="print-check"><input type="checkbox" checked={draft.folio.enabled} onChange={e => patch({ folio: { ...draft.folio, enabled: e.currentTarget.checked } })} />ノンブル（ページ番号）を付ける</label>
        {draft.folio.enabled && <><div class="print-field-grid">
          {numberInput('開始番号', draft.folio.start, start => patch({ folio: { ...draft.folio, start } }), 0, 1)}
          <label class="print-field"><span>番号の位置</span><select value={draft.folio.position} onChange={e => patch({ folio: { ...draft.folio, position: e.currentTarget.value as PrintSetup['folio']['position'] } })}><option value="outside">下・小口側</option><option value="center">下・中央</option><option value="inside">下・ノド側</option></select></label>
          <label class="print-field"><span>ノンブルの書体</span><input value={draft.folio.font} placeholder="作品の基本書体を使う" onInput={e => patch({ folio: { ...draft.folio, font: e.currentTarget.value } })} /></label>
          {numberInput('ノンブルのサイズ（pt）', draft.folio.size_pt, size_pt => patch({ folio: { ...draft.folio, size_pt } }), 1, 0.5)}
        </div><label class="print-check"><input type="checkbox" checked={draft.folio.hidden} onChange={e => patch({ folio: { ...draft.folio, hidden: e.currentTarget.checked } })} />隠しノンブルを付ける</label></>}
      </>}
      <p class="print-note">塗り足し込み {Number((draft.width_mm + draft.bleed_mm * 2).toFixed(3))} × {Number((draft.height_mm + draft.bleed_mm * 2).toFixed(3))} mm。トンボ・ノンブル・安全余白は出力用の設定として保存します。</p>
    </details>
    {error && <p class="print-error" role="alert">{error}</p>}
    {!externalFormId && <div class="print-actions">{onCancel && <button type="button" class="secondary-button" onClick={onCancel}>キャンセル</button>}<button type="submit" class="primary-button">{confirmLabel}</button></div>}
  </form>;
}
