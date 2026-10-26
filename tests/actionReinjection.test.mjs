import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { applyReconciledPanelActions, buildPanelActionSuggestionRequest } from '../src/lib/panelActions.ts';
import { newPage, parseMangaYaml } from '../src/lib/manga.ts';
import { withPanelActionServices } from '../src/lib/localBridgeLifecycle.ts';

const source = readFileSync(new URL('../src/components/PanelInspector.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PanelInspector.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'requestPanelGeneration') handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

test('再注入の実handlerは連打・処理中編集を防ぎ、完成文を反映して背景・吹き出しを保持する', async () => {
  for (const stale of [false, true, 'navigate', 'startup-edit', 'startup-navigate']) {
    const manga = parseMangaYaml(readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8')).manga;
    manga.pages = [newPage(1)];
    const untouched = manga.pages[0].panels[0];
    untouched.action = '隣のコマは変更しない。';
    untouched.figures = [{ name: 'ハル', action: '隣のコマのアクション。' }];
    const panel = structuredClone(untouched);
    panel.id = 2;
    manga.pages[0].panels.push(panel);
    const originalNeighbor = JSON.stringify(untouched);
    panel.action = 'ハルは窓を指す。';
    panel.figures = [{ name: 'ハル', action: '顔は右向き。' }];
    const pending = [];
    const changes = [];
    const statuses = [];
    const startup = [];
    const requests = [];
    const latestPanel = { current: panel };
    const generationRequest = { current: 0 };
    const generationInFlight = { current: false };
    const run = runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      panel, manga, pageIndex: 0, panelIndex: 1, hasPersonFigures: true,
      generationRequest, generationInFlight, latestPanel, latestOnChange: { current: value => changes.push(value) },
      setGenerationStatus: value => statuses.push(value), structuredClone, buildPanelActionSuggestionRequest, applyReconciledPanelActions,
      withPanelActionServices: (task, options) => withPanelActionServices(task, options, async (url) => {
        const path = new URL(String(url)).pathname;
        requests.push(path);
        if (path.endsWith('/prepare') && String(stale).startsWith('startup-')) await new Promise((resolve) => startup.push(resolve));
        return Response.json({
          service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1, lease_token: 'handler-test',
          ...(path.endsWith('/stop') ? { released: true, stopped: false, llm_released: true, llm_stopped: true } : {}),
        });
      }),
      suggestPanelFigureActions: request => {
        assert.equal(request.currentPanel.panelAction, panel.action);
        assert.equal(request.currentPanel.panelId, 2);
        assert.equal(request.previousPanel.panelId, 1);
        assert.equal(request.figures[0].currentAction, '顔は右向き。');
        return new Promise(resolve => pending.push(resolve));
      },
    });
    const completion = run();
    await run();
    await new Promise((done) => setImmediate(done));
    if (String(stale).startsWith('startup-')) {
      assert.equal(pending.length, 0);
      assert.equal(startup.length, 1);
      if (stale === 'startup-edit') latestPanel.current = { ...panel, action: '準備中に変更' };
      else generationRequest.current++;
      startup[0]();
      await completion;
      assert.equal(pending.length, 0);
      assert.equal(changes.length, 0);
      assert.equal(requests.at(-1), '/api/new-creation/stop');
      continue;
    }
    assert.equal(pending.length, 1);
    if (stale === true) latestPanel.current = { ...panel, action: '利用者が変更したト書き' };
    if (stale === 'navigate') generationRequest.current++;
    pending[0]({ actions: [{ id: 'figure-0', action: '顔は右向き。窓を指す。' }] });
    await completion;
    assert.equal(requests.at(-1), '/api/new-creation/stop');
    assert.equal(JSON.stringify(untouched), originalNeighbor);
    assert.equal(changes.length, stale ? 0 : 1);
    if (!stale) {
      const expected = structuredClone(panel);
      expected.figures[0].action = '顔は右向き。窓を指す。';
      assert.deepEqual(changes[0], expected);
      assert.equal(generationInFlight.current, false);
    } else if (stale === true) assert.match(statuses.at(-1).message, /処理中にコマが編集/);
  }
});
