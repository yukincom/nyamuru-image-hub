import type { MangaDocument, ValidationIssue, Bubble } from '../../types';
import { NDM_SCHEMA_NAME, CURRENT_NDM_SCHEMA_VERSION, MATERIAL_SCOPES, MAX_PANELS_PER_PAGE, BUBBLE_SHAPES, SCREEN_TEXT_ORIENTATIONS, BLEED_EDGES, FIGURE_SIZES, FIGURE_ROLES } from './schema.ts';
import { validTextStyle, validTextRuns } from '../textStyle.ts';
import { LETTERING_PENS, LETTERING_EXPRESSIONS } from '../handwrittenStyle.ts';
import { isBubbleBezier } from '../bubbleBezier.ts';
import { isCharacterGender } from '../characterGender.ts';
import { isPropPlacement } from '../catalogModel.ts';
import { isDetectedFigureCharacter } from '../systemCharacters.ts';

export function validateManga(document: MangaDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const manga = document?.manga;
  if (!manga) return [{ level: 'error', path: 'manga', message: 'manga ルートが必要です' }];
  if(manga.generated_image_sequence!==undefined&&(!Number.isSafeInteger(manga.generated_image_sequence)||manga.generated_image_sequence<0))issues.push({level:'error',path:'manga.generated_image_sequence',message:'生成画像番号は0以上の整数で指定してください'});
  if (manga.schema_name !== NDM_SCHEMA_NAME) issues.push({ level: 'error', path: 'manga.schema_name', message: `固定値「${NDM_SCHEMA_NAME}」にしてください` });
  if (manga.schema_version !== CURRENT_NDM_SCHEMA_VERSION) issues.push({ level: 'warning', path: 'manga.schema_version', message: `NDMスキーマは v${CURRENT_NDM_SCHEMA_VERSION} です（現在 v${manga.schema_version ?? '不明'}）` });
  if (manga.meta?.page_count !== manga.pages?.length) issues.push({ level: 'error', path: 'manga.meta.page_count', message: `pages の実数 ${manga.pages?.length ?? 0} と一致しません` });
  if (!['story', 'series-catalog'].includes(manga.meta?.document_type)) {
    issues.push({ level: 'error', path: 'manga.meta.document_type', message: '文書種別は story / series-catalog のいずれかが必須です' });
  }
  const fixed = [['reading_direction', 'right-to-left'], ['text_orientation', 'vertical']] as const;
  fixed.forEach(([key, value]) => {
    if (manga.meta?.[key] !== value) issues.push({ level: 'error', path: `manga.meta.${key}`, message: `固定値「${value}」にしてください` });
  });
  if (!manga.meta?.font?.trim()) issues.push({ level: 'error', path: 'manga.meta.font', message: '作品全体の既定フォントを指定してください' });
  if (!Number.isFinite(manga.meta?.bubble_line_width_mm) || manga.meta.bubble_line_width_mm < 0.1 || manga.meta.bubble_line_width_mm > 2) {
    issues.push({ level: 'error', path: 'manga.meta.bubble_line_width_mm', message: 'フキダシ線幅は0.1〜2mmで指定してください' });
  }
  const materialKeys = new Set((manga.materials ?? []).map((item) => item.key));
  const materialsByKey = new Map((manga.materials ?? []).map((item) => [item.key, item]));
  const characterNames = new Set((manga.characters ?? []).map((item) => item.name));
  const validateTextStyle = (item:Pick<Bubble,'text'|'text_style'|'text_runs'>,path:string) => {
    if(item.text_style!==undefined&&!validTextStyle(item.text_style))issues.push({level:'error',path:`${path}.text_style`,message:'文字設定は方向・書体・サイズ（4〜144 pt）・太さ（1〜1000）・斜体・下線・取り消し線・行揃えを指定してください'});
    if(item.text_runs!==undefined&&!validTextRuns(item.text_runs,item.text??''))issues.push({level:'error',path:`${path}.text_runs`,message:'文字のスタイル範囲が本文と一致していません'});
  };
  const validateBubbleTail = (bubble: Bubble, path: string) => {
    validateTextStyle(bubble,path);
    if(bubble.lettering_pen!==undefined&&!LETTERING_PENS.some(option=>option.id===bubble.lettering_pen))issues.push({level:'error',path:`${path}.lettering_pen`,message:'描き文字のペンは登録済みのIDで指定してください'});
    if(bubble.lettering_expressions!==undefined&&(!Array.isArray(bubble.lettering_expressions)||bubble.lettering_expressions.some(id=>!LETTERING_EXPRESSIONS.some(option=>option.id===id))||new Set(bubble.lettering_expressions).size!==bubble.lettering_expressions.length))issues.push({level:'error',path:`${path}.lettering_expressions`,message:'描き文字の表現は登録済みのIDを重複なしで指定してください'});
    if(bubble.lettering_description!==undefined&&typeof bubble.lettering_description!=='string')issues.push({level:'error',path:`${path}.lettering_description`,message:'描き文字の描き方は文章で指定してください'});
    if(bubble.lettering_depth!==undefined&&!['front','behind'].includes(bubble.lettering_depth))issues.push({level:'error',path:`${path}.lettering_depth`,message:'描き文字の重なりは front（手前）または behind（後ろ）を指定してください'});
    if(bubble.lettering_guide_hidden!==undefined&&typeof bubble.lettering_guide_hidden!=='boolean')issues.push({level:'error',path:`${path}.lettering_guide_hidden`,message:'文字あたりの非表示は true / false で指定してください'});
    if(bubble.line_width_mm!==undefined&&(!Number.isFinite(bubble.line_width_mm)||bubble.line_width_mm<=0)){
      issues.push({level:'error',path:`${path}.line_width_mm`,message:'フキダシ個別の線幅は0より大きい有限のmm値を指定してください'});
    }
    if (bubble.clip_to_panel !== undefined && typeof bubble.clip_to_panel !== 'boolean') {
      issues.push({ level: 'error', path: `${path}.clip_to_panel`, message: 'コマ枠での切り取りは true / false で指定してください' });
    }
    if (bubble.text_position !== undefined && (!Number.isFinite(bubble.text_position?.x) || !Number.isFinite(bubble.text_position?.y))) {
      issues.push({ level: 'error', path: `${path}.text_position`, message: '本文位置はフキダシbboxを基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (bubble.bezier !== undefined && !isBubbleBezier(bubble.bezier)) {
      issues.push({ level: 'error', path: `${path}.bezier`, message: 'ベジェ輪郭は3〜128点で、点とハンドルを有限の座標で指定してください' });
    }
    if (bubble.tail_root !== undefined && (!Number.isFinite(bubble.tail_root.x) || !Number.isFinite(bubble.tail_root.y))) {
      issues.push({ level: 'error', path: `${path}.tail_root`, message: 'しっぽ根元はフキダシ枠を基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (bubble.tail_style !== undefined && !['normal','thinking'].includes(bubble.tail_style)) {
      issues.push({level:'error',path:`${path}.tail_style`,message:'しっぽの種類は normal または thinking を指定してください'});
    }
    if (bubble.tail === undefined || bubble.tail === false) return;
    if (!bubble.tail || typeof bubble.tail !== 'object' || !Number.isFinite(bubble.tail.x) || !Number.isFinite(bubble.tail.y)) {
      issues.push({ level: 'error', path: `${path}.tail`, message: 'しっぽ先端は人物枠を基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (!bubble.speaker?.trim()) {
      issues.push({ level: 'warning', path: `${path}.tail`, message: 'しっぽ先端を使うフキダシには話者を指定してください' });
    }
  };
  const validateBubbleConnection = (bubble: Bubble, bubbleIndex: number, path: string) => {
    if (bubble.join_to === undefined) return;
    if (!Number.isInteger(bubble.join_to) || bubble.join_to < 1 || bubble.join_to > bubbleIndex) {
      issues.push({ level: 'error', path: `${path}.join_to`, message: '結合相手は同じ一覧で自分より前にあるフキダシ番号を指定してください' });
    }
  };
  const duplicateCharacterNames = new Set<string>();
  const seenCharacterNames = new Set<string>();
  const characterCatalogIds = new Set<string>();
  (manga.characters ?? []).forEach((character, index) => {
    if (character.gender !== undefined && !isCharacterGender(character.gender)) {
      issues.push({ level: 'error', path: `manga.characters[${index}].gender`, message: '性別は female / male / neutral のいずれかで指定してください' });
    }
    const key = character.name.normalize('NFKC').trim();
    if (key) {
      if (seenCharacterNames.has(key)) duplicateCharacterNames.add(key);
      seenCharacterNames.add(key);
      if (duplicateCharacterNames.has(key)) issues.push({ level: 'error', path: `manga.characters[${index}].name`, message: `人物名「${character.name}」が重複しています` });
    }
    if (!MATERIAL_SCOPES.includes(character.scope)) issues.push({ level: 'error', path: `manga.characters[${index}].scope`, message: '人物の区分は episode / series のいずれかが必須です' });
    if (character.catalog_id) {
      if (characterCatalogIds.has(character.catalog_id)) issues.push({ level: 'error', path: `manga.characters[${index}].catalog_id`, message: 'シリーズ人物の内部IDが重複しています' });
      characterCatalogIds.add(character.catalog_id);
    }
    if (character.scope === 'series' && !character.catalog_id) issues.push({ level: 'warning', path: `manga.characters[${index}].catalog_id`, message: 'シリーズ共通人物は保存時に安定IDが必要です' });
    const headCount = character.default_proportion?.head_count;
    if (headCount !== undefined && (!Number.isFinite(headCount) || headCount < 1)) {
      issues.push({ level: 'error', path: `manga.characters[${index}].default_proportion.head_count`, message: '基準頭身は1以上の数値で指定してください' });
    }
  });
  const seenMaterialKeys = new Set<string>();
  const catalogIds = new Set<string>();
  (manga.materials ?? []).forEach((material, index) => {
    const key = material.key.normalize('NFKC').trim();
    if (key && seenMaterialKeys.has(key)) issues.push({ level: 'error', path: `manga.materials[${index}].key`, message: `素材名「${material.key}」が重複しています` });
    if (key) seenMaterialKeys.add(key);
    if (!MATERIAL_SCOPES.includes(material.scope)) issues.push({ level: 'error', path: `manga.materials[${index}].scope`, message: '素材の区分は episode / series のいずれかが必須です' });
    if (material.catalog_id) {
      if (catalogIds.has(material.catalog_id)) issues.push({ level: 'error', path: `manga.materials[${index}].catalog_id`, message: 'シリーズ素材の内部IDが重複しています' });
      catalogIds.add(material.catalog_id);
    }
    if (material.source_image) {
      if (material.type !== 'character' || material.scope !== 'series') issues.push({ level: 'error', path: `manga.materials[${index}].source_image`, message: '人物資料画像はシリーズ共通の人物資料にだけ保存できます' });
      if (material.source_image.file_name.startsWith('/') || material.source_image.file_name.includes('..') || material.source_image.file_name.includes('\\')) {
        issues.push({ level: 'error', path: `manga.materials[${index}].source_image.file_name`, message: '人物資料画像はシリーズ内の相対パスで指定してください' });
      }
      if (!material.character_catalog_id || !characterCatalogIds.has(material.character_catalog_id)) {
        issues.push({ level: 'error', path: `manga.materials[${index}].character_catalog_id`, message: '人物資料画像は対応するシリーズ人物の安定IDへ接続してください' });
      } else {
        const expectedPath = `characters/${material.character_catalog_id}/${material.source_image.asset_id}.png`;
        if (material.source_image.file_name !== expectedPath) {
          issues.push({ level: 'error', path: `manga.materials[${index}].source_image.file_name`, message: '人物資料画像の保存先と対応人物の安定IDが一致しません' });
        }
      }
    }
    if (material.scope === 'series' && material.type === 'character' && material.characterId) {
      const owner = manga.characters.find((character) => character.localId === material.characterId);
      if (owner && owner.scope !== 'series') issues.push({ level: 'error', path: `manga.materials[${index}].scope`, message: 'シリーズ人物資料の対応人物もシリーズ共通にしてください' });
    }
  });
  (manga.pages ?? []).forEach((page, pageIndex) => {
    const base = `manga.pages[${pageIndex}]`;
    if(page.paint_layer_sequence!==undefined&&(!Number.isSafeInteger(page.paint_layer_sequence)||page.paint_layer_sequence<0))issues.push({level:'error',path:`${base}.paint_layer_sequence`,message:'レイヤー番号は0以上の整数で指定してください'});
    if (page.page !== pageIndex + 1) issues.push({ level: 'warning', path: `${base}.page`, message: `配列順に合わせて ${pageIndex + 1} を推奨します` });
    if (!Number.isFinite(page.canvas?.w) || !Number.isFinite(page.canvas?.h) || page.canvas.w <= 0 || page.canvas.h <= 0 || page.canvas.unit !== 'mm') issues.push({ level: 'error', path: `${base}.canvas`, message: '用紙サイズはmm単位の正の数にしてください' });
    if ((page.panels?.length ?? 0) > MAX_PANELS_PER_PAGE) issues.push({ level: 'error', path: `${base}.panels`, message: `1ページは最大${MAX_PANELS_PER_PAGE}コマです` });
    if (page.page_overlay) {
      const overlayPath = `${base}.page_overlay`;
      if (page.page_overlay.frame !== false) issues.push({ level: 'error', path: `${overlayPath}.frame`, message: 'ページ前景は枠線を持たないため false 固定です' });
      if (page.page_overlay.layer !== 'above_panel_frames') issues.push({ level: 'error', path: `${overlayPath}.layer`, message: 'ページ前景の layer は above_panel_frames 固定です' });
      (page.page_overlay.figures ?? []).forEach((figure, index) => {
        if (isPropPlacement(figure)) {
          if (!materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `物「${figure.name}」が materials にありません` });
          else if (materialsByKey.get(figure.name)?.type !== 'prop') issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `配置済みの物「${figure.name}」は materials で小道具にしてください` });
        } else if (!isDetectedFigureCharacter(figure) && !characterNames.has(figure.name)) {
          issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `人物「${figure.name}」が characters にありません` });
        }
      });
      (page.page_overlay.bubbles ?? []).forEach((bubble, index) => {
        const bubblePath = `${overlayPath}.bubbles[${index}]`;
        if (!bubble.text?.trim()) issues.push({ level: 'error', path: `${bubblePath}.text`, message: 'フキダシ本文は必須です' });
        if (bubble.shape && !BUBBLE_SHAPES.includes(bubble.shape)) issues.push({ level: 'error', path: `${bubblePath}.shape`, message: '定義済みのフキダシ形状から選んでください' });
        if (bubble.speaker && !characterNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.speaker`, message: `話者「${bubble.speaker}」が characters にありません` });
        validateBubbleConnection(bubble, index, bubblePath);
        validateBubbleTail(bubble, bubblePath);
      });
      (page.page_overlay.screen_text ?? []).forEach((screenText,index)=>{
        const screenTextPath=`${overlayPath}.screen_text[${index}]`;
        validateTextStyle(screenText,screenTextPath);
        if(screenText.hidden!==undefined&&typeof screenText.hidden!=='boolean')issues.push({level:'error',path:`${screenTextPath}.hidden`,message:'hidden は真偽値で指定してください'});
        if(!screenText.text?.trim())issues.push({level:'error',path:`${screenTextPath}.text`,message:'写植文字の本文は必須です'});
        if(screenText.orientation&&!SCREEN_TEXT_ORIENTATIONS.includes(screenText.orientation))issues.push({level:'error',path:`${screenTextPath}.orientation`,message:'orientation は horizontal / vertical から選んでください'});
      });
    }
    const bg2 = (page.panels ?? []).filter((panel) => panel.bg === 2).length;
    if (bg2 > 2) issues.push({ level: 'error', path: `${base}.panels`, message: `bg: 2 は1ページ2コマまでです（現在 ${bg2}）` });
    (page.panels ?? []).forEach((panel, panelIndex) => {
      const panelPath = `${base}.panels[${panelIndex}]`;
      if (panel.id !== panelIndex + 1) issues.push({ level: 'warning', path: `${panelPath}.id`, message: `読み順に合わせて ${panelIndex + 1} を推奨します` });
      if (![-1, 0, 1, 2].includes(panel.bg)) issues.push({ level: 'error', path: `${panelPath}.bg`, message: '-1 / 0 / 1 / 2 のいずれかが必須です' });
      if (typeof panel.background_description === 'string' && panel.background_description.length > 4000) issues.push({ level: 'error', path: `${panelPath}.background_description`, message: '背景情報は4000文字以内にしてください' });
      if (panel.bg === -1 && panel.background_description?.trim()) issues.push({ level: 'warning', path: `${panelPath}.background_description`, message: '描写なしのコマでは背景情報を使用しません' });
      if (!panel.shape || !['rect', 'polygon'].includes(panel.shape.type)) issues.push({ level: 'error', path: `${panelPath}.shape`, message: 'rect または polygon が必要です' });
      if (panel.bleed?.length) {
        if (panel.shape?.type !== 'rect') {
          issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed（タチキリ）は rect コマにのみ指定できます' });
        } else {
          const { x, y, w, h } = panel.shape;
          panel.bleed.forEach((edge) => {
            if (!BLEED_EDGES.includes(edge)) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `断ち切れる辺は left / right / top / bottom です（「${edge}」は不可）` });
            else if (edge === 'left' && x !== 0) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed: left のコマは x: 0（紙の左端）にしてください' });
            else if (edge === 'right' && Math.abs(x + w - page.canvas.w) > 0.001) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `bleed: right のコマは x + w = ${page.canvas.w}（紙の右端）にしてください` });
            else if (edge === 'top' && y !== 0) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed: top のコマは y: 0（紙の上端）にしてください' });
            else if (edge === 'bottom' && Math.abs(y + h - page.canvas.h) > 0.001) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `bleed: bottom のコマは y + h = ${page.canvas.h}（紙の下端）にしてください` });
          });
        }
      }
      // figures は人物専用ではない——object: true の figure は物（小道具等）の配置、無ければ人物
      const personCount = (panel.figures ?? []).filter((figure) => !isPropPlacement(figure)).length;
      if (panel.no_figures && personCount > 0) issues.push({ level: 'error', path: `${panelPath}.no_figures`, message: '意図的な無人コマ（no_figures: true）に人物の figure は書けません（物の配置は書けます）' });
      const hasSpokenBubble = (panel.bubbles ?? []).some((bubble) => bubble.speaker);
      if (!panel.no_figures && personCount === 0 && !hasSpokenBubble) issues.push({ level: 'warning', path: `${panelPath}.figures`, message: '人物も話者もいないコマです。意図的な無人コマなら no_figures: true を宣言してください' });
      (panel.assets ?? []).forEach((key) => {
        if (!materialKeys.has(key)) issues.push({ level: 'warning', path: `${panelPath}.assets`, message: `素材「${key}」が materials にありません` });
      });
      (panel.figures ?? []).forEach((figure, index) => {
        if (isPropPlacement(figure)) {
          if (characterNames.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].object`, message: `物（object: true）の名前「${figure.name}」が characters の人物と一致しています` });
          else if (!materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `物「${figure.name}」が materials にありません` });
          else if (materialsByKey.get(figure.name)?.type !== 'prop') issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `配置済みの物「${figure.name}」は materials で小道具にしてください` });
          if (figure.size || figure.role) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}]`, message: 'size / role は人物向けの語彙です（物の figure には付けません）' });
          return;
        }
        if (!isDetectedFigureCharacter(figure) && !characterNames.has(figure.name)) {
          if (materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].object`, message: `「${figure.name}」は materials の物と一致します。物の配置なら object: true を付けてください` });
          else issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `人物「${figure.name}」が characters にありません` });
        }
        if (figure.size && !FIGURE_SIZES.includes(figure.size)) issues.push({ level: 'error', path: `${panelPath}.figures[${index}].size`, message: `size は ${FIGURE_SIZES.join(' / ')} から選んでください` });
        if (figure.role && !FIGURE_ROLES.includes(figure.role)) issues.push({ level: 'error', path: `${panelPath}.figures[${index}].role`, message: 'role は main / sub から選んでください' });
      });
      const figureNames = new Set((panel.figures ?? []).filter((figure) => !isPropPlacement(figure)).map((figure) => figure.name));
      (panel.bubbles ?? []).forEach((bubble, bubbleIndex) => {
        const bubblePath = `${panelPath}.bubbles[${bubbleIndex}]`;
        if (!bubble.text?.trim()) issues.push({ level: 'error', path: `${bubblePath}.text`, message: 'フキダシ本文は必須です' });
        if (bubble.shape && !BUBBLE_SHAPES.includes(bubble.shape)) issues.push({ level: 'error', path: `${bubblePath}.shape`, message: '定義済みのフキダシ形状から選んでください' });
        if (bubble.speaker && !characterNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.speaker`, message: `話者「${bubble.speaker}」が characters にありません` });
        if (bubble.offscreen && !bubble.speaker) issues.push({ level: 'warning', path: `${bubblePath}.offscreen`, message: 'コマ外の声（offscreen）には話者（speaker）を明記してください' });
        if (bubble.offscreen && bubble.speaker && figureNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.offscreen`, message: `話者「${bubble.speaker}」が figures にいます。コマ内にいる話者に offscreen は付けません` });
        validateBubbleConnection(bubble, bubbleIndex, bubblePath);
        validateBubbleTail(bubble, bubblePath);
      });
      (panel.screen_text ?? []).forEach((screenText, screenTextIndex) => {
        const screenTextPath = `${panelPath}.screen_text[${screenTextIndex}]`;
        validateTextStyle(screenText,screenTextPath);
        if(screenText.hidden!==undefined&&typeof screenText.hidden!=='boolean')issues.push({level:'error',path:`${screenTextPath}.hidden`,message:'hidden は真偽値で指定してください'});
        if (!screenText.text?.trim()) issues.push({ level: 'error', path: `${screenTextPath}.text`, message: '画面内文字の本文は必須です' });
        if (screenText.orientation && !SCREEN_TEXT_ORIENTATIONS.includes(screenText.orientation)) issues.push({ level: 'error', path: `${screenTextPath}.orientation`, message: 'orientation は horizontal / vertical から選んでください' });
      });
    });
  });
  return issues;
}
