import { Shape, ExtrudeGeometry, MeshStandardMaterial, Mesh } from "three";
import { useMemo } from "react";
import * as THREE from "three";

export function Extrusions({ data }) {
  const meshes = useMemo(() => {
    return data.map((obj, i) => {
      const shape2D = new Shape(obj.shape.map(p => new THREE.Vector2(p.x, p.z)));
      const depth = obj.type === "bat" ? 10 : 1;
      const color = obj.type === "bat" ? 0x1e90ff : 0x228b22;

      const geometry = new ExtrudeGeometry(shape2D, { depth, bevelEnabled: false });
      const material = new MeshStandardMaterial({ color, opacity: 0.85, transparent: true });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0; // sol
      return mesh;
    });
  }, [data]);

  return <group>{meshes.map((m, i) => <primitive key={i} object={m} />)}</group>;
}
