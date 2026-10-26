import type { QwenGenerationPlan, qwenGenerationPayload } from './qwenGeneration.ts';
import { uncompressedZip } from './pageExport.ts';

type Entry = { name: string; bytes: Uint8Array };
const encoder = new TextEncoder();

/** Export the exact reviewed inputs, with per-image roles and the original insertion target. */
export function generationHandoff(plan: QwenGenerationPlan, payload: ReturnType<typeof qwenGenerationPayload>, agent: string): Blob {
  const entries: Entry[] = [], roles: string[] = [];
  const add = (image: string, label: string, keys: string[]) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('送信用のPNG画像を確認できません');
    const name = `image-${entries.length + 1}.png`;
    entries.push({ name, bytes: Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0)) });
    roles.push(`${name}: ${label}${keys.length ? ` / ${keys.map(key => `Character ${plan.characterKeys.indexOf(key) + 1}`).join(', ')}` : ''}`);
  };
  if (payload.paint_image) add(payload.paint_image, plan.scope ? '紙面の構図・人物配置・フキダシと文字' : '描画参照', []);
  if (payload.sketch_image) add(payload.sketch_image, '人物のあたり', []);
  if (payload.correction_image) add(payload.correction_image, '修正する箇所の指定', []);
  payload.references.forEach(ref => add(ref.image, ref.label, ref.character_keys));
  const instructions = `# ${plan.label}の画像生成\n\n${agent}へ、以下の指示と添付画像を渡してください。\n\n${payload.prompt}\n\n## 添付画像\n\n${roles.join('\n')}\n\n## 納品\n\n${plan.width} × ${plan.height}px、PNG画像1枚。ファイル名は result.png。指定した範囲と縦横比を保ってください。\n生成後、Nyamuruの生成画面で「生成画像を読み込む」を選び、同じ対象へ戻してください。\n`;
  const { references: _references, paint_image: _paint, sketch_image: _sketch, correction_image: _correction, ...request } = payload;
  entries.push({ name: 'instructions.md', bytes: encoder.encode(instructions) });
  entries.push({ name: 'target.json', bytes: encoder.encode(JSON.stringify({ ...request, image_roles: roles, output_file: 'result.png' }, null, 2)) });
  return uncompressedZip(entries);
}
