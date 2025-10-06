import { useFrame, useLoader } from "@react-three/fiber";
import { useRef, useEffect, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

export function Car() {
  const ref = useRef();
  const result = useLoader(GLTFLoader, process.env.PUBLIC_URL + "/models/car.glb").scene;
  const [step, setStep] = useState(0);
  const [timer, setTimer] = useState(0);

  const speed = 1; // m/s
  const turnSpeed = Math.PI / 2; // 90° en 1 s
  const stepDuration = 3; // 3 s par côté

  useEffect(() => {
    result.scale.set(0.0012, 0.0012, 0.0012);
    result.children[0].position.set(-365, -18, -67);
  }, [result]);

  useFrame((state, delta) => {
    if (!ref.current) return;

    setTimer((t) => t + delta);

    // Avance sur 4 côtés, tourne à chaque coin
    if (timer < stepDuration) {
      // avance tout droit
      ref.current.position.x += Math.sin(ref.current.rotation.y) * speed * delta;
      ref.current.position.z += Math.cos(ref.current.rotation.y) * speed * delta;
    } else if (timer < stepDuration + 1) {
      // tourne sur place (90°)
      ref.current.rotation.y -= turnSpeed * delta;
    } else {
      setTimer(0);
      setStep((s) => (s + 1) % 4); // boucle sur 4 côtés
    }

    // Caméra suiveuse simple
    state.camera.position.lerp(
      new THREE.Vector3(
        ref.current.position.x - 2 * Math.sin(ref.current.rotation.y),
        1.5,
        ref.current.position.z - 2 * Math.cos(ref.current.rotation.y)
      ),
      0.05
    );
    state.camera.lookAt(ref.current.position);
  });

  return (
    <group ref={ref}>
      <primitive object={result} rotation-y={Math.PI} />
    </group>
  );
}
