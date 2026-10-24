import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { loadHumanPoseCatalog } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { searchHumanPoses } from '../lib/humanPoseSearch.ts';
import { humanPoseSelectable, selectHumanPose } from '../lib/humanPoseSelection.ts';
import { renderHumanPoseTemplate } from '../lib/humanPoseTemplate.ts';
import { confirmHumanPoseCameraPrompt, humanPoseCameraPromptCurrent, humanPoseCameraPromptText } from '../lib/humanPoseScene.ts';
import { HUMAN_POSE_PREVIEW_ART } from '../lib/humanPosePreviewArt.ts';
import type { HumanPoseCatalog, HumanPoseTextSelection } from '../lib/humanPoseTypes.ts';
import type { BackgroundCapture, BackgroundStage } from '../types.ts';
import HumanPoseSceneDialog from './HumanPoseSceneDialog.tsx';
import './FigureHumanPoseEditor.css';

interface Props {
  value?: HumanPoseTextSelection;
  aspect?: number;
  framingLabel?: string;
  stages?: BackgroundStage[];
  backgroundCaptures?: Array<{ label: string; capture: BackgroundCapture }>;
  onChange: (value: HumanPoseTextSelection | undefined) => void;
}

export default function FigureHumanPoseEditor({ value, aspect, framingLabel, stages, backgroundCaptures, onChange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const sceneTrigger = useRef<HTMLButtonElement>(null);
  const [catalog, setCatalog] = useState<HumanPoseCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const ready = catalog?.poses.filter(humanPoseSelectable) ?? [];
  const matches = catalog ? searchHumanPoses(ready, catalog.tags, query) : [];
  const draft = ready.find(pose => pose.id === draftId);
  const baselineText = value?.baseline_segments.map(segment => segment.text_ja).join('') ?? '';
  const cameraPrompt = value?.camera_prompt;
  const cameraText = cameraPrompt && humanPoseCameraPromptText(cameraPrompt);
  const cameraCurrent = cameraPrompt && humanPoseCameraPromptCurrent(cameraPrompt, value?.scene);
  const aspectMismatch = value?.scene && aspect && Math.abs(value.scene.frame.width / value.scene.frame.height / aspect - 1) > .01;
  const editCamera = (key: 'angle_ja' | 'lens_ja', text: string) => {
    if (!value || !cameraPrompt || !cameraText) return;
    const overrides = { ...cameraPrompt.overrides };
    const automatic = key === 'angle_ja' ? cameraText.automatic.angle.ja : cameraText.automatic.lens.ja;
    if (text === automatic) delete overrides[key]; else overrides[key] = text;
    onChange({ ...value, camera_prompt: { ...cameraPrompt, overrides, review_required: Object.keys(overrides).length > 0 && cameraPrompt.review_required } });
  };

  // 読込完了が取消後や別の人物へ届いても、画面と文書を書き換えない。
  const load = async () => {
    const token = ++request.current;
    setLoading(true); setError(''); setCatalog(null);
    try {
      const next = await withNewCreationBridgeSession(loadHumanPoseCatalog);
      if (token === request.current) setCatalog(next);
    } catch (cause) {
      if (token === request.current) setError(cause instanceof Error ? cause.message : '人体ポーズを読み込めませんでした');
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  const close = () => {
    request.current += 1;
    dialog.current?.close(); setOpen(false); trigger.current?.focus();
  };
  const show = () => {
    setDraftId(value?.pose_id ?? null); setQuery(''); setOpen(true); void load();
  };
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => () => { request.current += 1; }, []);

  // 同じposeの再選択では基準と編集文をともに維持し、無断で基準改訂へ移さない。
  const confirm = () => {
    if (!draft || !catalog) return;
    if (value?.pose_id === draft.id) { close(); return; }
    const next = selectHumanPose(draft, catalog.catalog_sha256);
    onChange(next); close();
  };

  return <section class="figure-human-pose" aria-label="人体ポーズ">
    <div class="figure-human-pose-heading">
      <strong>ポーズ</strong>
      <button type="button" class="secondary-button" ref={trigger} onClick={show}>{value ? 'ポーズを変更' : 'ポーズを選ぶ'}</button>
    </div>
    <p class="field-note">選択したポーズと日本語の編集内容を保存します。画像生成への反映は準備中です。</p>
    {value && <>
      <p>{value.display_number === undefined ? '' : `${value.display_number} `}{value.label_ja}</p>
      <fieldset class="human-pose-input-mode" aria-describedby={`${id}-mode-note`}>
        <legend>ポーズの送り方</legend>
        {([['prompt', 'プロンプトで送る'], ['image', '撮影画像で送る']] as const).map(([mode, label]) =>
          <label key={mode}><input type="radio" name={`${id}-input-mode`} value={mode} checked={value.input_mode === mode}
            onChange={event => { if (event.currentTarget.checked && value.input_mode !== mode) onChange({ ...value, input_mode: mode }); }} />{label}</label>)}
      </fieldset>
      <p class="field-note" id={`${id}-mode-note`} role="status">{value.input_mode === 'prompt'
        ? '編集したポーズ文を使います。3Dの撮影画像はポーズ指定に含めません。'
        : '撮影した3Dの姿勢を使います。編集したポーズ文は保存しますが、画像と一緒には送りません。切り替えても3Dの姿勢は変わりません。'}</p>
      <label for={`${id}-text`}>ポーズの説明（日本語）</label>
      <textarea id={`${id}-text`} rows={5} maxLength={20_000} value={value.edited_text_ja} aria-describedby={`${id}-mode-note`}
        onInput={event => onChange({ ...value, edited_text_ja: event.currentTarget.value })} />
      <button type="button" class="secondary-button" disabled={value.edited_text_ja === baselineText}
        onClick={() => onChange({ ...value, edited_text_ja: baselineText })}>選択時の文に戻す</button>
      <details><summary>基準の文面</summary>
        <p>{baselineText}</p>
        <p lang="en">{value.baseline_segments.map(segment => renderHumanPoseTemplate(segment.template_en)).join(' ')}</p>
      </details>
      <p><button type="button" class="secondary-button" ref={sceneTrigger} onClick={() => setSceneOpen(true)}>3D配置・撮影を調整</button>
        {value.scene && <span class="field-note"> {value.scene.motion ? 'モーション・微調整・撮影設定を保存済み' : value.scene.joint_edits ? '関節・配置・撮影設定を保存済み' : '配置・撮影設定を保存済み'}{value.scene.body_mirror === 'mirrored' ? '（体勢を左右反転）' : ''}</span>}</p>
      {cameraPrompt && cameraText ? <fieldset class="human-pose-camera-text"><legend>撮影設定の説明</legend>
        {!cameraCurrent && <p role="status">撮影設定が変わっています。「3D配置・撮影を調整」で確定し直してください。以下は前回確定した文面です。</p>}
        <p class="field-note">ポーズ文で身体の向きを変えた場合は、アングルも見比べて修正してください。</p>
        {([['angle_ja', 'アングル', cameraText.automatic.angle], ['lens_ja', 'レンズ', cameraText.automatic.lens]] as const).map(([key, label, auto]) =>
          <div key={key}><label for={`${id}-${key}`}>{label}の説明（日本語）</label>
            <textarea id={`${id}-${key}`} rows={2} maxLength={2000} value={cameraPrompt.overrides[key] ?? auto.ja}
              onInput={event => editCamera(key, event.currentTarget.value)} />
            <button type="button" class="secondary-button" disabled={cameraPrompt.overrides[key] === undefined} onClick={() => editCamera(key, auto.ja)}>{label}を自動文に戻す</button>
            <details><summary>{label}の自動文</summary><p>{auto.ja || '判定できません'}</p><p lang="en">{auto.en}</p></details></div>)}
        {cameraText.automatic.azimuth === null && <p class="field-note">この姿勢・カメラ位置では前後左右を確定できないため、自動文には含めていません。</p>}
        {cameraPrompt.review_required && <p role="status">撮影設定を変更したため、残してある手修正文を見直してください。
          <button type="button" class="secondary-button" disabled={!cameraCurrent} onClick={() => onChange({ ...value, camera_prompt: { ...cameraPrompt, review_required: false } })}>手修正文を確認した</button></p>}
        <p class="field-note">描写範囲：{framingLabel || '未指定'}。映り方は撮影プレビューで確認してください。</p>
        {aspectMismatch && <p role="status">保存した撮影と現在の人物枠で縦横比が異なります。3D画面で人物枠に合わせて確認してください。</p>}
        {cameraText.en === null ? <p class="field-note">手修正文は日本語で保存します。生成に使う英語への翻訳は未実行です。</p>
          : <details><summary>確定時の英語文面</summary><p lang="en">{cameraText.en}</p></details>}
        {value.input_mode === 'image' && cameraText.edited && <p role="status">文面の修正では撮影画像は変わりません。画像を使う場合は3D設定も合わせるか、プロンプトで送る方法に切り替えてください。</p>}
      </fieldset> : value.scene && <p class="field-note">撮影設定の説明を保存するには「3D配置・撮影を調整」で確定してください。</p>}
      {value.input_mode === 'image' && <p class="field-note">「3D配置・撮影を調整」で撮影内容を確認できます。PNGの保存と生成への送信は準備中です。</p>}
      <button type="button" class="secondary-button" onClick={() => onChange(undefined)}>ポーズと編集文を解除</button>
    </>}
    {sceneOpen && value && <HumanPoseSceneDialog key={`${value.pose_id}:${value.catalog_sha256}`} value={value} aspect={aspect} framingLabel={framingLabel} stages={stages} backgroundCaptures={backgroundCaptures}
      onConfirm={(scene, subject) => onChange({ ...value, scene, camera_prompt: confirmHumanPoseCameraPrompt(scene, subject, value.camera_prompt) })}
      onClose={() => { setSceneOpen(false); sceneTrigger.current?.focus(); }} />}
    {open && createPortal(<dialog ref={dialog} class="human-pose-dialog" aria-labelledby={`${id}-title`}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div class="human-pose-dialog-content">
        <header><h2 id={`${id}-title`}>ポーズを選ぶ</h2><button type="button" class="icon-button" onClick={close} aria-label="閉じる">×</button></header>
        <label for={`${id}-search`}>番号・ポーズ・動作で検索</label>
        <input id={`${id}-search`} type="search" autoFocus value={query} placeholder="例：座る 足を組む / 23"
          onInput={event => setQuery(event.currentTarget.value)} />
        <div class="human-pose-search-shortcuts">
          {['立つ', '座る', '椅子', '身振り', '足を組む'].map(word => <button type="button" class="secondary-button" key={word}
            onClick={() => setQuery(current => current ? `${current} ${word}` : word)}>{word}</button>)}
          {query && <button type="button" class="secondary-button" onClick={() => setQuery('')}>条件をクリア</button>}
        </div>
        {loading && <p role="status">ポーズを読み込んでいます…</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" class="secondary-button" onClick={() => void load()}>再読込</button></div>}
        {catalog && <>
          <p role="status">{matches.length}件 / 選択できる{ready.length}件</p>
          {value && catalog.catalog_sha256 !== value.catalog_sha256 && <p class="field-note">保存時と一覧の版が異なります。現在の編集文はそのまま保持されています。</p>}
          {ready.length === 0 ? <p>利用できるポーズ素材はまだ登録されていません。</p>
            : matches.length === 0 ? <p>条件に合うポーズがありません。</p> : null}
          <div class="human-pose-grid" aria-label="ポーズ候補">
            {matches.map(pose => <button key={pose.id} type="button" class={`human-pose-card ${draftId === pose.id ? 'is-selected' : ''}`}
              aria-pressed={draftId === pose.id} onClick={() => setDraftId(pose.id)}>
              {HUMAN_POSE_PREVIEW_ART[pose.id]
                ? <img src={HUMAN_POSE_PREVIEW_ART[pose.id]} alt="" width={150} height={150} loading="lazy" />
                : <span>プレビュー準備中</span>}
              <span>{pose.display_number} {pose.label_ja}</span>
            </button>)}
          </div>
          {draft && <section class="human-pose-detail" aria-label="仮選択したポーズ">
            {HUMAN_POSE_PREVIEW_ART[draft.id]
              ? <img src={HUMAN_POSE_PREVIEW_ART[draft.id]} alt={`${draft.label_ja}の姿勢`} width={240} height={240} />
              : <p>プレビュー準備中</p>}
            <div><h3>{draft.display_number} {draft.label_ja}</h3><p>{draft.pose_text_ja}</p>
              {draft.prompt_validation && <p class="field-note">{draft.prompt_validation.status}：{draft.prompt_validation.note}</p>}
            </div>
          </section>}
        </>}
        <footer><p class="field-note">別のポーズを確定されると現在のポーズ指定は上書きされます</p>
          <button type="button" class="secondary-button" onClick={close}>取消</button>
          <button type="button" class="primary-button" disabled={!draft || loading} onClick={confirm}>確定</button>
        </footer>
      </div>
    </dialog>, document.body)}
  </section>;
}
