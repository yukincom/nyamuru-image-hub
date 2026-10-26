import type { Figure } from '../types.ts';

export function panelDisplayLabel(panelId: number): string {
  return `コマ ${String(panelId).padStart(2, '0')}`;
}

/** Never leave a visible guide unnamed when imported or unresolved data has a blank name. */
export function figureDisplayLabel(figure:Pick<Figure,'name'|'kind'|'object'>,index:number):string {
  const name=figure.name?.normalize('NFKC').trim();
  return name || (figure.kind==='prop'||figure.object===true?`小道具 ${index+1}`:`人物 ${index+1}`);
}
