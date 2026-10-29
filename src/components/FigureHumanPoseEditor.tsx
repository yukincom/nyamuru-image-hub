import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { loadHumanPoseCatalog } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { selectHumanPose } from '../lib/humanPoseSelection.ts';
import { renderHumanPoseTemplate } from '../lib/humanPoseTemplate.ts';
import { confirmHumanPoseCameraPrompt, humanPoseCameraPromptCurrent, humanPoseCameraPromptText } from '../lib/humanPoseScene.ts';
import type { HumanPoseTextSelection } from '../lib/humanPoseTypes.ts';
import type { BackgroundCapture, BackgroundStage, FigureSize } from '../types.ts';
import HumanPoseSceneDialog from './HumanPoseSceneDialog.tsx';
import type { HumanPoseCutFrame } from '../lib/humanPoseFraming.ts';
import type { HumanPosePanelContext } from '../lib/humanPoseComposition.ts';
import './FigureHumanPoseEditor.css';

interface Props {
  value?: HumanPoseTextSelection;
  aspect?: number;
  framingLabel?: string;
  framingSize?: FigureSize;
  cutFrame?: HumanPoseCutFrame;
  panelContext?: HumanPosePanelContext;
  stages?: BackgroundStage[];
  backgroundCaptures?: Array<{ label: string; capture: BackgroundCapture }>;
  onChange: (value: HumanPoseTextSelection | undefined, confirmedFramingSize?: FigureSize) => void;
}

export default function FigureHumanPoseEditor({ value, aspect: figureAspect, framingLabel, framingSize, cutFrame, panelContext, stages, backgroundCaptures, onChange }: Props) {
  const aspect = cutFrame?.aspect ?? figureAspect;
  const id = useId();
  const sceneTrigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const [sceneValue, setSceneValue] = useState<HumanPoseTextSelection | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
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

  useEffect(() => () => { request.current += 1; }, []);
  const openScene = async () => {
    if (value) { setSceneValue(structuredClone(value)); return; }
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const catalog = await withNewCreationBridgeSession(loadHumanPoseCatalog);
      if (token !== request.current) return;
      const base = catalog.poses.find(pose => pose.id === 'pose-mh-standing01');
      if (!base) throw new Error('3Dの初期姿勢が見つかりません');
      setSceneValue({ ...selectHumanPose(base, catalog.catalog_sha256), input_mode: 'image' });
    } catch (cause) { if (token === request.current) setError(cause instanceof Error ? cause.message : '3Dを開けませんでした'); }
    finally { if (token === request.current) setLoading(false); }
  };

  return <section class="figure-human-pose" aria-label="人体ポーズ">
    <button type="button" class="primary-button figure-human-pose-edit" ref={sceneTrigger} disabled={loading} onClick={() => void openScene()}>3D編集</button>
    {loading && <p role="status">3Dの初期姿勢を読み込んでいます…</p>}
    {error && <p role="alert">{error}</p>}
    {value && <>
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
      <p>{value.scene && <span class="field-note"> {value.scene.motion ? 'モーション・微調整・撮影設定を保存済み' : value.scene.joint_edits ? '関節・配置・撮影設定を保存済み' : '配置・撮影設定を保存済み'}{value.scene.body_mirror === 'mirrored' ? '（体勢を左右反転）' : ''}</span>}</p>
      {cameraPrompt && cameraText ? <fieldset class="human-pose-camera-text"><legend>撮影設定の説明</legend>
        {!cameraCurrent && <p role="status">撮影設定が変わっています。「3D編集」で確定し直してください。以下は前回確定した文面です。</p>}
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
        {aspectMismatch && <p role="status">保存した撮影と現在の{cutFrame ? 'コマ枠' : '人物枠'}で縦横比が異なります。3D画面で枠に合わせて確認してください。</p>}
        {cameraText.en === null ? <p class="field-note">手修正文は日本語で保存し、生成時に英訳して送ります。</p>
          : <details><summary>確定時の英語文面</summary><p lang="en">{cameraText.en}</p></details>}
        {value.input_mode === 'image' && cameraText.edited && <p role="status">文面の修正では撮影画像は変わりません。画像を使う場合は3D設定も合わせるか、プロンプトで送る方法に切り替えてください。</p>}
      </fieldset> : value.scene && <p class="field-note">撮影設定の説明を保存するには「3D編集」で確定してください。</p>}
      {value.input_mode === 'image' && <p class="field-note">描写範囲に合わせた3D画像を生成画面で確認して送ります。人物の外見と画風には登場人物の資料を使います。</p>}
      <button type="button" class="secondary-button" onClick={() => onChange(undefined)}>ポーズと編集文を解除</button>
    </>}
    {sceneValue && <HumanPoseSceneDialog key={`${sceneValue.pose_id}:${sceneValue.catalog_sha256}`} value={sceneValue} aspect={aspect} framingLabel={framingLabel} framingSize={framingSize} cutFrame={cutFrame} panelContext={panelContext} stages={stages} backgroundCaptures={backgroundCaptures}
      onConfirm={(scene, subject, selection) => onChange({ ...selection, scene, camera_prompt: confirmHumanPoseCameraPrompt(scene, subject, selection.camera_prompt) }, scene.framing?.size)}
      onClose={() => { setSceneValue(null); sceneTrigger.current?.focus(); }} />}
  </section>;
}
