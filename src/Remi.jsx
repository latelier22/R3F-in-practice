import React, { useRef, useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export function RemiAnimated({ speed = 0.002, ...props }) {
  const group = useRef();

  // 1️⃣ Charge les deux modèles
  const { scene: remiScene } = useGLTF("/models/Remi.glb");
  const { animations: womanAnims } = useGLTF("/models/woman.glb");

  // 2️⃣ Clone indépendant du modèle
  const remi = useMemo(() => clone(remiScene), [remiScene]);

  // 3️⃣ Mixer pour gérer l’animation
  const mixer = useMemo(() => new THREE.AnimationMixer(remi), [remi]);
  const clock = useMemo(() => new THREE.Clock(), []);

  useEffect(() => {
    if (!womanAnims?.length) return;

    // 4️⃣ Prend la première animation (par ex. “Walk”)
    const clip = womanAnims.find(a => a.name.toLowerCase().includes("walk")) || womanAnims[0];
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();

    // 5️⃣ Boucle d’animation
    const tick = () => {
      const delta = clock.getDelta();
      mixer.update(delta);
      requestAnimationFrame(tick);
    };
    tick();

    return () => action.stop();
  }, [womanAnims, mixer, clock]);

  // 6️⃣ Affichage du modèle
  return (
    <group ref={group} {...props}>
      <primitive object={remi} scale={0.1} />
    </group>
  );
}

useGLTF.preload("/models/Remi.glb");
useGLTF.preload("/models/woman.glb");
