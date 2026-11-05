import {readFileSync} from 'node:fs';

function componentSources(paths) {
  return paths.map(path => readFileSync(new URL('../src/components/' + path, import.meta.url), 'utf8')).join('\n');
}

export function mangaCanvasSource() {
  return componentSources([
    'canvas/CanvasElements.tsx', 'canvas/useCanvasSurface.ts', 'canvas/useCanvasViewport.ts',
    'canvas/panelGestures.ts', 'canvas/useElementGestures.tsx', 'canvas/useCanvasSelection.tsx',
    'canvas/usePanelArtwork.tsx', 'canvas/usePageOverlayArtwork.tsx', 'MangaCanvas.tsx',
  ]);
}
