import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export function useCharacterLogic({ model, animations, group, mapData, speed = 0.002, scale = 0.1 }) {
  const cloned = useMemo(() => clone(model), [model]);
  const mixer = useMemo(() => new THREE.AnimationMixer(cloned), [cloned]);
  const clock = useMemo(() => new THREE.Clock(), []);

  const [points, setPoints] = useState([]);
  const [seg, setSeg] = useState(0);

  // 🔢 Dijkstra
  const dijkstra = useCallback((a, b) => {
    const N = mapData.nodes, L = mapData.links;
    const dist = {}, prev = {};
    const Q = new Set(N.map(n => n.id));
    N.forEach(n => (dist[n.id] = Infinity));
    dist[a] = 0;
    while (Q.size) {
      let u = [...Q].reduce((x, y) => (dist[x] < dist[y] ? x : y));
      Q.delete(u);
      if (u === b) break;
      L.filter(l => l.from === u || l.to === u).forEach(l => {
        const v = l.from === u ? l.to : l.from;
        if (!Q.has(v)) return;
        const alt = dist[u] + l.dist;
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      });
    }
    const ids = [];
    for (let u = b; u; u = prev[u]) ids.unshift(u);
    return ids;
  }, [mapData]);

  // 🧭 Itinéraire aléatoire
  const pickRoute = useCallback(() => {
    const n = mapData.nodes;
    if (!n?.length) return [];
    const s = n[Math.floor(Math.random() * n.length)].id;
    let ids = [];
    for (let t = 0; t < 30; t++) {
      const e = n[Math.floor(Math.random() * n.length)].id;
      if (e === s) continue;
      ids = dijkstra(s, e);
      if (ids.length >= 2) break;
    }
    return ids.map(id => {
      const node = n.find(nn => nn.id === id);
      return { x: node.x, z: node.z };
    });
  }, [mapData, dijkstra]);

  // 🕺 Animation + mouvement
  useEffect(() => {
    if (!animations?.length) return;
    const act = mixer.clipAction(animations[0]);
    act.setLoop(THREE.LoopRepeat, Infinity).play();

    const hips = cloned.getObjectByName("mixamorigHips");
    const base = hips ? hips.position.clone() : new THREE.Vector3();

    let raf;
    const tick = () => {
      const dt = clock.getDelta();
      mixer.update(dt);
      if (hips) hips.position.copy(base);

      if (group.current && points.length > 1 && points[seg + 1]) {
        const pos = group.current.position;
        const p1 = new THREE.Vector3(points[seg].x, 0, points[seg].z);
        const p2 = new THREE.Vector3(points[seg + 1].x, 0, points[seg + 1].z);
        const segDir = p2.clone().sub(p1).normalize();

        const avoid = group.current.userData?.avoid || new THREE.Vector3();
        const f = group.current.userData?.speedFactor || 1;
        const avoidTimer = group.current.userData?.avoidTimer || 0;

        // direction combinée
        const finalDir = segDir.clone().add(avoid).normalize();
        pos.addScaledVector(finalDir, speed * f);

        // recentrage rapide sur le segment
        if (avoidTimer <= 0.01) {
          const proj = projectOnSegment(pos, p1, p2);
          pos.lerp(proj, 0.3);
        }

        // rotation
        const target = Math.atan2(finalDir.x, finalDir.z);
        group.current.rotation.y += (target - group.current.rotation.y) * 0.12;

        if (pos.distanceTo(p2) < 0.015) {
          if (seg < points.length - 2) setSeg(s => s + 1);
          else {
            const pts = pickRoute();
            setPoints(pts);
            setSeg(0);
            pos.set(pts[0].x, 0, pts[0].z);
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animations, mixer, cloned, clock, points, seg, speed, group, pickRoute]);

  // 🚶 Init route
  useEffect(() => {
    if (!mapData) return;
    const pts = pickRoute();
    if (pts.length >= 2) {
      setPoints(pts);
      setSeg(0);
      if (group.current) group.current.position.set(pts[0].x, 0, pts[0].z);
    }
  }, [mapData, group, pickRoute]);

  return { cloned, scale };
}

// projection d’un point sur un segment
function projectOnSegment(p, a, b) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(
    p.clone().sub(a).dot(ab) / ab.lengthSq(),
    0,
    1
  );
  return a.clone().add(ab.multiplyScalar(t));
}
