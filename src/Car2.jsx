import { useLoader, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

/**
 * Props:
 * - pathPoints: [{x, z}, ...]
 * - toGeo: function (X, Z) -> { lat, lon }    // fourni par Map2D (voir plus bas)
 * - telemetryUrl?: string                      // optionnel (défaut ci-dessous)
 */
export function Car({ pathPoints, toGeo, telemetryUrl = "https://sti2d.latelier22.fr/fiber/api/robot-pos" }) {
  const ref = useRef();
  const model = useLoader(GLTFLoader, process.env.PUBLIC_URL + "/models/car.glb").scene;

  const [moving, setMoving] = useState(false);
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);

  // modes cam: 0 = orbit, 1 = arrière, 2 = proche
  const [camMode, setCamMode] = useState(0);

  const baseSpeed = 0.004;
  const baseRotLerp = 0.12;

  // --- télémétrie (throttle 1 Hz) ---
  const lastTelemAtRef = useRef(0);
  const lastTelemPosRef = useRef({ x: null, z: null, t: 0 });

  // K pour cycle caméra
  useEffect(() => {
    const onKey = (e) => { if (e.key.toLowerCase() === "k") setCamMode((m) => (m + 1) % 3); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // init modèle
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0003, 0.0003, 0.0003); // ~0.5 m
    model.children[0]?.position.set(-365, -18, -67);
  }, [model]);

  // (re)lancement du mouvement
  useEffect(() => {
    if (pathPoints && pathPoints.length >= 2) {
      setIdx(0);
      setT(0);
      setMoving(true);
      if (ref.current) ref.current.position.set(pathPoints[0].x, 0, pathPoints[0].z);
      // reset télémétrie
      lastTelemAtRef.current = 0;
      lastTelemPosRef.current = { x: pathPoints[0].x, z: pathPoints[0].z, t: performance.now() };
    } else {
      setMoving(false);
    }
  }, [pathPoints]);

  // télémétrie HTTP
  const postTelemetry = (lat, lon, headingDeg = null, speed = null) => {
    // pas d'attente de réponse / fire-and-forget
    fetch(telemetryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: lat, y: lon, heading: headingDeg, speed })
    }).catch(() => {});
  };

  useFrame((state, delta) => {
    if (!ref.current || !pathPoints || pathPoints.length < 2) return;

    // si on n'est pas "moving", on continue d'émettre la télémétrie (robot à l'arrêt)
    const i = Math.min(idx, pathPoints.length - 2);
    const p1 = new THREE.Vector3(pathPoints[i].x, 0, pathPoints[i].z);
    const p2 = new THREE.Vector3(pathPoints[i + 1].x, 0, pathPoints[i + 1].z);
    const p3 =
      pathPoints[i + 2] &&
      new THREE.Vector3(pathPoints[i + 2].x, 0, pathPoints[i + 2].z);

    // direction actuelle
    const dir = p2.clone().sub(p1);
    const dirNorm = dir.clone().normalize();

    // adapt vitesse selon virage
    let turnFactor = 1;
    if (p3) {
      const nextDir = p3.clone().sub(p2).normalize();
      const angle = dirNorm.angleTo(nextDir);
      turnFactor = 1 - Math.min(angle / Math.PI, 0.7);
    }
    const adjustedSpeed = moving ? baseSpeed * (0.5 + 0.5 * turnFactor) : 0;

    // avancer le t si on bouge
    let newT = t;
    if (moving) {
      newT = t + adjustedSpeed * (delta * 60);
      if (newT >= 1) {
        if (idx < pathPoints.length - 2) {
          setIdx((ii) => ii + 1);
          setT(0);
          newT = 0;
        } else {
          setMoving(false);
          newT = 1;
        }
      } else {
        setT(newT);
      }
    }

    // position/rotation actuelles
    const pos = p1.clone().lerp(p2, Math.min(newT, 1));
    ref.current.position.copy(pos);

    const targetAngle = Math.atan2(dirNorm.x, dirNorm.z);
    const currentAngle = ref.current.rotation.y;
    let deltaAngle = targetAngle - currentAngle;
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));
    const rotLerp = baseRotLerp * (0.6 + 0.4 * turnFactor);
    ref.current.rotation.y = currentAngle + deltaAngle * rotLerp;

    // cam embarquée si demandé
    if (camMode > 0) {
      const dist = camMode === 1 ? 1.5 : 0.2;
      const height = camMode === 1 ? 0.7 : 0.1;
      const camPos = pos.clone().add(new THREE.Vector3(-dirNorm.x * dist, height, -dirNorm.z * dist));
      state.camera.position.lerp(camPos, 0.08);
      state.camera.lookAt(pos);
    }

    // ---------- TÉLÉMÉTRIE 1 Hz ----------
    const now = performance.now();
    if (now - lastTelemAtRef.current >= 1000 && typeof toGeo === "function") {
      lastTelemAtRef.current = now;

      // heading en degrés
      const headingDeg = THREE.MathUtils.radToDeg(ref.current.rotation.y);

      // vitesse estimée (distance locale / dt)
      let speed = null;
      const prev = lastTelemPosRef.current;
      if (prev.x != null && prev.z != null && prev.t > 0) {
        const dLoc = Math.hypot(pos.x - prev.x, pos.z - prev.z);
        const dt = (now - prev.t) / 1000;
        if (dt > 0) speed = dLoc / dt; // unités = unités de ta scène (≈ mètres si ton toLocal est métrique)
      }
      lastTelemPosRef.current = { x: pos.x, z: pos.z, t: now };

      // conversion locale → géo
      const { lat, lon } = toGeo(pos.x, pos.z);
      postTelemetry(lat, lon, headingDeg, speed);
    }
  });

  return (
    <group ref={ref}>
      <primitive object={model} rotation-y={0} />
    </group>
  );
}
