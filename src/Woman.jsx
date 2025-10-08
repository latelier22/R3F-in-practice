// src/Woman.jsx
import React, { useRef, useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

export function Woman({ id = "W", mapData, startNode, endNode, speed = 0.02 }) {
  const group = useRef();
  const { scene, animations } = useGLTF("/models/woman.glb");

  // Clone indépendant
  const cloned = useMemo(() => clone(scene), [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(cloned), [cloned]);
  const clock = useMemo(() => new THREE.Clock(), []);

  const [path, setPath] = useState([]); // points {x,z}
  const [segmentIndex, setSegmentIndex] = useState(0);

  // --- Dijkstra sur mapData ---
  function dijkstra(start, end) {
    if (!mapData) return [];
    const { nodes, links } = mapData;
    const dist = {}, prev = {}, Q = new Set(nodes.map(n => n.id));
    nodes.forEach(n => dist[n.id] = Infinity);
    dist[start] = 0;

    while (Q.size) {
      const u = [...Q].reduce((a, b) => dist[a] < dist[b] ? a : b);
      Q.delete(u);
      if (u === end) break;
      links
        .filter(l => l.from === u || l.to === u)
        .forEach(l => {
          const v = l.from === u ? l.to : l.from;
          if (!Q.has(v)) return;
          const alt = dist[u] + l.dist;
          if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
        });
    }

    const pathIds = [];
    for (let u = end; u; u = prev[u]) pathIds.unshift(u);
    if (pathIds.length < 2) return [];

    const pts = pathIds.map(id => {
      const n = mapData.nodes.find(nn => nn.id === id);
      return { x: n.x, z: -n.z };
    });

    // trace sur carte 2D
    if (window.map2D_drawLocalPath) {
      window.map2D_drawLocalPath(id, pts);
    }
    return pts;
  }

  // --- Animation et mouvement ---
  useEffect(() => {
    if (!animations?.length) return;
    const action = mixer.clipAction(animations[0]);
    action.setLoop(THREE.LoopRepeat, Infinity).play();

    const hips = cloned.getObjectByName("mixamorigHips");
    const basePos = hips ? hips.position.clone() : new THREE.Vector3();

    const tick = () => {
      const delta = clock.getDelta();
      mixer.update(delta);
      if (hips) hips.position.copy(basePos);

      if (group.current && path.length > 1) {
        const pos = group.current.position;
        const p1 = new THREE.Vector3(path[segmentIndex].x, 0, path[segmentIndex].z);
        const p2 = new THREE.Vector3(path[segmentIndex + 1].x, 0, path[segmentIndex + 1].z);
        const dir = p2.clone().sub(p1).normalize();
        pos.addScaledVector(dir, speed);

        // rotation douce vers direction
        const angle = Math.atan2(dir.x, dir.z);
        group.current.rotation.y = THREE.MathUtils.lerpAngle(group.current.rotation.y, angle, 0.1);

        // passage segment suivant
        if (pos.distanceTo(p2) < 0.15 && segmentIndex < path.length - 2) {
          setSegmentIndex(i => i + 1);
        }
      }

      requestAnimationFrame(tick);
    };

    tick();
    return () => action.stop();
  }, [animations, mixer, cloned, clock, path, segmentIndex, speed]);

  // --- Génération du chemin unique pour cette Woman ---
  useEffect(() => {
    if (!mapData || !startNode || !endNode) return;
    const newPath = dijkstra(startNode.id, endNode.id);
    if (newPath.length >= 2) {
      setPath(newPath);
      setSegmentIndex(0);
      // positionne la femme au départ
      if (group.current) {
        group.current.position.set(newPath[0].x, 0, newPath[0].z);
      }
    }
  }, [mapData, startNode, endNode]);

  return (
    <group ref={group}>
      <primitive object={cloned} scale={0.1} />
    </group>
  );
}

useGLTF.preload("/models/woman.glb");
