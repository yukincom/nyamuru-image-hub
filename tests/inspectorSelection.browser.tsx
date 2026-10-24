// Disposable manuscript and mocked local services, on a dedicated origin only.
import { render } from 'preact';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { STORAGE_KEY, toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga';
import type { Panel } from '../src/types';
import '../src/styles/global.css';
if (location.port !== '4326') throw Error('Dedicated inspector test origin required');

const doc = createEmptyWorkspaceDocument();
doc.manga.meta.title = '人物欄への移動';
doc.manga.meta.episode_id = 'inspector-selection-qa';
doc.manga.finish_settings = { width_mm: 120, height_mm: 160, dpi: 100, bleed_mm: 0 };
const names = ['アキ', 'ユキ', 'ミナ', 'レン'];
doc.manga.characters = names.map((name, index) => ({ name, localId: `person-${index}`, role: '確認用人物', scope: 'episode' }));
const makePanel = (id: number, y: number, person: number): Panel => ({
  id, shape: { type: 'rect', x: 8, y, w: 104, h: 64 }, bg: 1, action: `${names[person]}が窓を指す。`,
  figures: [{ name: names[person], kind: 'person', refId: `person-${person}`, action: '顔は右向き。', size: 'bust-up', bbox: { x: 15, y: y + 9, w: 26, h: 35 } }],
  bubbles: Array.from({ length: 6 }, (_, i) => ({ text: `台詞${i + 1}`, shape: 'normal', bbox: { x: 80, y: y + 6 + i * 8, w: 18, h: 7 } })),
});
doc.manga.pages = [
  { page: 1, canvas: { w: 120, h: 160, unit: 'mm' }, panels: [makePanel(1, 8, 0), makePanel(2, 88, 2)] },
  { page: 2, canvas: { w: 120, h: 160, unit: 'mm' }, panels: [makePanel(1, 8, 3)] },
];
doc.manga.pages[0].panels[0].figures!.push(
  { name: '机', kind: 'prop', bbox: { x: 45, y: 45, w: 24, h: 18 } },
  { name: 'ユキ', kind: 'person', refId: 'person-1', action: 'ユキの元のアクション。', size: 'bust-up', bbox: { x: 47, y: 17, w: 26, h: 35 } },
);
localStorage.setItem(STORAGE_KEY, toStoredMangaYaml(doc));

const requests: Array<{ action_mode: string; current_panel: { panel_id: number; page_number: number }; figures: Array<{ id: string; name: string }> }> = [];
const service = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
const supervisor = { service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1 };
const nativeFetch = window.fetch.bind(window);
let deferResponse = false;
let finishResponse: (() => void) | undefined;
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  if (url.pathname === '/api/health') return Response.json(service);
  if (url.pathname === '/api/new-creation/start') return Response.json({ ...supervisor, lease_token: 'qa-only' });
  if (url.pathname === '/api/panel-actions/prepare') return Response.json(supervisor);
  if (url.pathname === '/api/new-creation/stop') return Response.json({ ...supervisor, llm_released: true, released: true });
  if (url.pathname === '/api/panel-actions/suggest') {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    if (deferResponse) await new Promise<void>(resolve => { finishResponse = resolve; });
    return Response.json({ ...service, action_mode: 'reconcile', actions: request.figures.map((figure: { id: string }) => ({ id: figure.id, action: deferResponse ? '適用しない遅延回答。' : '顔は右向き。窓を指す。' })) });
  }
  throw Error(`Unexpected service request: ${url.pathname}`);
};
render(<App />, document.getElementById('app')!);

