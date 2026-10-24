import { setBubbleShape } from '../lib/bubblePresetData.ts';
import BubbleBezierEditor from './BubbleBezierEditor';
import FigureArtworkEditor from './FigureArtworkEditor';
import FigureSizePicker from './FigureSizePicker';
import FigureHumanPoseEditor from './FigureHumanPoseEditor';
import { Box, MessageCircleMore, UserPlus, WandSparkles } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { BUBBLE_SHAPES, FIGURE_SIZE_LABELS, FIGURE_ROLE_LABELS, FIGURE_ROLES } from '../lib/manga';
import { BUBBLE_SHAPE_LABELS, bubbleTailIsEnabled, normalizedEmphasis, setBubbleTailEnabled } from '../lib/bubblePresentation.ts';
import { removeBubbleAt } from '../lib/bubbleConnections.ts';
import { prepareBubbleShapeSuggestion } from '../lib/bubbleShapeSuggestion.ts';
import type { BubbleOwner } from '../lib/panelTemplates';
import type { CanvasElementSelection, Manga, PageOverlay, Panel } from '../types';
import { isPropPlacement } from '../lib/catalogModel.ts';
import { BBoxEditor, Field, SectionTitle } from './Fields';
import BubbleCardTitle from './BubbleCardTitle';
import ScenarioBubbleNotice, { type ScenarioBubbleChoiceProps } from './ScenarioBubbleNotice';
import { useScenarioBubbleText } from '../lib/scenario.ts';
import { panelDisplayLabel } from '../lib/displayLabels.ts';
import { useInspectorSelectionScroll } from './useInspectorSelectionScroll.ts';

interface Props extends ScenarioBubbleChoiceProps {
  onEditText?:(index:number)=>void;
  onOpenBubbleMaterials?:()=>void;
  painting?: boolean;
  guideVisible:(key:string)=>boolean;
  onToggleGuide:(key:string)=>void;
  pageIndex: number;
  manga: Manga;
  panels: readonly Panel[];
  overlay: PageOverlay;
  selectedElement: CanvasElementSelection;
  canvasSelectionScrollRequest: number;
  onSelectElement: (selection: CanvasElementSelection | null) => void;
  onChange: (overlay: PageOverlay | undefined) => void;
  onMoveBubble: (bubbleIndex: number, targetOwner: BubbleOwner) => void;
  onOpenScenario?: () => void;
}

