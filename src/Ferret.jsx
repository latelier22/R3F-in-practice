/*
Ferret animé autonome (Three r165+ compatible)
*/
import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export default function Ferret(props) {
  const group = useRef();
  const { scene, animations } = useGLTF("/models/ferret.glb");

  // ✅ Clone indépendant du modèle
  const cloneScene = useMemo(() => clone(scene), [scene]);
  const { actions, names } = useAnimations(animations, group);

  // 🔁 Démarrage de l'animation "Walk"
  useEffect(() => {
    const action = actions["Walk"] || actions[names[0]];
    if (action) {
      action.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat, Infinity).play();
      return () => action.fadeOut(0.3);
    }
  }, [actions, names]);

  // 🔁 Mouvement continu vers l'avant
  useFrame(() => {
    if (group.current) group.current.translateZ(0.02);
  });

  // 🔁 Changement de direction régulier
  useEffect(() => {
    const changeDir = () => {
      if (!group.current) return;
      const x = (Math.random() - 0.5) ;
      const z = (Math.random() - 0.5) ;
      group.current.lookAt(new THREE.Vector3(x, 0, z));
    };
    changeDir();
    const interval = setInterval(changeDir, 3000 + Math.random() * 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <group ref={group} {...props} dispose={null}>
      <primitive object={cloneScene} scale={[-0.012, 0.012, -0.012]} rotation={[0, 0, 0]} />
    </group>
  );
}

useGLTF.preload("/ferret.glb");
