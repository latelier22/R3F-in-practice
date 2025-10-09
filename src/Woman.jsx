import React, { useRef, useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

export function Woman({ wid = "W0", mapData, speed = 0.002 }) {
  const group = useRef();
  const { scene, animations } = useGLTF("/models/woman.glb");

  // ✅ Clone indépendant
  const cloned = useMemo(() => clone(scene), [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(cloned), [cloned]);
  const clock = useMemo(() => new THREE.Clock(), []);
  const randomScale = useMemo(() => 0.09 + Math.random() * 0.03, []); // tailles variées

  // 🎨 Variation couleur
  useEffect(() => {
    cloned.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mat = obj.material;
        if (/hair/i.test(mat.name)) {
          mat.color = new THREE.Color(`hsl(${20 + Math.random() * 40}, 40%, ${25 + Math.random() * 40}%)`);
        } else if (/cloth|shirt|pant|dress/i.test(mat.name)) {
          mat.color = new THREE.Color(`hsl(${Math.random() * 360}, 50%, 45%)`);
        }
      }
    });
  }, [cloned]);

  const [nodeIds, setNodeIds] = useState([]);
  const [points3D, setPoints3D] = useState([]);
  const [seg, setSeg] = useState(0);

  const dijkstra = (startId, endId) => {
    const nodes = mapData.nodes;
    const links = mapData.links;
    const dist = {}, prev = {};
    const Q = new Set(nodes.map(n => n.id));
    nodes.forEach(n => (dist[n.id] = Infinity));
    dist[startId] = 0;

    while (Q.size) {
      let u = [...Q].reduce((a, b) => (dist[a] < dist[b] ? a : b));
      Q.delete(u);
      if (u === endId) break;
      links
        .filter(l => l.from === u || l.to === u)
        .forEach(l => {
          const v = l.from === u ? l.to : l.from;
          if (!Q.has(v)) return;
          const alt = dist[u] + l.dist;
          if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
        });
    }

    const ids = [];
    for (let u = endId; u; u = prev[u]) ids.unshift(u);
    return ids;
  };

  const pickRoute = () => {
    const nodes = mapData.nodes;
    if (!nodes?.length) return { ids: [], pts: [] };
    const start = nodes[Math.floor(Math.random() * nodes.length)].id;
    let ids = [];
    for (let tries = 0; tries < 30; tries++) {
      const end = nodes[Math.floor(Math.random() * nodes.length)].id;
      if (end === start) continue;
      ids = dijkstra(start, end);
      if (ids.length >= 2) break;
    }
    const pts = ids.map(id => {
      const n = nodes.find(nn => nn.id === id);
      return { x: n.x, z: n.z }; // 🔁 cohérent avec Car
    });
    return { ids, pts };
  };

  useEffect(() => {
    if (!animations?.length) return;
    const action = mixer.clipAction(animations[0]);
    action.setLoop(THREE.LoopRepeat, Infinity).play();

    const hips = cloned.getObjectByName("mixamorigHips");
    const basePos = hips ? hips.position.clone() : new THREE.Vector3();

    let rafId;
    const tick = () => {
      const delta = clock.getDelta();
      mixer.update(delta);
      if (hips) hips.position.copy(basePos);

      if (group.current && points3D.length > 1 && points3D[seg + 1]) {
        const pos = group.current.position;
        const p1 = new THREE.Vector3(points3D[seg].x, 0, points3D[seg].z);
        const p2 = new THREE.Vector3(points3D[seg + 1].x, 0, points3D[seg + 1].z);
        const dir = p2.clone().sub(p1).normalize();

        pos.addScaledVector(dir, speed);

        const target = Math.atan2(dir.x, dir.z);
        let dAng = target - group.current.rotation.y;
        dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
        group.current.rotation.y += dAng * 0.12;

        if (pos.distanceTo(p2) < 0.015) { // ✅ seuil affiné
          if (seg < points3D.length - 2) setSeg(s => s + 1);
          else {
            const { ids, pts } = pickRoute();
            setNodeIds(ids);
            setPoints3D(pts);
            setSeg(0);
            pos.set(pts[0].x, 0, pts[0].z);
            // window.map2D_drawByNodeIds && window.map2D_drawByNodeIds(wid, ids, "#c03");
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafId); action.stop(); };
  }, [animations, mixer, cloned, clock, points3D, seg, speed, wid]);

  useEffect(() => {
    if (!mapData) return;
    const { ids, pts } = pickRoute();
    if (ids.length >= 2) {
      setNodeIds(ids);
      setPoints3D(pts);
      setSeg(0);
      if (group.current) group.current.position.set(pts[0].x, 0, pts[0].z);
    //   window.map2D_drawByNodeIds && window.map2D_drawByNodeIds(wid, ids, "#c03");
    }
  }, [mapData, wid]);

  return (
    <group ref={group}>
      <primitive object={cloned} scale={randomScale} />
    </group>
  );
}

useGLTF.preload("/models/woman.glb");
