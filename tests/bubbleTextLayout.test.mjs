import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/MangaCanvas.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('MangaCanvas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BubbleText');
const javascript = ts.transpileModule(component.getText(ast).replace(/^export /, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
}).outputText;

test('actual text rectangle is centered in local coordinates at each zoom; top alignment and text are untouched', () => {
  for (const scale of [0.5, 1, 3.05]) {
    const properties = new Map();
    let effect, deps, cleanup, fontListener;
    const el = { style: { setProperty: (k,v) => properties.set(k,v), getPropertyValue: k => properties.get(k) },
      scrollWidth: 40, clientWidth: 40, scrollHeight: 50, clientHeight: 50,
      getBoundingClientRect: () => ({ width: 40 * scale }),
      parentElement: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 100 * scale, height: 100 * scale }) } };
    const context = { useRef: () => ({ current: el }), useLayoutEffect: (fn, values) => { effect = fn; deps = values; },
      getComputedStyle: () => ({ width: '40px' }), bubbleCssFontFamily: font => font,
      document: { createRange: () => ({ selectNodeContents: node => assert.equal(node, el), getBoundingClientRect: () => ({ x: 35 * scale, y: 20 * scale, width: 40 * scale, height: 50 * scale }) }),
        fonts: { addEventListener: (event, fn) => { assert.equal(event, 'loadingdone'); fontListener = fn; }, removeEventListener: (event, fn) => { assert.equal(event, 'loadingdone'); assert.equal(fn, fontListener); } } },
      h: (type, props, ...children) => ({ type, props, children }) };
    const vnode = runInNewContext(`${javascript}\nBubbleText({text:'長い列\\n短い',font:'test',shape:'thought',lengthClass:'',boxW:100,boxH:100,fitEpoch:1})`, context);
    cleanup = effect();
    assert.equal(properties.get('--bubble-center-x'), '-5px');
    assert.equal(properties.get('--bubble-center-y'), '5px');
    assert.equal(vnode.children[0], '長い列\n短い');
    assert.deepEqual(Array.from(deps), ['長い列\n短い', 'test', 'thought', '', 100, 100, 1, undefined, undefined]);
    fontListener();
    assert.equal(properties.get('--bubble-center-x'), '-5px', 'font refit resets offsets, not accumulates');
    cleanup();
  }
});

test('both panel and page overlay text share the centering component; CSS centers the block not each column', () => {
  assert.equal(source.match(/<BubbleText text=\{bubble.text\}/g).length, 2);
  assert.equal(source.match(/shape=\{bubble.shape\} lengthClass/g).length, 2);
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const rule = css.match(/\.bubble-guide \.bubble-text \{[^}]+\}/)[0];
  assert.match(rule, /top: 50%/);
  assert.match(rule, /height: max-content/);
  assert.match(rule, /text-align: start/);
  assert.match(css, /writing-mode: vertical-rl; white-space: pre-wrap/);
  assert.match(css, /--bubble-center-x/);
});

test('an explicit point size is not shrunk even when the text overflows',()=>{
  const properties=new Map();let effect;
  const el={style:{setProperty:(k,v)=>properties.set(k,v),getPropertyValue:k=>properties.get(k)},
    scrollWidth:200,clientWidth:20,scrollHeight:200,clientHeight:20,getBoundingClientRect:()=>({width:20}),
    parentElement:{getBoundingClientRect:()=>({x:0,y:0,width:20,height:20})}};
  const context={useRef:()=>({current:el}),useLayoutEffect:fn=>{effect=fn},getComputedStyle:()=>({width:'20px'}),
    bubbleCssFontFamily:font=>font,textStyleCss:()=>({fontSize:'2cqw'}),h:(type,props,...children)=>({type,props,children}),
    document:{createRange:()=>({selectNodeContents:()=>{},getBoundingClientRect:()=>({x:0,y:0,width:200,height:200})}),fonts:{addEventListener:()=>{},removeEventListener:()=>{}}}};
  runInNewContext(`${javascript}\nBubbleText({text:'長い文字列'.repeat(20),font:'test',lengthClass:'is-very-long',boxW:20,boxH:20,fitEpoch:1,style:{fontSize:12}})`,context);
  effect();assert.equal(properties.get('--bubble-fit'),'1');
});
