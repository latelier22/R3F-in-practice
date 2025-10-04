import { useBox } from "@react-three/cannon";
import React from "react";

// 🧩 Active le mode debug visuel
const debug = true;

export function ColliderBox({ position, scale, color = "red" }) {
  const [ref] = useBox(() => ({
    args: scale,
    position,
    type: "Static",
  }));

  return (
    <mesh ref={ref} position={position}>
      <boxGeometry args={scale} />
      <meshStandardMaterial
        color={color}
        transparent={true}
        opacity={0.3}     // 👈 semi-transparent
        wireframe={false} // désactive les lignes, surface visible
      />
    </mesh>
  );
}
