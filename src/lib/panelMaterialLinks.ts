import type { MangaDocument } from '../types';
import { fallbackBox } from './canvasGeometry.ts';
import { isPropPlacement } from './catalogModel.ts';

export interface PanelMaterialLinkTarget {
  pageIndex: number;
  panelIndex: number;
  materialType: 'background' | 'prop';
}

export function setPanelMaterialLink(
  document: MangaDocument,
  target: PanelMaterialLinkTarget,
  materialKey: string,
  linked: boolean,
): boolean {
  const panel = document.manga.pages[target.pageIndex]?.panels[target.panelIndex];
  if (!panel || !materialKey) return false;

  const matchingMaterials = (document.manga.materials ?? []).filter((material) => material.key === materialKey && material.type === target.materialType);
  if (linked && !matchingMaterials.length) return false;
  const materialId = matchingMaterials.length === 1 ? matchingMaterials[0].localId : undefined;
  const assets = [...(panel.assets ?? [])];
  const assetIds = assets.map((_, index) => panel.assetIds?.[index] ?? '');
  const matches = (key: string, id: string) => (materialId ? id === materialId : false) || key === materialKey;

  if (linked) {
    const existingIndex = assets.findIndex((key, index) => matches(key, assetIds[index]));
    if (existingIndex < 0) {
      assets.push(materialKey);
      assetIds.push(materialId ?? '');
    } else if (materialId && !assetIds[existingIndex]) {
      assetIds[existingIndex] = materialId;
    }
  } else {
    for (let index = assets.length - 1; index >= 0; index -= 1) {
      if (!matches(assets[index], assetIds[index])) continue;
      assets.splice(index, 1);
      assetIds.splice(index, 1);
    }
  }

  if (assets.length) {
    panel.assets = assets;
    panel.assetIds = assetIds;
  } else {
    delete panel.assets;
    delete panel.assetIds;
  }

  if (target.materialType === 'prop') {
    const figures = panel.figures ?? [];
    const matchesProp = (figure: (typeof figures)[number]) => isPropPlacement(figure)
      && ((materialId ? figure.refId === materialId : false) || figure.name === materialKey);
    if (linked && !figures.some(matchesProp)) {
      figures.push({
        name: materialKey,
        kind: 'prop',
        refId: materialId,
        bbox: fallbackBox(panel, 'figure', figures.length),
        anchor: 'center',
      });
    } else if (!linked) {
      for (let index = figures.length - 1; index >= 0; index -= 1) {
        if (matchesProp(figures[index])) figures.splice(index, 1);
      }
    }
    figures.length ? panel.figures = figures : delete panel.figures;
  }
  return true;
}
