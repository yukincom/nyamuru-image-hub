import BubbleInfoPortal from './BubbleInfoPortal';
import FigureSizePicker from './FigureSizePicker';
import FigureHumanPoseEditor from './FigureHumanPoseEditor';
import { Box, MessageCircleMore, UserPlus } from 'lucide-preact';
import { FIGURE_SIZE_LABELS, FIGURE_ROLE_LABELS, FIGURE_ROLES } from '../lib/manga';
import { bubbleTailStyle, setBubbleTailStyle } from '../lib/bubblePresentation.ts';
import { removeBubbleAt } from '../lib/bubbleConnections.ts';
import type { CanvasElementSelection, Manga, PageOverlay, Panel } from '../types';
import { isPropPlacement } from '../lib/catalogModel.ts';
import { Field, SectionTitle } from './Fields';
import BubbleCardTitle from './BubbleCardTitle';
import ScenarioBubbleNotice, { type ScenarioBubbleChoiceProps } from './ScenarioBubbleNotice';
import { useInspectorSelectionScroll } from './useInspectorSelectionScroll.ts';
import { ownerItemLocked, preservesLockedItems } from '../lib/panelLayers.ts';

interface Props extends ScenarioBubbleChoiceProps {
  painting?: boolean;
  pageIndex: number;
  manga: Manga;
  panels: readonly Panel[];
  overlay: PageOverlay;
  selectedElement: CanvasElementSelection | null;
  canvasSelectionScrollRequest: number;
  onSelectElement: (selection: CanvasElementSelection | null) => void;
  onChange: (overlay: PageOverlay | undefined) => void;
}

