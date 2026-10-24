/** LAN builds keep documents on the editing computer and call the same-origin AI gateway. */
export const isLanClient = import.meta.env?.PUBLIC_NYAMURU_LAN === '1';

export function serviceUrl(kind: 'bridge' | 'supervisor', path: string, lan = isLanClient): string | null {
  if (!/^\/api\/[a-z0-9/-]+$/.test(path)) throw new Error('連携先のpathが正しくありません');
  return lan ? `/__nyamuru/${kind}${path}` : null;
}
