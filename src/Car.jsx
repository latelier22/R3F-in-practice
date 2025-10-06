import { useLoader, useFrame } from "@react-three/fiber";
import { useRef, useEffect, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

export function Car({ pathPoints }) {
  const ref = useRef();
  const model = useLoader(GLTFLoader, process.env.PUBLIC_URL + "/models/car.glb").scene;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [t, setT] = useState(0);
  const [thirdPerson, setThirdPerson] = useState(false); // vue embarquée toggle avec K

  const speed = 0.004; // vitesse de progression
  const rotLerp = 0.1; // douceur de rotation

  // 🔑 Gestion de la touche "K" (vue embarquée)
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key.toLowerCase() === "k") setThirdPerson((v) => !v);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // 🧩 Initialisation du modèle
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0012, 0.0012, 0.0012);
    model.children[0].position.set(-365, -18, -67);
  }, [model]);

  // 🚗 Animation du parcours
  useFrame((state, delta) => {
    if (!ref.current || !pathPoints || pathPoints.length < 2) return;

    const p1 = new THREE.Vector3(pathPoints[currentIndex].x, 0, pathPoints[currentIndex].z);
    const p2 = new THREE.Vector3(pathPoints[currentIndex + 1].x, 0, pathPoints[currentIndex + 1].z);

    // Avancer sur le segment
    const newT = t + speed * (delta * 60);
    if (newT >= 1) {
      if (currentIndex < pathPoints.length - 2) {
        setCurrentIndex((i) => i + 1);
        setT(0);
      }
      return;
    }
    setT(newT);

    const pos = p1.clone().lerp(p2, newT);
    ref.current.position.copy(pos);

    // Calcul direction et rotation
    const dir = p2.clone().sub(p1).normalize();
    const targetAngle = Math.atan2(dir.x, dir.z);
    ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, targetAngle, rotLerp);

    // 🎥 Caméra embarquée (touche K)
    if (thirdPerson) {
      const camOffset = new THREE.Vector3(-dir.x * 3, 1.5, -dir.z * 3);
      const camPos = pos.clone().add(camOffset);
      state.camera.position.lerp(camPos, 0.1);
      state.camera.lookAt(pos);
    }
  });

  return (
    <group ref={ref}>
      <primitive object={model} rotation-y={Math.PI} />
    </group>
  );
}