export default function PageOverlayInspector({ manga, panels, overlay, pageIndex, selectedElement, canvasSelectionScrollRequest, onSelectElement, onChange, onScenarioChoice }: Props) {
  const inspectorRef = useInspectorSelectionScroll(canvasSelectionScrollRequest);
  const props = manga.materials.filter((material) => material.type === 'prop');
  const update = (recipe: (draft: PageOverlay) => void) => {
    const draft = structuredClone(overlay);
    recipe(draft);
    if(!preservesLockedItems(overlay.figures,draft.figures)||!preservesLockedItems(overlay.bubbles,draft.bubbles))return;
    if (!(draft.figures?.length) && !(draft.bubbles?.length)) onChange(undefined);
    else onChange(draft);
  };
  const selectCard = (_event: MouseEvent, selection: CanvasElementSelection) => onSelectElement(selection);
  return <div ref={inspectorRef} class="panel-inspector page-overlay-inspector">
    <div class="inspector-sticky-head">
      <div><span class="eyebrow">PAGE OVERLAY</span><h2>ページ前景</h2></div>
    </div>

    <div class="inspector-fields">
    <section class="editor-section inspector-category-section">
      <SectionTitle index="01" title="人物" action={<button class="inline-add" disabled={!manga.characters.length} onClick={() => {
        const index = overlay.figures?.length ?? 0;
        const character = manga.characters[0];
        update((draft) => { (draft.figures ??= []).push({ name: character?.name ?? '', kind: 'person', refId: character?.localId, bbox: { x: 55, y: 45, w: 100, h: 175 }, size: 'bust-up', role: 'main' }); });
        onSelectElement({ scope: 'page_overlay', type: 'figure', index });
      }}><UserPlus size={14} />人物を追加</button>} />
      <div class="nested-list">
        {(overlay.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => !isPropPlacement(figure)).map(({ figure, index }) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'figure', index };
          const selected = selectedElement?.type === 'figure' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${ownerItemLocked(figure)?'is-locked':''} ${figure.splitOverlap ? 'is-split-overlap' : ''} ${figure.analogImport?.analysisReview ? 'is-analysis-review' : ''} ${selected ? 'is-selected' : ''}`} inert={ownerItemLocked(figure)} aria-disabled={ownerItemLocked(figure)} key={figure.analogImport?.sourceRegionId ?? index} onClick={(event) => selectCard(event, selection)}>
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
              <Field label="撮影範囲"><FigureSizePicker value={figure.size ?? 'bust-up'} onChange={size => update(draft => { draft.figures![index].size = size; })} /></Field>
              <Field label="あつかい"><select value={figure.role ?? 'main'} onChange={(event) => update((draft) => { draft.figures![index].role = event.currentTarget.value as typeof figure.role; })}>{FIGURE_ROLES.map((role) => <option value={role}>{FIGURE_ROLE_LABELS[role]}</option>)}</select></Field>
              <Field label="アクション" wide><textarea rows={3} value={figure.action ?? ''} placeholder="この人物の表情・姿勢・視線・動作" onInput={(event) => update((draft) => {
                const value = event.currentTarget.value;
                value ? draft.figures![index].action = value : delete draft.figures![index].action;
              })} /></Field>
            </div>
            <FigureHumanPoseEditor key={`${manga.meta.series_id}:${manga.meta.episode_id}:${pageIndex}:overlay:${figure.layerId ?? index}`}
              stages={manga.background_stages} backgroundCaptures={panels.flatMap((panel, p) => (panel.background_images ?? []).flatMap((image, i) => image.paint?.background3d ? [{ label: `コマ${p + 1}の背景 ${i + 1}`, capture: image.paint.background3d }] : []))}
              aspect={figure.bbox && figure.bbox.h > 0 ? figure.bbox.w / figure.bbox.h : 1} framingLabel={FIGURE_SIZE_LABELS[figure.size ?? 'bust-up']} framingSize={figure.size ?? 'bust-up'}
              value={figure.human_pose} onChange={(value, confirmedFramingSize) => update(draft => {
                if (value) draft.figures![index].human_pose = value;
                else delete draft.figures![index].human_pose;
                if (confirmedFramingSize) draft.figures![index].size = confirmedFramingSize;
              })} />
          </div>;
        })}
      </div>
    </section>

    <section class="editor-section inspector-category-section">
      <SectionTitle title="小道具" action={<button class="inline-add" disabled={!props.length} onClick={() => {
        const index = overlay.figures?.length ?? 0;
        const prop = props[0];
        update((draft) => { (draft.figures ??= []).push({ name: prop?.key ?? '', kind: 'prop', refId: prop?.localId, bbox: { x: 55, y: 45, w: 100, h: 175 } }); });
        onSelectElement({ scope: 'page_overlay', type: 'figure', index });
      }}><Box size={14} />小道具を追加</button>} />
      <div class="nested-list">
        {(overlay.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => isPropPlacement(figure)).map(({ figure, index }) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'figure', index };
          const selected = selectedElement?.type === 'figure' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${ownerItemLocked(figure)?'is-locked':''} ${figure.splitOverlap ? 'is-split-overlap' : ''} ${selected ? 'is-selected' : ''}`} inert={ownerItemLocked(figure)} aria-disabled={ownerItemLocked(figure)} key={`${figure.refId ?? figure.name}-${index}`} onClick={(event) => selectCard(event, selection)}>
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
          </div>;
        })}
      </div>
    </section>

    <BubbleInfoPortal request={canvasSelectionScrollRequest} label={"ページ前景の吹き出し情報"}>
    <section class="editor-section inspector-category-section">
      <SectionTitle index="02" title="フキダシ" action={<button class="inline-add" onClick={() => {
        const index = overlay.bubbles?.length ?? 0;
        update((draft) => { (draft.bubbles ??= []).push({ text: '', shape: 'normal', bbox: { x: 150, y: 20, w: 38, h: 55 } }); });
        onSelectElement({ scope: 'page_overlay', type: 'bubble', index });
      }}><MessageCircleMore size={14} />追加</button>} />
      <div class="nested-list">
        {(overlay.bubbles ?? []).map((bubble, index) => {
          const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'bubble', index };
          const selected = selectedElement?.type === 'bubble' && selectedElement.index === index;
          return <div class={`nested-card selectable-card ${ownerItemLocked(bubble)?'is-locked':''} ${bubble.splitOverlap ? 'is-split-overlap' : ''} ${selected ? 'is-selected' : ''}`} inert={ownerItemLocked(bubble)} aria-disabled={ownerItemLocked(bubble)} key={bubble.analogTextImport?.sourceRegionId ?? index} onClick={(event) => selectCard(event, selection)}>
            <div class="nested-card-head"><BubbleCardTitle number={index + 1} selected={selected} splitOverlap={bubble.splitOverlap} /><button onClick={(event) => { event.stopPropagation(); update((draft) => { if (draft.bubbles) removeBubbleAt(draft.bubbles, index); }); onSelectElement(null); }}>×</button></div>
            {manga.scenario && <ScenarioBubbleNotice manga={manga} bubble={bubble} location={{ pageIndex, panelIndex: 0, bubbleIndex: index, overlay: true }} onScenarioChoice={onScenarioChoice} />}
            <div class="field-grid">
              <Field label="話者"><select value={bubble.speakerId ?? ''} onChange={(event) => update((draft) => { const character = manga.characters.find((entry) => entry.localId === event.currentTarget.value); if (character) { draft.bubbles![index].speakerId = character.localId; draft.bubbles![index].speaker = character.name; } else { delete draft.bubbles![index].speakerId; delete draft.bubbles![index].speaker; } })}><option value="">話者なし</option>{manga.characters.map((character) => <option value={character.localId}>{character.name}</option>)}</select></Field>

            </div>
            <Field label="しっぽ"><select value={bubbleTailStyle(bubble)} onChange={(event)=>update((draft)=>setBubbleTailStyle(draft.bubbles![index],event.currentTarget.value as 'none'|'normal'|'thinking'))}><option value="none">なし</option><option value="normal">通常のしっぽ</option><option value="thinking">thinking（丸2〜4個）</option></select></Field>
            {index > 0 && <div class="bubble-join-control">
              <Field label="結合先"><select value={bubble.join_to === undefined ? '' : String(bubble.join_to)} onChange={(event) => { const value=event.currentTarget.value;update((draft) => { value ? draft.bubbles![index].join_to=Number(value) : delete draft.bubbles![index].join_to; }); }}>
                <option value="">結合しない</option>
                {(overlay.bubbles ?? []).slice(0, index).map((_, targetIndex) => <option value={String(targetIndex + 1)}>フキダシ {targetIndex + 1}</option>)}
              </select></Field>
            </div>}
          </div>;
        })}
      </div>
    </section>
    </BubbleInfoPortal>
    </div>
  </div>;
}
