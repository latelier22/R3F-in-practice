import React, { forwardRef, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useCharacterLogic } from "./useCharacterLogic";

export const Woman = forwardRef(({ mapData, speed }, ref) => {
  const local = useRef();
  const group = ref || local;
  const { scene, animations } = useGLTF("/models/woman.glb");
  const { cloned, scale } = useCharacterLogic({ model: scene, animations, group, mapData, speed, scale: 0.1 });

  return (
    <group ref={group}>
      <primitive object={cloned} scale={scale} />
    </group>
  );
});
useGLTF.preload("/models/woman.glb");
