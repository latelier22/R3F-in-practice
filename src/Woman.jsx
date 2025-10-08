import React, { useRef, useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";

export function Woman(props) {
  const group = useRef();
  const { scene, animations } = useGLTF("/models/woman.glb");

  // ✅ Clone du modèle pour instance indépendante
  const cloned = useMemo(() => clone(scene), [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(cloned), [cloned]);
  const clock = useMemo(() => new THREE.Clock(), []);

  // ✅ direction aléatoire pour test
  const direction = useMemo(() => {
    const angle = Math.random() * Math.PI * 2;
    return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();
  }, []);

  useEffect(() => {
    if (!animations?.length) return;
    const action = mixer.clipAction(animations[0]);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();

    const hips = cloned.getObjectByName("mixamorigHips");
    const basePos = hips ? hips.position.clone() : new THREE.Vector3();

    const speed = 0.0015; // 🔹 vitesse lente réaliste

    const tick = () => {
      const delta = clock.getDelta();
      mixer.update(delta);

      // 🔹 Bloque le déplacement local du squelette
      if (hips) hips.position.copy(basePos);

      // 🔹 Fait avancer le personnage dans la direction choisie
      if (group.current) {
        group.current.position.addScaledVector(direction, speed);
      }

      requestAnimationFrame(tick);
    };
    tick();

    return () => action.stop();
  }, [animations, mixer, cloned, clock, direction]);

  // ✅ oriente la femme selon sa direction
  useEffect(() => {
    if (group.current) {
      const angle = Math.atan2(direction.x, direction.z);
      group.current.rotation.y = angle;
    }
  }, [direction]);

  return (
    <group ref={group} {...props}>
      <primitive object={cloned} scale={0.1} />
    </group>
  );
}

useGLTF.preload("/models/woman.glb");
