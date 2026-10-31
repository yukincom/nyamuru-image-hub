import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import base from './browserWorkspace.vite.mjs';

// Read only the installed pose assets. API calls in the browser are mocked by the fixture.
const root = new URL('../.human_pose/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function sceneFixture(id, digest, bodyModel) {
  const rig = await readFile(new URL('models/human_base.rig.json', root)), pose = await readFile(new URL(`poses/${id}/pose.json`, root));
  const record = (kind, poseId, bytes) => ({ kind, pose_id: poseId, catalog_sha256: digest, usage: 'pose_asset', mime_type: 'application/json', sha256: hash(bytes), byte_size: bytes.length, data: bytes.toString('base64') });
  const result = { pose_id: id, catalog_sha256: digest, representation: 'skeleton', base_sha256: JSON.parse(rig).base_glb_sha256, rig: record('rig', null, rig), pose: record('pose', id, pose) };
  if(bodyModel){
    if(bodyModel!=='bodychan-female')throw Error('Unknown body model');
    const base=await readFile(new URL('models/bodychan_female.glb',root)),bodyRig=await readFile(new URL('models/bodychan_female.rig.json',root));
    result.body_model={id:bodyModel,base:{...record('body_base',null,base),mime_type:'model/gltf-binary'},rig:record('body_rig',null,bodyRig)};
  }
  return result;
}
async function fixture() {
  const raw = await readFile(new URL('catalog.json', root)), catalog = JSON.parse(raw), digest = hash(raw);
  const previews = {};
  for (const entry of catalog.poses.filter(p => p.production_status === 'ready' && p.review.user_confirmed)) previews[entry.id] = (await readFile(new URL(`poses/${entry.id}/preview.png`, root))).toString('base64');
  return { catalog: { catalog, catalog_sha256: digest, previews }, scene: await sceneFixture('pose-mh-standing01',digest) };
}
let initialFixture;
export default defineConfig({ ...base, cacheDir: 'node_modules/.vite-pose-fixture', define: { 'import.meta.env.PUBLIC_NYAMURU_LAN': JSON.stringify('0') },
  plugins: [...base.plugins, { name: 'pose-readonly-fixture', configureServer(server) {
    server.middlewares.use('/pose-fixture', async (req, res) => {
      try {
        const initial = await (initialFixture ??= fixture()), params = new URL(req.url,'http://127.0.0.1').searchParams,id=params.get('pose'),bodyModel=params.get('body');
        if(id && !initial.catalog.catalog.poses.some(pose=>pose.id===id))throw Error('Unknown fixture pose');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(id?{scene:await sceneFixture(id,initial.catalog.catalog_sha256,bodyModel)}:initial));
      }
      catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
    });
  } }],
});
