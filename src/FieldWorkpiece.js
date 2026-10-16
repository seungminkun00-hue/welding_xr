import * as THREE from 'three';

// Older bundled GLBs merge the square end plate and bolt recesses into the
// fixture materials. Remove only their triangles, in assembly coordinates.
// The open main pipe, collars and rear fittings remain intact.
export function removeFieldEndPlate(assembly) {
  assembly.updateWorldMatrix(true, true);
  const inverse = assembly.matrixWorld.clone().invert();
  const transform = new THREE.Matrix4(), point = new THREE.Vector3();
  let removed = 0;
  assembly.traverse(mesh => {
    if (!mesh.isMesh) return;
    const source = mesh.geometry, positions = source.attributes.position;
    if (!positions) return;
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    const count = source.index?.count ?? positions.count;
    const kept = [], groups = [];
    let cut = 0;
    for (let i = 0; i < count; i += 3) {
      const indices = [0, 1, 2].map(j => source.index ? source.index.getX(i + j) : i + j);
      const plate = indices.every(index => {
        point.fromBufferAttribute(positions, index).applyMatrix4(transform);
        return point.z >= 0.679 && point.z <= 0.699 &&
          Math.abs(point.x) <= 0.125 && Math.abs(point.y) <= 0.125;
      });
      if (plate) { cut++; continue; }
      const materialIndex = source.groups.find(g => i >= g.start && i < g.start + g.count)?.materialIndex ?? 0;
      const last = groups[groups.length - 1];
      if (last?.materialIndex === materialIndex) last.count += 3;
      else groups.push({ start: kept.length, count: 3, materialIndex });
      kept.push(...indices);
    }
    if (!cut) return;
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const original = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
      const stride = attribute.isInterleavedBufferAttribute ? attribute.data.stride : attribute.itemSize;
      const offset = attribute.isInterleavedBufferAttribute ? attribute.offset : 0;
      const array = new original.constructor(kept.length * attribute.itemSize);
      kept.forEach((index, i) => {
        for (let j = 0; j < attribute.itemSize; j++)
          array[i * attribute.itemSize + j] = original[index * stride + offset + j];
      });
      geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
    }
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    mesh.geometry = geometry;
    removed += cut;
  });
  assembly.userData.removedEndPlateTriangles = removed;
  return removed;
}
