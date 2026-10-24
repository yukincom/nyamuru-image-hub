export function panelDisplayLabel(panelId: number): string {
  return `コマ ${String(panelId).padStart(2, '0')}`;
}
