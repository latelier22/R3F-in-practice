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
  const [thirdPerson, setThirdPerson] = useState(false);

  const speed = 0.004;  // vitesse chemin
  const rotLerp = 0.15; // douceur rotation

  // K = caméra embarquée
  useEffect(() => {
    const onKey = (e) => { if (e.key.toLowerCase() === "k") setThirdPerson(v => !v); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // init modèle
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0012, 0.0012, 0.0012);
    model.children[0].position.set(-365, -18, -67);
  }, [model]);

  // Quand un nouveau chemin arrive depuis la carte → reset & démarrer
  useEffect(() => {
    if (pathPoints && pathPoints.length >= 2) {
      setIdx(0);
      setT(0);
      setMoving(true);
      // Place la voiture sur A
      if (ref.current) {
        ref.current.position.set(pathPoints[0].x, 0, pathPoints[0].z);
      }
    } else {
      setMoving(false);
    }
  }, [pathPoints]);

  useFrame((state, delta) => {
    if (!ref.current || !moving || !pathPoints || pathPoints.length < 2) return;

    const p1 = new THREE.Vector3(pathPoints[idx].x, 0, pathPoints[idx].z);
    const p2 = new THREE.Vector3(pathPoints[idx + 1].x, 0, pathPoints[idx + 1].z);

    const newT = t + speed * (delta * 60);
    if (newT >= 1) {
      if (idx < pathPoints.length - 2) {
        setIdx(i => i + 1);
        setT(0);
      } else {
        setMoving(false); // fin
      }
    } else {
      setT(newT);
    }

    const pos = p1.clone().lerp(p2, newT >= 1 ? 1 : newT);
    ref.current.position.copy(pos);

    // orientation
    const dir = p2.clone().sub(p1).normalize();
    const targetAngle = Math.atan2(dir.x, dir.z);
    ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, targetAngle, rotLerp);

    // caméra embarquée (K)
    if (thirdPerson) {
      const camPos = pos.clone().add(new THREE.Vector3(-dir.x * 3, 1.5, -dir.z * 3));
      state.camera.position.lerp(camPos, 0.1);
      state.camera.lookAt(pos);
    }
  });

  return (
    <group ref={ref}>
      <primitive object={model} rotation-y={0} />
    </group>
  );
}