const tick = () => new Promise(resolve => setTimeout(resolve, 60));
const wait = async (test: () => boolean, label: string) => { for (let i = 0; i < 150; i++) { if (test()) return; await tick(); } throw Error(`Timed out: ${label}`); };
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el => el.getAttribute('aria-label') === name || el.textContent?.trim() === name)!;
const click = async (name: string) => { const el = button(name); if (!el || el.disabled) throw Error(`Missing button: ${name}`); el.click(); await tick(); };
const guide = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.figure-guide')).find(el => el.title === `${name}（ドラッグで移動）`)!;
const choose = async (name: string) => { await wait(() => !!guide(name), `guide ${name}`); guide(name).click(); await tick(); };
const scroller = () => document.querySelector<HTMLElement>('.inspector-content')!;
const selected = () => document.querySelector<HTMLElement>('.panel-inspector .selectable-card.is-selected')!;
const selectedName = () => selected()?.querySelector<HTMLSelectElement>('select')?.selectedOptions[0]?.textContent;
const aligned = () => {
  const card = selected(), header = document.querySelector<HTMLElement>('.inspector-sticky-head');
  return !!card && !!header && Math.abs(card.getBoundingClientRect().top - header.getBoundingClientRect().bottom) < 3;
};
const stored = () => parseMangaYaml(localStorage.getItem(STORAGE_KEY)!).manga;

