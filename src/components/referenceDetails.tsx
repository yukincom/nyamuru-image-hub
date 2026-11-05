import type { VisualEvidence, CharacterRecognitionProfile, MangaDocument, Material, Character } from '../types.ts';
import { CHARACTER_REFERENCE_VIEWS, CHARACTER_RECOGNITION_FIELDS } from '../lib/characterReferences.ts';
import { useState, useEffect } from 'preact/hooks';
import { loadCharacterReferenceImage, type CharacterReferenceSetSuggestion } from '../lib/localBridge.ts';
import { FileImage } from 'lucide-preact';
import { TextListEditor } from './Fields.tsx';

export const emptyEvidence = (): VisualEvidence => ({ observed: [], inferred: [] });

export function emptyRecognition(): CharacterRecognitionProfile {
  return {
    hair: emptyEvidence(),
    face: emptyEvidence(),
    silhouette: emptyEvidence(),
    outfit: emptyEvidence(),
    accessories: emptyEvidence(),
    ambiguous_design: emptyEvidence(),
  };
}

export function uniqueMaterialName(document: MangaDocument, base: string): string {
  const names = new Set(document.manga.materials.map((material) => material.key));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

export function guessedView(fileName: string): Material['view'] {
  if (/三面|設定|turnaround/iu.test(fileName)) return 'turnaround';
  if (/正面|front/iu.test(fileName)) return 'front';
  if (/斜め|three.?quarter/iu.test(fileName)) return 'three-quarter';
  if (/横|側面|side|profile/iu.test(fileName)) return 'side';
  if (/背面|後ろ|back/iu.test(fileName)) return 'back';
  if (/表情|expression/iu.test(fileName)) return 'expression';
  if (/衣装|costume/iu.test(fileName)) return 'costume';
  return 'other';
}

function viewLabel(view: Material['view']): string {
  return CHARACTER_REFERENCE_VIEWS.find((item) => item.value === view)?.label ?? '人物資料';
}

export function ReferenceThumbnail({ document, character, material }: { document: MangaDocument; character: Character; material: Material }) {
  const [url, setUrl] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setMissing(false);
    const source = material.source_image;
    if (!source || !document.manga.meta.series_id || !character.catalog_id) {
      setMissing(true);
      return undefined;
    }
    void loadCharacterReferenceImage(document.manga.meta.series_id, character.catalog_id, source.asset_id)
      .then((blob) => {
        if (!active) return;
        if (!blob) { setMissing(true); return; }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setMissing(true));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.manga.meta.series_id, character.catalog_id, material.source_image?.asset_id]);
  if (url) return <img src={url} alt={`${character.name}の${viewLabel(material.view)}`} />;
  return <span class="character-reference-placeholder"><FileImage size={22} />{missing ? '画像なし' : '読込中'}</span>;
}

export function CandidateEvidence({
  suggestion,
  onChange,
}: {
  suggestion: Pick<CharacterReferenceSetSuggestion, 'recognition'>;
  onChange: (
    field: (typeof CHARACTER_RECOGNITION_FIELDS)[number]['key'],
    values: string[],
  ) => void;
}) {
  return <div class="character-recognition-candidate-fields">
    {CHARACTER_RECOGNITION_FIELDS.map(({ key, label }) => {
      const evidence = suggestion.recognition[key];
      return <section key={key}><strong>{label}</strong>
        <div><TextListEditor compactAdd values={evidence.observed} placeholder={`${label}の抽出特徴`} onChange={(values) => onChange(key, values)} /></div>
      </section>;
    })}
  </div>;
}
