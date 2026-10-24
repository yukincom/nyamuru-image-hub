/**
 * 右綴じの固定見開き（1+2、3+4…）で、選択ページの相方を返す。
 * 最終ページだけが余る場合と、見開きOFFでは相方を表示しない。
 */
export function spreadPartnerIndex(activePage: number, pageCount: number, enabled: boolean): number | null {
  if (!enabled || pageCount < 2 || activePage < 0 || activePage >= pageCount) return null;
  const pairStart = activePage - (activePage % 2);
  const partner = activePage === pairStart ? pairStart + 1 : pairStart;
  return partner < pageCount ? partner : null;
}

/** 右綴じのページ一覧で、若いページを右側へ置くグリッド位置。 */
export function pagePreviewGridPosition(pageIndex: number): { row: number; column: 1 | 2 } {
  return {
    row: Math.floor(pageIndex / 2) + 1,
    column: pageIndex % 2 === 0 ? 2 : 1,
  };
}
