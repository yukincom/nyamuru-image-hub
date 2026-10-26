import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { generationHandoff } from '../src/lib/generationHandoff.ts';
import { qwenGenerationPayload } from '../src/lib/qwenGeneration.ts';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4Z8AAAAASUVORK5CYII=';
test('cloud package is an independently readable ZIP with unchanged PNG bytes, dialogue and character roles',async()=>{
  const plan={profile:'qwen-image-2.1-owner-v1',documentKey:'work',pageNumber:3,panelId:0,overlay:false,ownerKey:'page',label:'ページ全体',scope:'page',width:768,height:1024,
    prompt:'Character 1とCharacter 2。台詞「ゆき  は\n笑う」',literalText:['ゆき  は\n笑う'],characterKeys:['a','b'],candidates:[],compositionImage:image};
  const payload=qwenGenerationPayload(plan,[{label:'人物A',characterKeys:['a'],image},{label:'人物B',characterKeys:['b'],image}]);
  const before=structuredClone({plan,payload}),blob=generationHandoff(plan,payload,'Codex');
  const parsed=spawnSync('python3',['-c',`import io,json,sys,zipfile,base64
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))`],{input:Buffer.from(await blob.arrayBuffer()),encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);
  const entries=JSON.parse(parsed.stdout),read=name=>Buffer.from(entries[name],'base64').toString('utf8');
  assert.deepEqual(Object.keys(entries),['image-1.png','image-2.png','image-3.png','instructions.md','target.json']);
  for(const name of ['image-1.png','image-2.png','image-3.png'])assert.equal(entries[name],image.split(',')[1]);
  assert.match(read('instructions.md'),/ゆき  は\n笑う/);assert.match(read('instructions.md'),/image-2.png: 人物A \/ Character 1/);assert.match(read('instructions.md'),/image-3.png: 人物B \/ Character 2/);
  const target=JSON.parse(read('target.json'));assert.equal(target.page_number,3);assert.equal(target.panel_id,0);assert.equal(target.owner_key,'page');assert.deepEqual(target.literal_text,['ゆき  は\n笑う']);assert.equal(target.paint_image,undefined);
  assert.deepEqual({plan,payload},before);
});
test('handoff rejects non-PNG data before creating an archive',()=>{
  const plan={characterKeys:[]};
  assert.throws(()=>generationHandoff(plan,{references:[{image:'https://example.test/image.png',label:'other',character_keys:[]}]},'Codex'),/PNG/);
});
