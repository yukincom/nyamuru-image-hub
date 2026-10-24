import { Matrix3, Vector3 } from 'three';
import type { Object3D, Raycaster } from 'three';

export interface BackgroundSurfaceHit { point: Vector3; normal: Vector3; surfaceMesh: number }

/** Pick the first visible surface. A caller must reject an unsuitable hit, never pick through it. */
export function pickBackgroundSurface(meshes: Object3D[], ray: Raycaster): BackgroundSurfaceHit | undefined {
  const visible = meshes.filter(mesh => {
    for (let item: Object3D | null = mesh; item; item = item.parent) if (!item.visible) return false;
    mesh.updateWorldMatrix(true, false); return true;
  });
  const hit = ray.intersectObjects(visible, false)[0];
  if (!hit?.face) return;
  const normal = hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  // Double-sided and reflected source meshes can have opposite authored winding.
  if (normal.dot(ray.ray.direction) > 0) normal.negate();
  return { point: hit.point.clone(), normal, surfaceMesh: meshes.indexOf(hit.object) };
}
