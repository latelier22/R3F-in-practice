import { useLoader, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

export function Car({ pathPoints }) {
  const ref = useRef();
  const model = useLoader(GLTFLoader, process.env.PUBLIC_URL + "/models/car.glb").scene;

  const [moving, setMoving] = useState(false);
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);

  // 0 = orbit, 1 = caméra arrière, 2 = caméra proche
  const [camMode, setCamMode] = useState(0);

  const baseSpeed = 0.004;
  const baseRotLerp = 0.12;

  // --- Touche K : cycle caméra ---
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "k") {
        setCamMode((m) => (m + 1) % 3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Initialisation modèle ---
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0003, 0.0003, 0.0003); // 0.5m environ
    model.children[0].position.set(-365, -18, -67);
  }, [model]);

  // --- Démarrage du mouvement ---
  useEffect(() => {
    if (pathPoints && pathPoints.length >= 2) {
      setIdx(0);
      setT(0);
      setMoving(true);
      if (ref.current)
        ref.current.position.set(pathPoints[0].x, 0, pathPoints[0].z);
    } else {
      setMoving(false);
    }
  }, [pathPoints]);

  // --- Animation ---
  useFrame((state, delta) => {
    if (!ref.current || !moving || !pathPoints || pathPoints.length < 2) return;

    const p1 = new THREE.Vector3(pathPoints[idx].x, 0, pathPoints[idx].z);
    const p2 = new THREE.Vector3(pathPoints[idx + 1].x, 0, pathPoints[idx + 1].z);
    const p3 =
      pathPoints[idx + 2] &&
      new THREE.Vector3(pathPoints[idx + 2].x, 0, pathPoints[idx + 2].z);

    // --- Calcul direction ---
    const dir = p2.clone().sub(p1).normalize();

    // angle du prochain segment si dispo (pour anticiper virage)
    let turnFactor = 1;
    if (p3) {
      const nextDir = p3.clone().sub(p2).normalize();
      const angle = dir.angleTo(nextDir);
      turnFactor = 1 - Math.min(angle / Math.PI, 0.7); // réduit la vitesse sur virage serré
    }

    const adjustedSpeed = baseSpeed * (0.5 + 0.5 * turnFactor);
    const newT = t + adjustedSpeed * (delta * 60);

    if (newT >= 1) {
      if (idx < pathPoints.length - 2) {
        setIdx((i) => i + 1);
        setT(0);
      } else {
        setMoving(false);
      }
    } else {
      setT(newT);
    }

    // --- Position ---
    const pos = p1.clone().lerp(p2, Math.min(newT, 1));
    ref.current.position.copy(pos);

    // --- Rotation fluide ---
    const targetAngle = Math.atan2(dir.x, dir.z);
    const currentAngle = ref.current.rotation.y;
    let deltaAngle = targetAngle - currentAngle;
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));

    const rotLerp = baseRotLerp * (0.6 + 0.4 * turnFactor); // rotation + lente dans virages
    ref.current.rotation.y = currentAngle + deltaAngle * rotLerp;

    // --- Caméras ---
    if (camMode > 0) {
      // Caméra embarquée
      const dist = camMode === 1 ? 1.5 : 0.2; // moyenne ou proche
      const height = camMode === 1 ? 0.7 : 0.1;
      const camPos = pos.clone().add(
        new THREE.Vector3(-dir.x * dist, height, -dir.z * dist)
      );

      state.camera.position.lerp(camPos, 0.08);
      state.camera.lookAt(pos);
    }
  });

  return (
    <group ref={ref}>
      <primitive object={model} rotation-y={0} />
    </group>
  );
}
