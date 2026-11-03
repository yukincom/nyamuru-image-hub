import type { PaintLayerDestination, PaintLayerDropTarget, PaintScene } from './paintDocument.ts';
import { paintFolderChain } from './paintLock.ts';

type PaletteLocation = Pick<PaintLayerDestination, 'panelIndex' | 'overlay'>;
type Placement = 'above' | 'inside' | 'below';

interface DropInput {
  source: { kind: 'layer' | 'folder'; key: string; id: string };
  sourceLocation?: PaletteLocation;
  row: Readonly<DOMStringMap>;
  rowLocation?: PaletteLocation;
  ratio: number;
  nestedLayer: boolean;
  scene: PaintScene;
}

interface LayerDrop {
  target: PaintLayerDropTarget;
  destination?: PaintLayerDestination;
  placement: Placement;
  outside: boolean;
  indent: number;
}

/** Resolve both the move and its insertion line from the same hovered row. */
export function resolvePaintLayerDrop({
  source, sourceLocation, row, rowLocation, ratio, nestedLayer, scene,
}: DropInput): LayerDrop | undefined {
  const key = row.owner;
  if (!key || (sourceLocation && !rowLocation)) return;
  const sameOwner = key === source.key && (!rowLocation || (
    rowLocation.panelIndex === sourceLocation?.panelIndex && rowLocation.overlay === sourceLocation?.overlay
  ));
  const locked = row.dropLocked === 'true';
  let destination: PaintLayerDestination | undefined = rowLocation && { ...rowLocation, key };
  let depth = Number(row.layerDepth ?? 0);
  let target: PaintLayerDropTarget;
  let placement: Placement;

  switch (row.layerDrop) {
    case 'layer': {
      const id = row.layer;
      if (locked || !id || (sameOwner && source.kind === 'layer' && id === source.id)) return;
      const after = ratio > 0.5;
      target = { kind: 'layer', id, after };
      placement = after ? 'below' : 'above';
      break;
    }
    case 'folder': {
      const id = row.folder;
      if (!id || (sameOwner && source.kind === 'folder' && id === source.id)) return;
      placement = ratio < 0.25 ? 'above' : ratio > 0.75 ? 'below' : 'inside';
      if (placement === 'inside') {
        if (locked) return;
        depth++;
      }
      target = { kind: 'folder', id, placement };
      break;
    }
    case 'panel': {
      if (!destination) return;
      const beforePanel = ratio < 0.35;
      if (!beforePanel && locked) return;
      destination = beforePanel
        ? { ...destination, overlay: true, key: 'page', stack: { beforePanel: row.panelAnchor! } }
        : { ...destination, key: 'panel' };
      target = { kind: 'root', edge: 'top' };
      placement = beforePanel ? 'above' : 'inside';
      depth = beforePanel ? 0 : 1;
      break;
    }
    case 'owner': {
      const belowOwner = ratio > 0.75;
      if (belowOwner) {
        if (!destination) return;
        destination = { ...destination, key: destination.overlay ? 'page' : 'panel', stack: { below: key } };
      } else {
        if (locked) return;
        depth++;
      }
      target = { kind: 'root', edge: 'top', aboveNative: !belowOwner && key.startsWith('bubble-') };
      placement = belowOwner ? 'below' : 'inside';
      break;
    }
    case 'native': {
      if (locked) return;
      const above = ratio < 0.5;
      if (above && row.nativeBelow && destination) {
        destination = { ...destination, key: destination.overlay ? 'page' : 'panel', stack: { below: row.nativeBelow } };
        target = { kind: 'root', edge: 'top' };
      } else {
        target = { kind: 'root', edge: above ? 'bottom' : 'top', aboveNative: above };
      }
      placement = above ? 'above' : 'below';
      break;
    }
    default:
      if (locked) return;
      target = { kind: 'root', edge: row.edge === 'bottom' ? 'bottom' : 'top' };
      placement = 'inside';
  }

  if (sameOwner && source.kind === 'folder' && (target.kind === 'folder' || target.kind === 'layer')) {
    const paint = scene.owners.find(owner => owner.key === key)?.paint;
    const parent = target.kind === 'folder' ? target.id : paint?.layers.find(layer => layer.id === target.id)?.folderId;
    if (paint && paintFolderChain(paint, parent).some(folder => folder.id === source.id)) return;
  }

  const outside = depth === 0
    || (placement !== 'inside' && ['folder', 'owner', 'panel'].includes(row.layerDrop ?? ''))
    || (row.layerDrop === 'layer' && !nestedLayer && /^(panel|page)(:|$)/.test(key));
  return { target, destination, placement, outside, indent: outside ? 0 : Math.max(48, depth * 16) };
}
