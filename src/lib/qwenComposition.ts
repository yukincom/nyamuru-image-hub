import { textDisplayLabel } from './displayLabels.ts';
import type { BBox, Bubble, Manga, Panel, PlacedImage, ScreenText, TextInlineStyle } from '../types.ts';
import { compileArtworkRules, getArtworkSettings } from './artworkRules.ts';
import { fallbackBox, panelBounds, panelShapePoints } from './canvasGeometry.ts';
import { isPropPlacement } from './catalogModel.ts';
import { humanPoseCameraPromptText, humanPoseSceneFrame } from './humanPoseScene.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
import { FIGURE_SIZE_LABELS } from './manga.ts';
import { overlayFallbackBox, overlayTextFallbackBox } from './pageCanvas.ts';
import { bubbleVisible, panelFrameVisible, panelVisible } from './panelLayers.ts';
import { QWEN_GENERATION_PROFILE, type QwenGenerationPlan, type QwenReferenceCandidate } from './qwenGeneration.ts';
import { bubbleCssFontFamily } from './bubbleFonts.ts';
import { textStyleOf, textStyleSegments } from './textStyle.ts';
import { figurePaintVisible } from './paintDocument.ts';
import { bubbleTextPosition } from './bubbleClip.ts';
import { bubbleStrokeWidthMm, isHandwrittenText, letteringGuideVisible, isBalloonText } from './bubblePresentation.ts';

export type QwenCompositionScope = 'page' | 'panel';
interface CompositionPanel { panel: Panel; panelIndex: number; overlay: boolean }
type CompositionPlan = QwenGenerationPlan & { scope: QwenCompositionScope; literalText: string[]; outputFrame: BBox };
type CompositionCandidate = QwenReferenceCandidate & { characterKeys: string[] };

const editableImages = (images?: PlacedImage[],includeGenerated=false) => (images ?? []).filter(image => includeGenerated||!(image as PlacedImage & { generationScope?: QwenCompositionScope }).generationScope);
const compositionGuide = (entry: CompositionPanel, key: string, guides?: Record<string, boolean>) => guides?.[`${entry.overlay ? 'overlay' : entry.panelIndex}:${key}`];
const figureVisible = (entry: CompositionPanel, index: number, guides?: Record<string, boolean>) => figurePaintVisible(entry.panel.figures?.[index], compositionGuide(entry, `figure-${index}`, guides));

/** Match the editor stack even when storage order interleaves direct paint and placed images. */
export function qwenPanelImageLayers(images: PlacedImage[] = []) {
  return {
    ordinary: images.filter(image => !image.paintScope&&!image.bubbleOriginal&&!image.generationScope),
    direct: images.filter(image => image.paintScope === 'panel'),
    generated: images.filter(image => image.generationScope&&!image.paintScope&&!image.bubbleOriginal),
  };
}

