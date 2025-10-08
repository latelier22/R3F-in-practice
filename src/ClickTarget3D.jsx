import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

export function ClickTarget3D({ nodes3D, onSelectNode }) {
  const { camera, scene, gl } = useThree();
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // plan horizontal y=0

  useEffect(() => {
    function handleClick(e) {
      // Clic droit OU shift + clic gauche
      if (e.button !== 2 && !e.shiftKey) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const point = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, point);

      if (!nodes3D?.length) return;

      // Trouve le nœud le plus proche du point cliqué
      let nearest = null;
      let minDist = Infinity;
      for (const n of nodes3D) {
        const dx = n.x - point.x;
        const dz = n.z - point.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < minDist) {
          minDist = d2;
          nearest = n;
        }
      }

      if (nearest) {
        console.log("🎯 Nœud le plus proche :", nearest.id);
        onSelectNode(nearest.id);
      }
    }

    gl.domElement.addEventListener("contextmenu", (e) => e.preventDefault()); // évite menu
    gl.domElement.addEventListener("mousedown", handleClick);
    return () => gl.domElement.removeEventListener("mousedown", handleClick);
  }, [gl, camera, nodes3D, onSelectNode]);

  return null;
}