const report = document.createElement('pre'); report.id = 'inspector-test-report'; report.style.cssText = 'position:fixed;bottom:0;left:0;z-index:10001;max-height:30vh;overflow:auto;background:white;padding:8px'; document.body.append(report);
const run = document.createElement('button'); run.textContent = '人物欄の検証を実行'; run.style.cssText = 'position:fixed;top:0;left:40%;z-index:10001'; document.body.append(run);
run.onclick = () => {
  run.disabled = true;
  const checks: string[] = [], check = (ok: boolean, label: string) => { if (!ok) throw Error(label); checks.push(label); };
  void (async () => {
    await click('ネーム');
    if (window.matchMedia('(max-width: 800px)').matches) {
      await wait(() => !!guide('アキ'), 'narrow figure');
      const target = guide('アキ'), box = target.getBoundingClientRect();
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
      await tick();
      check(!!document.querySelector('.mobile-pane-editor'), '狭い画面でも押下中は原稿を隠さず、あたりを移動できる');
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true }));
      await choose('アキ'); await wait(aligned, 'narrow inspector');
      check(!!document.querySelector('.mobile-pane-panel') && selectedName() === 'アキ' && scroller().clientHeight > 0, 'タップ完了後はコマ設定へ切り替えて人物欄を表示');
      await click('ネーム編集'); await choose('レン'); await wait(aligned, 'narrow facing page');
      check(!!document.querySelector('.mobile-pane-panel') && selectedName() === 'レン', '狭い画面の見開き側でも人物欄を表示');
      report.textContent = `人物欄 PASS（${checks.length}項目・狭い画面）\n${checks.join('\n')}`;
      return;
    }
    await choose('ユキ'); await wait(aligned, 'second person aligned');
    check(selectedName() === 'ユキ', '小道具が間にあっても選んだ人物欄へ移動');
    check(scroller().scrollTop > 0 && document.querySelector('.inspector-pane')!.scrollTop === 0, '内側のコマ情報だけをスクロール');
    const canvasScroll = document.querySelector<HTMLElement>('.canvas-spread-scroll')!;
    const canvasPosition = [canvasScroll.scrollLeft, canvasScroll.scrollTop];
    scroller().scrollTo({ top: 0, behavior: 'instant' });
    await choose('ユキ'); await wait(aligned, 'repeated choice');
    check(canvasPosition[0] === canvasScroll.scrollLeft && canvasPosition[1] === canvasScroll.scrollTop, '同じ人物の再選択でも欄へ移動し、原稿のスクロール位置を保持');
    await click('コマ情報を閉じる');
    const pressed = guide('アキ'), box = pressed.getBoundingClientRect();
    pressed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
    await tick();
    check(!!button('コマ情報を開く'), 'ドラッグ開始時は欄を開かず、原稿の表示倍率を保つ');
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 42, pointerType: 'mouse', isPrimary: true }));
    await choose('アキ'); await wait(aligned, 'expanded inspector');
    check(button('コマ情報を閉じる')?.getAttribute('aria-expanded') === 'true' && selectedName() === 'アキ', '閉じたコマ情報も人物選択で開く');
    await choose('ミナ'); await wait(aligned, 'other panel');
    check(selectedName() === 'ミナ' && document.querySelector('.inspector-panel-label')?.textContent === 'コマ 02', '別コマの同じ人物番号を取り違えない');
    await choose('レン'); await wait(aligned, 'facing page');
    check(selectedName() === 'レン' && document.querySelector('.inspector-panel-label')?.textContent === 'コマ 01', '見開きの反対ページも該当人物欄を表示');

    await choose('ミナ'); await wait(aligned, 'return to panel 2');
    const injection = button('コマ 02の人物へ注入');
    check(!!injection?.closest('.panel-action-section'), 'コマ番号付き注入ボタンをト書きの直下に表示');
    const before = structuredClone(stored());
    await click('コマ 02の人物へ注入');
    await wait(() => stored().pages[0].panels[1].figures![0].action?.includes('窓を指す。') === true, 'action saved');
    check(requests.length === 1 && requests[0].action_mode === 'reconcile' && requests[0].current_panel.panel_id === 2 && requests[0].current_panel.page_number === 1 && requests[0].figures.length === 1 && requests[0].figures[0].name === 'ミナ', '表示中のコマの人物だけを注入対象に送る');
    const after = stored();
    check(JSON.stringify(after.pages[0].panels[0]) === JSON.stringify(before.pages[0].panels[0]) && JSON.stringify(after.pages[1]) === JSON.stringify(before.pages[1]), 'ほかのコマ・ページを変更しない');
    check(after.pages[0].panels[1].figures![0].action === '顔は右向き。窓を指す。', '対象コマに完成文を反映し、元の文章を重複して追記しない');
    const stable = JSON.stringify(after.pages);
    deferResponse = true;
    await click('コマ 02の人物へ注入'); await wait(() => !!finishResponse, 'delayed request');
    await choose('アキ'); finishResponse!(); await tick(); await tick();
    check(!document.querySelector('.panel-generation-status'), 'コマ移動後に前の処理表示を残さない');
    await new Promise(resolve => setTimeout(resolve, 450));
    check(JSON.stringify(stored().pages) === stable, '処理中に別コマへ移動した場合も回答を誤適用しない');
    deferResponse = false;

    const row = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el => el.textContent?.includes('あたり · ユキ'))!;
    await wait(() => !!row() && !row().disabled, 'layer row'); row().click();
    await wait(() => selectedName() === 'ユキ' && aligned(), 'layer owner selection');
    check(selectedName() === 'ユキ', 'レイヤー一覧の人物あたりからも人物欄へ移動');
    await click('コマ情報を閉じる');
    const otherRow = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el => el.textContent?.includes('あたり · アキ'))!;
    await wait(() => !!otherRow() && !otherRow().disabled, 'active paint row'); otherRow().click();
    await wait(() => selectedName() === 'アキ' && aligned(), 'active paint owner selection');
    check(button('コマ情報を閉じる')?.getAttribute('aria-expanded') === 'true', 'ペイント中の人物切替でもコマ情報を開いて追従');
    await click('背景あたりの3Dモデルを配置・調整');
    await wait(() => !!document.querySelector('[data-background3d-owner="figure-2"]'), '3D figure');
    document.querySelector<HTMLButtonElement>('[data-background3d-owner="figure-2"]')!.click();
    await wait(() => selectedName() === 'ユキ' && aligned(), '3D figure inspector');
    check(!!document.querySelector('.background3d-controls'), '3D編集中の人物選択も、3D編集を保ったまま人物欄へ移動');
    await click('保存せずに閉じる');
    report.textContent = `人物欄 PASS（${checks.length}項目）\n${checks.join('\n')}`;
  })().catch(error => { report.textContent = `人物欄 FAIL: ${String(error)}\n${checks.join('\n')}`; }).finally(() => { run.disabled = false; });
};
