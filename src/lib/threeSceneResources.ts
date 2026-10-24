import { BufferGeometry, LoadingManager, Mesh, Texture } from 'three';
import type { Material, Object3D, Skeleton, SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function embeddedSceneManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (/^(data:|blob:)/.test(url)) return url;
    throw new Error('外部ファイルを参照しています。Blenderから形状を含むGLBで書き出してください');
  });
  return manager;
}

/** LTと人体ガイドは形状だけを使用する。materialのtexture参照は取得しない。 */
export async function loadEmbeddedGlb(buffer: ArrayBuffer) {
  const loader = new GLTFLoader(embeddedSceneManager());
  loader.register(parser => ({ name: 'SceneGeometryOnly', beforeRoot: async () => {
    const strip = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (/texture$/i.test(key)) delete (value as Record<string, unknown>)[key];
        else strip(child);
      }
    };
    for (const material of parser.json.materials ?? []) strip(material);
  } }));
  return loader.parseAsync(buffer, '');
}

export function disposeThreeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>(), skeletons = new Set<Skeleton>();
  root.traverse(object => {
    const mesh = object as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if ((object as SkinnedMesh).isSkinnedMesh) skeletons.add((object as SkinnedMesh).skeleton);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const data = texture.source?.data;
    if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close();
    texture.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
