import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import base from './browserWorkspace.vite.mjs';

// Read only the installed pose assets. API calls in the browser are mocked by the fixture.
const root = new URL('../.human_pose/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const raw = await readFile(new URL('catalog.json', root)), catalog = JSON.parse(raw), digest = hash(raw);
  const id = 'pose-mh-standing01', rig = await readFile(new URL('models/human_base.rig.json', root));
  const pose = await readFile(new URL(`poses/${id}/pose.json`, root));
  const record = (kind, poseId, bytes) => ({ kind, pose_id: poseId, catalog_sha256: digest, usage: 'pose_asset', mime_type: 'application/json', sha256: hash(bytes), byte_size: bytes.length, data: bytes.toString('base64') });
  const previews = {};
  for (const entry of catalog.poses.filter(p => p.production_status === 'ready' && p.review.user_confirmed)) previews[entry.id] = (await readFile(new URL(`poses/${entry.id}/preview.png`, root))).toString('base64');
  return { catalog: { catalog, catalog_sha256: digest, previews }, scene: { pose_id: id, catalog_sha256: digest, representation: 'skeleton', base_sha256: JSON.parse(rig).base_glb_sha256, rig: record('rig', null, rig), pose: record('pose', id, pose) } };
}
export default defineConfig({ ...base, cacheDir: 'node_modules/.vite-pose-fixture', define: { 'import.meta.env.PUBLIC_NYAMURU_LAN': JSON.stringify('0') },
  plugins: [...base.plugins, { name: 'pose-readonly-fixture', configureServer(server) {
    server.middlewares.use('/pose-fixture', async (_req, res) => {
      try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await fixture())); }
      catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
    });
  } }],
});