/** A detached rendering snapshot. Generated whole-page/panel outputs never become their own input. */
export function qwenCompositionLayout(manga: Manga, pageIndex: number, panelIndex: number, scope: QwenCompositionScope,includeGenerated=false) {
  const page = manga.pages[pageIndex];
  if (!page || !['page', 'panel'].includes(scope) || (scope === 'panel' && !page.panels[panelIndex])) throw new Error('生成対象のページまたはコマが見つかりません');
  const bounds = scope === 'page' ? { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h } : panelBounds(page.panels[panelIndex]);
  const frame: BBox = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  if (![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) throw new Error('生成対象の範囲が不正です');
  const panels: CompositionPanel[] = page.panels.flatMap((source, index) => {
    if (scope === 'panel' && index !== panelIndex || !panelVisible(source)) return [];
    const panel = structuredClone(source);
    panel.images = editableImages(panel.images,includeGenerated); panel.background_images = editableImages(panel.background_images,includeGenerated);
    return [{ panel, panelIndex: index, overlay: false }];
  });
  if (scope === 'panel' && !panels.length) throw new Error('非表示のコマは生成できません');
  if (scope === 'page' && page.page_overlay) {
    const overlay = structuredClone(page.page_overlay);
    overlay.figures?.forEach((figure, index) => { figure.bbox ??= overlayFallbackBox(page.canvas, 'figure', index); });
    overlay.bubbles?.forEach((bubble, index) => { bubble.bbox ??= overlayFallbackBox(page.canvas, 'bubble', index); });
    overlay.screen_text?.forEach((text,index)=>{text.bbox??=overlayTextFallbackBox(page.canvas,index);});
    panels.push({ panelIndex: -1, overlay: true, panel: { id: 0, shape: { type: 'rect', ...frame }, bg: 0, action: null,
      figures: overlay.figures, bubbles: overlay.bubbles ?? [],screen_text:overlay.screen_text,images:structuredClone(editableImages(page.images,includeGenerated).filter(image=>image.bubbleOriginal)) } });
  }
  return { frame, ...humanPoseSceneFrame(frame.w / frame.h), panels, images: scope === 'page' ? structuredClone(editableImages(page.images,includeGenerated)) : [] };
}

export function buildQwenCompositionPlan(manga: Manga, pageIndex: number, panelIndex: number, scope: QwenCompositionScope, guides?: Record<string, boolean>): QwenGenerationPlan {
  const layout = qwenCompositionLayout(manga, pageIndex, panelIndex, scope), page = manga.pages[pageIndex];
  const characterKeys: string[] = [], literalText: string[] = [], instructions: string[] = [];
  const figures = layout.panels.flatMap(entry => (entry.panel.figures ?? []).filter((_, index) => figureVisible(entry, index, guides)));
  for (const figure of figures) {
    if (isPropPlacement(figure)) continue;
    const character = figure.refId ? manga.characters.find(character => character.localId === figure.refId) : undefined;
    if (!character?.localId) throw new Error(`「${figure.name || '人物あたり'}」の登場人物を指定してから生成してください`);
    requireHumanPoseGenerationReady(figure.human_pose);
    if (!characterKeys.includes(character.localId)) characterKeys.push(character.localId);
  }
  if (characterKeys.length > 9) throw new Error('人物資料は9枚までのため、登場人物を9人以下にしてください');
  const byCharacter = characterKeys.map((key, index): CompositionCandidate[] => {
    const character = manga.characters.find(character => character.localId === key)!;
    if (!manga.meta.series_id || !character.catalog_id) throw new Error(`Character ${index + 1}「${character.name}」の登録資料を用意してください`);
    const materials = manga.materials.filter(material => material.type === 'character' && material.source_image?.asset_id &&
      (material.characterId ? material.characterId === key : material.character_catalog_id === character.catalog_id));
    materials.sort((a, b) => Number(b.catalog_id === character.primary_material_catalog_id) - Number(a.catalog_id === character.primary_material_catalog_id));
    const unique = new Set<string>();
    const candidates = materials.flatMap(material => {
      const identity = JSON.stringify(material.source_image);
      if (unique.has(identity)) return []; unique.add(identity);
      return [{ label: `Character ${index + 1}「${character.name}」: ${material.key}`, seriesId: manga.meta.series_id,
        characterCatalogId: character.catalog_id!, source: structuredClone(material.source_image!), characterKeys: [key] }];
    });
    if (!candidates.length) throw new Error(`Character ${index + 1}「${character.name}」の登録済み人物資料がありません`);
    return candidates;
  });
  // Every person receives one reference before additional sheets consume the remaining slots.
  const candidates = byCharacter.map(group => group[0]);
  for (let index = 1; candidates.length < 9 && byCharacter.some(group => group[index]); index++) {
    for (const group of byCharacter) if (group[index] && candidates.length < 9) candidates.push(group[index]);
  }
  characterKeys.forEach((key, index) => {
    const character = manga.characters.find(character => character.localId === key)!;
    instructions.push(`Character ${index + 1}：${character.name}。${character.visual_prompt || ''}${character.default_proportion ? ` ${character.default_proportion.head_count}頭身。` : ''}`);
  });
  for (const entry of layout.panels) {
    const { panel } = entry, label = entry.overlay ? 'ページ前景' : `コマ ${panel.id}`;
    instructions.push(`${label}：${panel.action || ''}${entry.overlay ? '' : `\n背景指示：${panel.background_description || manga.setting.location || '無地'}（bg:${panel.bg}）。`}`);
    for (const [figureIndex, figure] of (panel.figures ?? []).entries()) {
      if (!figureVisible(entry, figureIndex, guides)) continue;
      const identity = isPropPlacement(figure) ? `小道具「${figure.name}」` : `Character ${characterKeys.indexOf(figure.refId!) + 1}「${figure.name}」`;
      const pose = figure.human_pose;
      instructions.push([`${label}の${identity}。`, figure.action ? `動作・表情・視線：${figure.action}` : '',
        pose?.input_mode === 'image' ? '合成画像内の3Dポーズの姿勢・視点・切り取り範囲を保つ。画面外の身体を描き足さず、素体の色や関節マーカーは完成画に残さない。'
          : [figure.size ? `描写範囲は${FIGURE_SIZE_LABELS[figure.size]}。` : '', pose?.edited_text_ja ? `ポーズ：${pose.edited_text_ja}` : ''].filter(Boolean).join('\n'),
        pose?.camera_prompt ? `アングル・レンズ：${humanPoseCameraPromptText(pose.camera_prompt).ja}` : '',
      ].filter(Boolean).join('\n'));
    }
    for (const [index, bubble] of panel.bubbles.entries()) if (bubbleVisible(bubble) && bubble.text) {
      literalText.push(bubble.text); instructions.push(isHandwrittenText(bubble)?`${label}の${textDisplayLabel(index)}（描き文字）：「${bubble.text}」。${bubble.lettering_description||''}`:`${label}の${textDisplayLabel(index)}（${isBalloonText(bubble)?'フキダシ':'写植文字'}、話者：${bubble.speaker || '指定なし'}）：「${bubble.text}」`);
    }
    for (const [index, text] of (panel.screen_text ?? []).entries()) if (text.text&&text.hidden!==true) {
      literalText.push(text.text); instructions.push(`${label}の${textDisplayLabel(panel.bubbles.length+index)}（写植文字）：「${text.text}」`);
    }
  }
  const rules = compileArtworkRules(getArtworkSettings(manga), 'integrated');
  const plan: CompositionPlan = { profile: QWEN_GENERATION_PROFILE, scope,
    documentKey: JSON.stringify([manga.meta.series_id, manga.meta.episode_id]), pageNumber: page.page,
    panelId: scope === 'page' ? 0 : page.panels[panelIndex].id, overlay: false, ownerKey: scope,
    label: scope === 'page' ? `${page.page}ページ全体` : `コマ ${page.panels[panelIndex].id}全体`,
    width: layout.width, height: layout.height, outputFrame: layout.frame, characterKeys, candidates, literalText,
    prompt: [scope === 'page' ? '入力画像を完成した漫画1ページに描き起こしてください。' : '入力画像を完成した漫画の1コマに描き起こしてください。',
      '入力画像のコマ形状、人物の位置・姿勢・視点・見切れ、背景、配置画像、フキダシと文字の配置を保ってください。',
      'Character番号は人物資料と同じ登場人物を表します。人物資料の外見・衣服・体型・画風を使い、資料のポーズへ置き換えないでください。',
      '台詞・画面内文字は指定した日本語を改変・省略・翻訳せず、フキダシ内または指定位置に収めてください。',
      `出力形式：${manga.meta.format}。`, ...instructions, ...rules.style_notes, rules.layout_spec,
      '選択枠、操作用の枠、暗幕、マーカー、説明ラベル、署名、透かしを完成画に加えないでください。',
    ].filter(Boolean).join('\n\n') };
  return plan;
}

/** Keep Unicode characters, explicit line breaks and per-range emphasis during rasterization. */
export function qwenCompositionTextRuns(item: Bubble | ScreenText) {
  return textStyleSegments(item).flatMap(({text,...style}) => Array.from(text, character => ({ text:character, ...style })));
}

function drawText(context: CanvasRenderingContext2D, item: Bubble | ScreenText, box: BBox, viewport: BBox, kind: 'bubble' | 'screen_text', defaultFont: string) {
  if (item.hidden===true || !item.text || box.w <= 0 || box.h <= 0) return;
  const style = textStyleOf(item, kind), lineHeight=style.lineHeight??1.35, vertical = style.orientation !== 'horizontal';
  const balloon=kind==='bubble'&&isBalloonText(item as Bubble);
  const scale = context.canvas.width / viewport.w, padding = balloon ? .16 : 0;
  const x = (box.x - viewport.x + box.w * padding) * scale, y = (box.y - viewport.y + box.h * padding) * context.canvas.height / viewport.h;
  const width = box.w * (1 - padding * 2) * scale, height = box.h * (1 - padding * 2) * context.canvas.height / viewport.h;
  const family = bubbleCssFontFamily(style.font ?? defaultFont), runs = qwenCompositionTextRuns(item);
  let size = style.fontSize ? style.fontSize * 25.4 / 72 * scale : Math.min(5 * scale, Math.max(2 * scale, Math.min(width, height) / 3));
  const setFont = (run:TextInlineStyle) => { context.font = `${run.italic?'italic':'normal'} ${run.fontWeight ?? style.fontWeight ?? 600} ${size}px ${family}`; };
  const layout = () => {
    const lines: Array<Array<{ text: string; advance: number }&TextInlineStyle>> = [[]]; let length = 0;
    for (const run of runs) {
      if (run.text === '\r') continue;
      if (run.text === '\n') { lines.push([]); length = 0; continue; }
      setFont(run); const advance = vertical ? size : context.measureText(run.text).width;
      if ((kind==='screen_text'||balloon) && length + advance > (vertical ? height : width) && lines.at(-1)!.length) { lines.push([]); length = 0; }
      lines.at(-1)!.push({ ...run, advance }); length += advance;
    }
    return lines;
  };
  let lines = layout();
  if (!style.fontSize) for (let attempt = 0; attempt < 12 && lines.length * size * lineHeight > (vertical ? width : height); attempt++) { size *= .85; lines = layout(); }
  context.save(); context.fillStyle = '#111'; context.strokeStyle = '#111'; context.lineWidth=Math.max(.5,size/16); context.textAlign = vertical ? 'center' : 'left'; context.textBaseline = 'middle';
  const across = lines.length * size * lineHeight, longest = Math.max(...lines.map(line => line.reduce((sum, run) => sum + run.advance, 0)));
  const position=kind==='bubble'?bubbleTextPosition(item as Bubble):{x:.5,y:.5};
  const anchorX=(box.x-viewport.x+box.w*position.x)*scale,anchorY=(box.y-viewport.y+box.h*position.y)*context.canvas.height/viewport.h;
  lines.forEach((line, index) => {
    const alignment=style.textAlign==='center'?.5:style.textAlign==='right'?1:0;
    let advance = (longest-line.reduce((sum,run)=>sum+run.advance,0))*alignment;
    for (const run of line) {
      setFont(run);
      const px = vertical ? (kind==='bubble'?anchorX+across/2-(index+.5)*size*lineHeight:x+(width+across)/2-(index+.5)*size*lineHeight) : (kind==='bubble'?anchorX-longest/2:x) + advance;
      const py = vertical ? (kind==='bubble'?anchorY-longest/2:y) + advance + size / 2 : (kind==='bubble'?anchorY-across/2:y) + (index + .5) * size * lineHeight;
      if (vertical && /^[ー―—…()（）\[\]「」『』〈〉《》]$/u.test(run.text)) {
        context.save(); context.translate(px, py); context.rotate(Math.PI / 2); context.fillText(run.text, 0, 0); context.restore();
      } else context.fillText(run.text, px, py);
      for(const decoration of ['underline','strikethrough'] as const){
        if(!run[decoration])continue;
        const offset=decoration==='underline'?size*.5:0;
        context.beginPath();
        if(vertical){context.moveTo(px+offset,py-size/2);context.lineTo(px+offset,py-size/2+run.advance);}
        else {context.moveTo(px,py+offset);context.lineTo(px+run.advance,py+offset);}
        context.stroke();
      }
      advance += run.advance;
    }
  });
  context.restore();
}

export interface CompositionCaptureOptions {width?:number;height?:number;includeGenerated?:boolean}

/** Render only manuscript content; no live editor DOM or selection chrome. */
export async function captureQwenCompositionCanvas(manga: Manga, pageIndex: number, panelIndex: number, scope: QwenCompositionScope, guides?: Record<string, boolean>,options:CompositionCaptureOptions={}): Promise<HTMLCanvasElement> {
  const layout = qwenCompositionLayout(manga, pageIndex, panelIndex, scope,options.includeGenerated), assets = manga.image_assets ?? [];
  const [{ paintScene, paintForFrame, paintReferenceBox }, { humanPoseFigureImage, humanPoseOwnerImage, drawHumanPoseImage }, { decodePaintImage },
    { h, render }, { default: BubbleShapeSvg }, tail, { bubbleUsesMonologueTail }, { resolveBubbleSpeakerFigureIndex }, { bubbleTextFrame, compatibleBubbleClips }] = await Promise.all([
    import('./paintDocument.ts'), import('./humanPoseComposition.ts'), import('./paintRenderer.ts'), import('preact'), import('../components/BubbleShapeSvg'),
    import('./bubbleTail.ts'), import('./bubblePresentation.ts'), import('./bubbleRelations.ts'), import('./bubbleClip.ts'),
  ]);
  const canvas = document.createElement('canvas'); canvas.width = options.width??layout.width; canvas.height = options.height??layout.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('生成入力の描画領域を作れません');
  if (document.fonts) await document.fonts.ready;
  const frame = layout.frame, dpi = canvas.width / frame.w * 25.4;
  const point = ([x, y]: [number, number]) => [(x - frame.x) / frame.w * canvas.width, (y - frame.y) / frame.h * canvas.height];
  const outline = (panel: Panel) => { context.beginPath(); panelShapePoints(panel).forEach((p, index) => { const [x, y] = point(p); if (index) context.lineTo(x, y); else context.moveTo(x, y); }); context.closePath(); };
  const guideFor = (entry: CompositionPanel, key: string) => compositionGuide(entry, key, guides);
  if (scope === 'page') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  else { outline(layout.panels[0].panel); context.clip(); }
  const drawImages = async (images: PlacedImage[]) => {
    if (!images.length) return;
    const owner = { key: 'images', kind: 'background' as const, index: 0, label: '配置画像', frame,
      paint: paintForFrame(frame, dpi, images, assets) };
    await drawHumanPoseImage(context, await humanPoseOwnerImage(owner, assets, false), frame, frame);
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgElement = (name: string, attributes: Record<string, string | number> = {}) => {
    const element = document.createElementNS(SVG_NS, name); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value))); return element;
  };
  const drawBubbles = async (entry: CompositionPanel) => {
    const { panel } = entry, bubbles = panel.bubbles;
    const bubbleBox = (index: number) => { const bubble = bubbles[index]; return paintReferenceBox(bubble.paint_overlay?.paint, bubble.bbox ?? fallbackBox(panel, 'bubble', index), bubble.paint_overlay?.crop); };
    const figureBox = (index: number) => { const figure = panel.figures![index]; return paintReferenceBox(figure.artwork?.paint, figure.bbox ?? fallbackBox(panel, 'figure', index), figure.artwork?.crop); };
    const svg = svgElement('svg', { xmlns: SVG_NS, width: canvas.width, height: canvas.height, viewBox: `${frame.x} ${frame.y} ${frame.w} ${frame.h}`, preserveAspectRatio: 'none' });
    const clipId = `composition-panel-${entry.panelIndex}`, defs = svgElement('defs'), clip = svgElement('clipPath', { id: clipId });
    clip.append(svgElement('polygon', { points: panelShapePoints(panel).map(point => point.join(',')).join(' ') })); defs.append(clip); svg.append(defs);
    const masks: Array<import('./bubbleTail.ts').BubbleSeamMask[]> = bubbles.map(() => []);
    const connections: SVGElement[][] = bubbles.map(() => []);
    const composites: Array<import('./bubbleTail.ts').BubbleTailComposite | null> = bubbles.map(() => null);
    const group = (_bubble: Bubble) => { const group = svgElement('g', !entry.overlay ? { 'clip-path': `url(#${clipId})` } : {}); svg.append(group); return group; };
    for (const [index, bubble] of bubbles.entries()) {
      if (!bubbleVisible(bubble)) continue;
      const stroke = bubbleStrokeWidthMm(bubble, manga.meta.bubble_line_width_mm);
      const speaker = resolveBubbleSpeakerFigureIndex(panel, bubble);
      if (!tail.bubbleTailDisabled(bubble) && speaker !== null) {
        const target = tail.bubbleTailTargetPoint(figureBox(speaker), bubble.tail);
        if (bubbleUsesMonologueTail(bubble)) {
          const beads=svgElement('g');
          for (const ellipse of tail.monologueTailEllipses(bubbleBox(index), target, bubble.bezier,bubble.tail_root)) beads.append(svgElement('ellipse', { ...ellipse, fill: '#fff', stroke: '#111', 'stroke-width': stroke }));
          if(beads.childNodes.length)connections[index].push(beads);
        } else composites[index]=tail.bubbleTailComposite(bubbleBox(index),target,bubble.shape??'normal',bubble.bezier,bubble.tail_root);
      }
      const targetIndex = Number(bubble.join_to) - 1;
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= index || !bubbleVisible(bubbles[targetIndex]) || !compatibleBubbleClips(bubble, bubbles[targetIndex])) continue;
      const join = tail.bubbleJoinGeometry(bubbleBox(index), bubble.shape ?? 'normal', bubbleBox(targetIndex), bubbles[targetIndex].shape ?? 'normal', bubble.bezier, bubbles[targetIndex].bezier);
      if (!join) continue; masks[index].push(join.firstSeamMask); masks[targetIndex].push(join.secondSeamMask);
      const layer = svgElement('g');
      if (join.fillPath) layer.append(svgElement('path', { d: join.fillPath, fill: '#fff' }));
      join.outlinePaths.forEach(path => layer.append(svgElement('path', { d: path, fill: 'none', stroke: '#111', 'stroke-width': stroke })));
      connections[index].push(layer);
    }
    for (const [index, bubble] of bubbles.entries()) {
      context.save(); if (!entry.overlay) { outline(panel); context.clip(); }
      try {
        if (bubbleVisible(bubble)) {
          const stroke = bubbleStrokeWidthMm(bubble, manga.meta.bubble_line_width_mm);
          const box = bubbleBox(index), host = document.createElement('div'), layer=group(bubble);
          connections[index].forEach(connection=>layer.append(connection));
          try {
            render(h(BubbleShapeSvg, { shape: bubble.shape, bezier: bubble.bezier, composite: composites[index]??undefined, seamMasks: masks[index], maskId: `composition-bubble-${entry.panelIndex}-${index}` }), host);
            const body = host.querySelector('svg')?.cloneNode(true) as SVGSVGElement | undefined;
            if(body){
              Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h, overflow: 'visible' }).forEach(([key, value]) => body.setAttribute(key, String(value)));
              body.querySelectorAll('.bubble-svg-surface').forEach(element => { element.setAttribute('fill', '#fff'); element.setAttribute('stroke', 'none'); });
              body.querySelectorAll('.bubble-svg-outline-surface, .bubble-svg-detail').forEach(element => {
                element.setAttribute('fill', 'none'); element.setAttribute('stroke', '#111'); element.setAttribute('stroke-width', String(stroke * canvas.width / frame.w)); element.setAttribute('vector-effect', 'non-scaling-stroke');
              });
              layer.append(body);
            }
            const image = await decodePaintImage(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
            try { context.drawImage(image, 0, 0, canvas.width, canvas.height); } finally { image.src = ''; }
          } finally { render(null, host); layer.remove(); }
          if (bubble.paint_overlay && !bubble.paint_overlay.hidden) {
            const owner = paintScene(panel, dpi, assets).owners.find(owner => owner.key === `bubble-${index}`)!;
            await drawHumanPoseImage(context, await humanPoseOwnerImage(owner, assets, false), owner.frame, frame);
          }
          if(letteringGuideVisible(bubble))drawText(context, bubble, bubbleTextFrame(box, panel, bubble), frame, 'bubble', manga.meta.font);
        }
        // Each independent original follows its own native child, even if native text is hidden.
        await drawImages((panel.images??[]).filter(image=>image.id===bubble.analogTextImport?.originalImageId));
      } finally { context.restore(); }
    }
  };
  for (const entry of layout.panels.filter(entry => !entry.overlay)) {
    context.save(); outline(entry.panel); context.clip();
    for (const owner of paintScene(entry.panel, dpi, assets).owners) {
      if (owner.kind === 'bubble'||owner.kind==='original') continue;
      const guide = guideFor(entry, owner.key);
      if (owner.kind === 'figure') {
        if (!figureVisible(entry, owner.index, guides)) continue;
        const view = await humanPoseFigureImage(owner, entry.panel, assets, guide);
        await drawHumanPoseImage(context, view.image, view.frame, frame);
      } else await drawHumanPoseImage(context, await humanPoseOwnerImage(owner, assets, guide, entry.panel.background_images?.some(image => image.paint?.guideInitialized)), owner.frame, frame);
    }
    const imageLayers = qwenPanelImageLayers(entry.panel.images);
    await drawImages(imageLayers.ordinary);
    await drawImages(imageLayers.direct);
    for (const [index, text] of (entry.panel.screen_text ?? []).entries()) drawText(context, text, text.bbox ?? fallbackBox(entry.panel, 'screen_text', index), frame, 'screen_text', manga.meta.font);
    context.restore();
  }
  await drawImages(layout.images.filter(image=>!image.paintScope&&!image.bubbleOriginal&&!image.generationScope));
  for (const entry of layout.panels.filter(entry => !entry.overlay)) await drawBubbles(entry);
  for (const entry of layout.panels.filter(entry => !entry.overlay)) if (panelFrameVisible(entry.panel)) {
    const { panel } = entry;
    if (panel.shape.type === 'rect' && panel.bleed?.length) {
      const points = panelShapePoints(panel), sides = ['top', 'right', 'bottom', 'left'] as const;
      context.beginPath();
      points.forEach((start, index) => { if (panel.bleed!.includes(sides[index])) return;
        const [x1, y1] = point(start), [x2, y2] = point(points[(index + 1) % points.length]); context.moveTo(x1, y1); context.lineTo(x2, y2);
      });
    } else outline(panel);
    context.strokeStyle = '#111'; context.lineWidth = (manga.meta.panel_frame_width_mm || .5) * canvas.width / frame.w; context.stroke();
  }
  await drawImages(layout.images.filter(image=>image.paintScope==='page'));
  for (const entry of layout.panels.filter(entry => entry.overlay)) for (const owner of paintScene(entry.panel, dpi, assets).owners) {
    if (owner.kind !== 'figure' || !figureVisible(entry, owner.index, guides)) continue;
    const view = await humanPoseFigureImage(owner, entry.panel, assets, guideFor(entry, owner.key));
    await drawHumanPoseImage(context, view.image, view.frame, frame);
  }
  for (const entry of layout.panels.filter(entry => entry.overlay)) {
    for (const [index, text] of (entry.panel.screen_text ?? []).entries()) drawText(context, text, text.bbox ?? overlayTextFallbackBox(layout.frame, index), frame, 'screen_text', manga.meta.font);
    await drawBubbles(entry);
  }
  // Completed page/panel images cover editable content, just as in MangaCanvas.
  for(const entry of layout.panels.filter(entry=>!entry.overlay)){
    context.save();outline(entry.panel);context.clip();
    await drawImages(qwenPanelImageLayers(entry.panel.images).generated);
    context.restore();
  }
  await drawImages(layout.images.filter(image=>image.generationScope&&!image.paintScope&&!image.bubbleOriginal));
  // Unlinked originals remain separate topmost placements until explicitly associated.
  for(const entry of layout.panels.filter(entry=>!entry.overlay)){
    context.save();outline(entry.panel);context.clip();
    await drawImages((entry.panel.images??[]).filter(image=>image.bubbleOriginal&&!entry.panel.bubbles.some(bubble=>bubble.analogTextImport?.originalImageId===image.id)));
    context.restore();
  }
  await drawImages(layout.images.filter(image=>image.bubbleOriginal&&!layout.panels.some(entry=>entry.overlay&&entry.panel.bubbles.some(bubble=>bubble.analogTextImport?.originalImageId===image.id))));
  return canvas;
}

/** Qwen keeps its existing compact PNG and excludes prior generated whole images. */
export async function captureQwenComposition(manga: Manga, pageIndex: number, panelIndex: number, scope: QwenCompositionScope, guides?: Record<string, boolean>): Promise<string> {
  const canvas=await captureQwenCompositionCanvas(manga,pageIndex,panelIndex,scope,guides);
  try{return canvas.toDataURL('image/png');}finally{canvas.width=canvas.height=1;}
}
