import { useLoader, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

/**
 * Props:
 * - pathPoints: [{x, z}, ...]  (3D coords)
 * - toGeo: (X,Z) -> {lat, lon}
 * - toLocal: (lat,lon) -> Vector2(x,y)
 * - robotGeo: {lat, lon}  (depuis serveur /api/robot-last)
 */
export function Car({
  pathPoints,
  toGeo,
  toLocal,
  robotGeo,
  telemetryUrl = "https://sti2d.latelier22.fr/fiber/api/robot-pos",
}) {
  const ref = useRef();

  const model = useLoader(GLTFLoader, process.env.PUBLIC_URL + "/models/car.glb").scene;

  // chemin utilisé réellement par useFrame
  const pathRef = useRef([]);
  const idxRef = useRef(0);
  const tRef = useRef(0);
  const movingRef = useRef(false);

  // cam
  const [camMode, setCamMode] = useState(0); // 0 orbit, 1 arrière, 2 proche

  // télémétrie throttle
  const lastTelemAtRef = useRef(0);
  const lastTelemPosRef = useRef({ x: null, z: null, t: 0 });
  const firstTelemetrySentRef = useRef(false);

  const baseSpeed = 0.004;
  const baseRotLerp = 0.12;

  // --- init modèle
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0006, 0.0006, 0.0006);
    model.children[0]?.position.set(-365, -18, -67);
  }, [model]);

  // --- toggle camera
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "k") setCamMode((m) => (m + 1) % 3);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- POST télémétrie (stable)
  const postTelemetry = useCallback((lat, lon, headingDeg = null, speed = null) => {
    console.log("[Car] → POST /robot-pos", { lat, lon, headingDeg, speed });
    fetch(telemetryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: lat, y: lon, heading: headingDeg, speed }),
    }).catch((e) => console.log("[Car] ❌ POST fail", String(e)));
  }, [telemetryUrl]);

  // --- kickstart télémétrie 1 fois
  const kickstartTelemetryIfPossible = useCallback(() => {
    if (!ref.current) return;
    if (typeof toGeo !== "function") return;
    if (firstTelemetrySentRef.current) return;

    const p = ref.current.position;
    const headingDeg = THREE.MathUtils.radToDeg(ref.current.rotation?.y || 0);
    const { lat, lon } = toGeo(p.x, p.z);

    console.log("[Car] ✅ kickstart telemetry", { lat, lon, headingDeg });
    postTelemetry(lat, lon, headingDeg, 0);
    firstTelemetrySentRef.current = true;
  }, [toGeo, postTelemetry]);

  // --- au reload: place le robot sur robotGeo (serveur)
  useEffect(() => {
    if (!ref.current) return;
    if (!robotGeo) return;
    if (typeof toLocal !== "function") return;

    const v = toLocal(robotGeo.lat, robotGeo.lon); // x,y(north+)
    ref.current.position.set(v.x, 0, v.y); // ATTENTION: ici on utilise y (north+) en Z "temporaire"
    // Mais notre scène utilise Z = -north, donc corrige:
    ref.current.position.set(v.x, 0, -v.y);

    console.log("[Car] ✅ placed from server robotGeo", { x: ref.current.position.x, z: ref.current.position.z });

    // reset refs movement
    pathRef.current = [];
    idxRef.current = 0;
    tRef.current = 0;
    movingRef.current = false;

    // reset télémétrie baseline
    lastTelemAtRef.current = 0;
    lastTelemPosRef.current = { x: ref.current.position.x, z: ref.current.position.z, t: performance.now() };

    kickstartTelemetryIfPossible();
  }, [robotGeo, toLocal, kickstartTelemetryIfPossible]);

  // --- nouveau trajet: départ = position actuelle (pas A)
  useEffect(() => {
    if (!ref.current) return;

    if (!pathPoints || pathPoints.length < 2) {
      movingRef.current = false;
      pathRef.current = [];
      idxRef.current = 0;
      tRef.current = 0;
      return;
    }

    const start = { x: ref.current.position.x, z: ref.current.position.z };
    const effective = [start, ...pathPoints];

    pathRef.current = effective;
    idxRef.current = 0;
    tRef.current = 0;
    movingRef.current = true;

    // reset télémétrie
    lastTelemAtRef.current = 0;
    lastTelemPosRef.current = { x: start.x, z: start.z, t: performance.now() };

    console.log("[Car] ✅ new path received. start=", start, "len=", effective.length);

    kickstartTelemetryIfPossible();
  }, [pathPoints, kickstartTelemetryIfPossible]);

  useFrame((state, delta) => {
    const pts = pathRef.current;
    if (!ref.current || !pts || pts.length < 2) return;

    const idx = Math.min(idxRef.current, pts.length - 2);
    const p1 = new THREE.Vector3(pts[idx].x, 0, pts[idx].z);
    const p2 = new THREE.Vector3(pts[idx + 1].x, 0, pts[idx + 1].z);
    const p3 = pts[idx + 2] ? new THREE.Vector3(pts[idx + 2].x, 0, pts[idx + 2].z) : null;

    const dir = p2.clone().sub(p1);
    const dirNorm = dir.length() > 1e-9 ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1);

    let turnFactor = 1;
    if (p3) {
      const nextDir = p3.clone().sub(p2);
      if (nextDir.length() > 1e-9) {
        const angle = dirNorm.angleTo(nextDir.normalize());
        turnFactor = 1 - Math.min(angle / Math.PI, 0.7);
      }
    }

    const isMoving = movingRef.current;
    const adjustedSpeed = isMoving ? baseSpeed * (0.5 + 0.5 * turnFactor) : 0;

    // avance t
    let t = tRef.current;
    if (isMoving) {
      t = t + adjustedSpeed * (delta * 60);

      if (t >= 1) {
        if (idxRef.current < pts.length - 2) {
          idxRef.current += 1;
          t = 0;
        } else {
          movingRef.current = false;
          t = 1;
        }
      }
      tRef.current = t;
    }

    // position
    const pos = p1.clone().lerp(p2, Math.min(t, 1));
    ref.current.position.copy(pos);

    // rotation
    const targetAngle = Math.atan2(dirNorm.x, dirNorm.z);
    const currentAngle = ref.current.rotation.y;
    let deltaAngle = targetAngle - currentAngle;
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));

    const rotLerp = baseRotLerp * (0.6 + 0.4 * turnFactor);
    ref.current.rotation.y = currentAngle + deltaAngle * rotLerp;

    // camera embarquée
    if (camMode > 0) {
      const dist = camMode === 1 ? 1.5 : 0.2;
      const height = camMode === 1 ? 0.7 : 0.1;
      const camPos = pos.clone().add(new THREE.Vector3(-dirNorm.x * dist, height, -dirNorm.z * dist));
      state.camera.position.lerp(camPos, 0.08);
      state.camera.lookAt(pos);
    }

    // télémétrie 1 Hz
    const now = performance.now();
    if (typeof toGeo === "function" && now - lastTelemAtRef.current >= 1000) {
      lastTelemAtRef.current = now;

      const headingDeg = THREE.MathUtils.radToDeg(ref.current.rotation.y);

      // speed estimée
      let speed = 0;
      const prev = lastTelemPosRef.current;
      if (prev.x != null && prev.z != null && prev.t > 0) {
        const dLoc = Math.hypot(pos.x - prev.x, pos.z - prev.z);
        const dt = (now - prev.t) / 1000;
        if (dt > 0) speed = dLoc / dt;
      }
      lastTelemPosRef.current = { x: pos.x, z: pos.z, t: now };

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