export default function PageOverlayInspector({ onEditText, onOpenBubbleMaterials, guideVisible, onToggleGuide, manga, panels, overlay, pageIndex, selectedElement, canvasSelectionScrollRequest, onSelectElement, onChange, onMoveBubble, onOpenScenario, onScenarioChoice }: Props) {
  const inspectorRef = useInspectorSelectionScroll(canvasSelectionScrollRequest);
  const [bubbleShapeSuggestionStatus, setBubbleShapeSuggestionStatus] = useState<{ index: number; kind: 'error'; message: string } | null>(null);
  const props = manga.materials.filter((material) => material.type === 'prop');
  const update = (recipe: (draft: PageOverlay) => void) => {
    const draft = structuredClone(overlay);
    recipe(draft);
    if (!(draft.figures?.length) && !(draft.bubbles?.length)) onChange(undefined);
    else onChange(draft);
  };
  const selectCard = (_event: MouseEvent, selection: CanvasElementSelection) => onSelectElement(selection);
  const requestBubbleShape = (index: number) => {
    const bubble = overlay.bubbles?.[index];
    if (!bubble) return;
    const preparation = prepareBubbleShapeSuggestion({ action: null, figures: overlay.figures }, bubble);
    if (!preparation.shape) {
      setBubbleShapeSuggestionStatus({ index, kind: 'error', message: preparation.error });
      return;
    }
    update((draft) => { if (draft.bubbles?.[index]) { draft.bubbles[index].shape = preparation.shape; delete draft.bubbles[index].bezier; } });
    setBubbleShapeSuggestionStatus(null);
  };

  return <div ref={inspectorRef} class="panel-inspector page-overlay-inspector">
    <div class="inspector-sticky-head">
      <div><span class="eyebrow">PAGE OVERLAY</span><h2>ページ前景</h2></div>
    </div>

    <div class="inspector-fields">
    <section class="editor-section">
      <SectionTitle index="01" title="人物" action={<button class="inline-add" disabled={!manga.characters.length} onClick={() => {
        const index = overlay.figures?.length ?? 0;
        const character = manga.characters[0];
        update((draft) => { (draft.figures ??= []).push({ name: character?.name ?? '', kind: 'person', refId: character?.localId, bbox: { x: 55, y: 45, w: 100, h: 175 }, size: 'bust-up', role: 'main' }); });
        onSelectElement({ scope: 'page_overlay', type: 'figure', index });
      }}><UserPlus size={14} />人物を追加</button>} />
      <div class="nested-list">
        {(overlay.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => !isPropPlacement(figure)).map(({ figure, index }) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'figure', index };
          const selected = selectedElement.type === 'figure' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${figure.splitOverlap ? 'is-split-overlap' : ''} ${figure.analogImport?.analysisReview ? 'is-analysis-review' : ''} ${selected ? 'is-selected' : ''}`} key={figure.analogImport?.sourceRegionId ?? index} onClick={(event) => selectCard(event, selection)}>
            <div class="nested-card-head">{selected || figure.splitOverlap
              ? <strong>{selected ? '選択中' : ''}{figure.splitOverlap && <em class="split-overlap-badge">分割重複</em>}</strong>
              : <span />}
              <button onClick={(event) => { event.stopPropagation(); update((draft) => { draft.figures?.splice(index, 1); }); onSelectElement(null); }}>×</button></div>
            <div class="field-grid">
              <Field label="登場人物"><select value={figure.refId ?? ''} onChange={(event) => update((draft) => {
                const target = draft.figures![index];
                const character = manga.characters.find((entry) => entry.localId === event.currentTarget.value);
                if (character) { target.refId = character.localId; target.name = character.name; }
                else delete target.refId;
                if (target.analogImport) {
                  target.analogImport.userEdited = true;
                  delete target.analogImport.analysisReview;
                  delete target.analogImport.analysisReviewMessage;
                }
                target.kind = 'person'; target.size ??= 'bust-up'; target.role ??= 'main';
              })}>
                <option value="">未選択</option>
                {manga.characters.map((character) => <option value={character.localId}>{character.name}</option>)}
              </select></Field>
              <Field label="描写範囲"><FigureSizePicker value={figure.size ?? 'bust-up'} onChange={(size) => update((draft) => { draft.figures![index].size = size; })} /></Field>
              <Field label="あつかい"><select value={figure.role ?? 'main'} onChange={(event) => update((draft) => { draft.figures![index].role = event.currentTarget.value as typeof figure.role; })}>{FIGURE_ROLES.map((role) => <option value={role}>{FIGURE_ROLE_LABELS[role]}</option>)}</select></Field>
              <Field label="アクション" wide><textarea rows={3} value={figure.action ?? ''} placeholder="この人物の表情・姿勢・視線・動作" onInput={(event) => update((draft) => {
                const value = event.currentTarget.value;
                value ? draft.figures![index].action = value : delete draft.figures![index].action;
              })} /></Field>
            </div>
            <FigureHumanPoseEditor key={`${manga.meta.series_id}:${manga.meta.episode_id}:${pageIndex}:overlay:${figure.layerId ?? index}`}
              stages={manga.background_stages} backgroundCaptures={panels.flatMap((panel, p) => (panel.background_images ?? []).flatMap((image, i) => image.paint?.background3d ? [{ label: `コマ${p + 1}の背景 ${i + 1}`, capture: image.paint.background3d }] : []))}
              aspect={figure.bbox && figure.bbox.h > 0 ? figure.bbox.w / figure.bbox.h : 1} framingLabel={FIGURE_SIZE_LABELS[figure.size ?? 'bust-up']} framingSize={figure.size ?? 'bust-up'}
              value={figure.human_pose} onChange={value => update(draft => {
                if (value) draft.figures![index].human_pose = value;
                else delete draft.figures![index].human_pose;
              })} />
            <FigureArtworkEditor showGuide={guideVisible(`figure-${index}`)} onToggleGuide={()=>onToggleGuide(`figure-${index}`)} figure={figure} onChange={next => update(draft => { draft.figures![index] = next; })} />
          </div>;
        })}
      </div>
    </section>

    <section class="editor-section">
      <SectionTitle title="小道具" action={<button class="inline-add" disabled={!props.length} onClick={() => {
        const index = overlay.figures?.length ?? 0;
        const prop = props[0];
        update((draft) => { (draft.figures ??= []).push({ name: prop?.key ?? '', kind: 'prop', refId: prop?.localId, bbox: { x: 55, y: 45, w: 100, h: 175 } }); });
        onSelectElement({ scope: 'page_overlay', type: 'figure', index });
      }}><Box size={14} />小道具を追加</button>} />
      <div class="nested-list">
        {(overlay.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => isPropPlacement(figure)).map(({ figure, index }) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'figure', index };
          const selected = selectedElement.type === 'figure' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${figure.splitOverlap ? 'is-split-overlap' : ''} ${selected ? 'is-selected' : ''}`} key={`${figure.refId ?? figure.name}-${index}`} onClick={(event) => selectCard(event, selection)}>
            <div class="nested-card-head">{selected || figure.splitOverlap
              ? <strong>{selected ? '選択中' : ''}{figure.splitOverlap && <em class="split-overlap-badge">分割重複</em>}</strong>
              : <span />}
              <button onClick={(event) => { event.stopPropagation(); update((draft) => { draft.figures?.splice(index, 1); }); onSelectElement(null); }}>×</button></div>
            <Field label="小道具"><select value={figure.refId ?? ''} onChange={(event) => update((draft) => {
              const target = draft.figures![index];
              const prop = props.find((entry) => entry.localId === event.currentTarget.value);
              if (prop) { target.refId = prop.localId; target.name = prop.key; }
              else delete target.refId;
              target.kind = 'prop'; delete target.size; delete target.role;
            })}><option value="">未選択</option>{props.map((material) => <option value={material.localId}>{material.key}</option>)}</select></Field>
            <FigureArtworkEditor showGuide={guideVisible(`figure-${index}`)} onToggleGuide={()=>onToggleGuide(`figure-${index}`)} figure={figure} onChange={next => update(draft => { draft.figures![index] = next; })} />
          </div>;
        })}
      </div>
    </section>

    <section class="editor-section">
      <SectionTitle index="02" title="フキダシ" action={<button class="inline-add" onClick={() => {
        const index = overlay.bubbles?.length ?? 0;
        update((draft) => { (draft.bubbles ??= []).push({ text: '', shape: 'normal', bbox: { x: 150, y: 20, w: 38, h: 55 } }); });
        onSelectElement({ scope: 'page_overlay', type: 'bubble', index });
      }}><MessageCircleMore size={14} />追加</button>} />
      <div class="nested-list">
        {(overlay.bubbles ?? []).map((bubble, index) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'bubble', index };
          const selected = selectedElement.type === 'bubble' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${bubble.splitOverlap ? 'is-split-overlap' : ''} ${selected ? 'is-selected' : ''}`} key={bubble.analogTextImport?.sourceRegionId ?? index} onClick={(event) => selectCard(event, selection)}>
            <div class="nested-card-head"><BubbleCardTitle number={index + 1} selected={selected} splitOverlap={bubble.splitOverlap} /><button onClick={(event) => { event.stopPropagation(); update((draft) => { if (draft.bubbles) removeBubbleAt(draft.bubbles, index); }); onSelectElement(null); }}>×</button></div>
            {bubble.analogTextImport && <label class="check-row analog-text-reference-toggle" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={!bubble.analogTextImport.referenceHidden} onChange={(event) => update((draft) => {
              const reference = draft.bubbles![index].analogTextImport;
              if (!reference) return;
              event.currentTarget.checked ? delete reference.referenceHidden : reference.referenceHidden = true;
            })} /><span>原画を表示</span></label>}
            {!onEditText&&<Field label="セリフ" wide><textarea rows={3} value={bubble.text} onInput={(event) => update((draft) => {
              const target = draft.bubbles![index];
              manga.scenario ? useScenarioBubbleText(target, event.currentTarget.value) : target.text = event.currentTarget.value;
            })} /></Field>}
          {onEditText&&<div class="bubble-direct-actions"><button type="button" onClick={e=>{e.stopPropagation();onEditText(index);}}>文字を編集</button>{onOpenBubbleMaterials&&<button type="button" onClick={e=>{e.stopPropagation();onSelectElement({ scope:'page_overlay', type:'bubble', index });onOpenBubbleMaterials();}}>素材から入れ替え</button>}</div>}
            {manga.scenario && <ScenarioBubbleNotice manga={manga} bubble={bubble} location={{ pageIndex, panelIndex: 0, bubbleIndex: index, overlay: true }} onScenarioChoice={onScenarioChoice} onOpen={onOpenScenario} />}
            <div class="field-grid">
              <Field label="所属"><select value="page_overlay" onChange={(event) => {
                const value = event.currentTarget.value;
                onMoveBubble(index, value === 'page_overlay' ? 'page_overlay' : Number(value));
              }}>
                <option value="page_overlay">ページ前景（コマ外）</option>
                {panels.map((item, targetIndex) => <option value={String(targetIndex)}>{panelDisplayLabel(item.id)}</option>)}
              </select></Field>
              <Field label="話者"><select value={bubble.speakerId ?? ''} onChange={(event) => update((draft) => { const character = manga.characters.find((entry) => entry.localId === event.currentTarget.value); if (character) { draft.bubbles![index].speakerId = character.localId; draft.bubbles![index].speaker = character.name; } else { delete draft.bubbles![index].speakerId; delete draft.bubbles![index].speaker; } })}><option value="">話者なし</option>{manga.characters.map((character) => <option value={character.localId}>{character.name}</option>)}</select></Field>

            </div>
            {bubbleShapeSuggestionStatus?.index === index && <p class={`person-action-suggest-status is-${bubbleShapeSuggestionStatus.kind}`} role={bubbleShapeSuggestionStatus.kind === 'error' ? 'alert' : 'status'}>{bubbleShapeSuggestionStatus.message}</p>}
          <details class="bubble-inspector-details"><summary>輪郭と補足情報</summary><div class="field-grid">
              <Field label="形"><div class="bubble-shape-field"><select value={bubble.shape ?? 'normal'} onChange={(event) => update((draft) => { setBubbleShape(draft.bubbles![index], event.currentTarget.value as NonNullable<typeof bubble.shape>); })}>{BUBBLE_SHAPES.map((shape) => <option value={shape}>{BUBBLE_SHAPE_LABELS[shape]}</option>)}</select><button type="button" title="話者・セリフ・ト書きからコードで形を選ぶ" onClick={() => requestBubbleShape(index)}><WandSparkles size={14} />自動</button></div></Field>
              <Field label="強調するフレーズ"><input value={bubble.emphasis ?? ''} placeholder="例：絶対, 忘れない" onInput={(event) => update((draft) => { const value = event.currentTarget.value; value ? draft.bubbles![index].emphasis = value : delete draft.bubbles![index].emphasis; })} onBlur={() => update((draft) => { const value = normalizedEmphasis(draft.bubbles![index].emphasis ?? ''); value ? draft.bubbles![index].emphasis = value : delete draft.bubbles![index].emphasis; })} /></Field>
          </div>
            <BubbleBezierEditor bubble={bubble} onChange={(outline, shape) => update((draft) => { const target = draft.bubbles![index]; if (outline) { target.bezier = outline; if (shape) target.shape = shape; } else setBubbleShape(target, shape ?? target.shape ?? 'normal'); })} />
          </details>
            <label class="check-row" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={bubbleTailIsEnabled(bubble)} onChange={(event) => update((draft) => { setBubbleTailEnabled(draft.bubbles![index], event.currentTarget.checked); })} /><span>しっぽあり</span></label>
            {index > 0 && <div class="bubble-join-control">
              <Field label="結合先"><select disabled={bubble.join_to === undefined} value={String(bubble.join_to ?? index)} onChange={(event) => update((draft) => { draft.bubbles![index].join_to = Number(event.currentTarget.value); })}>
                {(overlay.bubbles ?? []).slice(0, index).map((_, targetIndex) => <option value={String(targetIndex + 1)}>フキダシ {targetIndex + 1}</option>)}
              </select></Field>
              <label class="check-row"><input type="checkbox" checked={bubble.join_to !== undefined} onChange={(event) => update((draft) => {
                event.currentTarget.checked ? draft.bubbles![index].join_to = index : delete draft.bubbles![index].join_to;
              })} /><span>コマ結合</span></label>
            </div>}
            <details class="advanced-coordinate-editor"><summary>配置情報（任意）</summary><span class="sub-label">BBOX <small>紙面絶対座標 mm</small></span><BBoxEditor value={bubble.bbox} onChange={(bbox) => update((draft) => { draft.bubbles![index].bbox = bbox; })} /></details>
          </div>;
        })}
      </div>
    </section>
    </div>
  </div>;
}
