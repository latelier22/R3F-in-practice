import { useLoader, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

export function Car({
  pathPoints,
  toGeo,
  toLocal,
  robotGeo,
  telemetryUrl = "https://sti2d.latelier22.fr/fiber/api/robot-pos",
}) {
  const ref = useRef();

  const model = useLoader(
    GLTFLoader,
    process.env.PUBLIC_URL + "/models/car.glb"
  ).scene;

  const pathRef = useRef([]);
  const idxRef = useRef(0);
  const tRef = useRef(0);
  const movingRef = useRef(false);

  const bootstrappedFromServerRef = useRef(false);

  const [camMode, setCamMode] = useState(0);

  const lastTelemAtRef = useRef(0);
  const lastTelemPosRef = useRef({ x: null, z: null, t: 0 });

  const worldSpeed = 0.75;
  const baseRotLerp = 0.12;
  const POINT_EPS = 0.03;
  const SEGMENT_EPS = 1e-6;

  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0006, 0.0006, 0.0006);
    model.children[0]?.position.set(-365, -18, -67);
  }, [model]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "k") {
        setCamMode((m) => (m + 1) % 3);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const postTelemetry = useCallback(
    (lat, lon, headingDeg = null, speed = null) => {
      fetch(telemetryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: lat,
          y: lon,
          heading: headingDeg,
          speed,
        }),
      }).catch((e) => {
        console.log("[Car] POST telemetry ERROR", String(e));
      });
    },
    [telemetryUrl]
  );

  useEffect(() => {
    if (!ref.current) return;
    if (!robotGeo) return;
    if (typeof toLocal !== "function") return;

    if (movingRef.current) {
      console.log("[Car] robotGeo ignoré car mouvement en cours");
      return;
    }

    const v = toLocal(robotGeo.lat, robotGeo.lon);

    ref.current.position.set(v.x, 0, -v.y);

    if (typeof robotGeo.heading === "number") {
      ref.current.rotation.y = THREE.MathUtils.degToRad(robotGeo.heading);
    }

    pathRef.current = [];
    idxRef.current = 0;
    tRef.current = 0;
    movingRef.current = false;

    lastTelemAtRef.current = 0;
    lastTelemPosRef.current = {
      x: ref.current.position.x,
      z: ref.current.position.z,
      t: performance.now(),
    };

    bootstrappedFromServerRef.current = true;

    console.log("[Car] placé depuis serveur", {
      x: ref.current.position.x,
      z: ref.current.position.z,
      heading: robotGeo.heading,
    });
  }, [robotGeo, toLocal]);

  useEffect(() => {
    if (!ref.current) return;

    if (!pathPoints || pathPoints.length < 1) {
      pathRef.current = [];
      idxRef.current = 0;
      tRef.current = 0;
      movingRef.current = false;
      return;
    }

    const start = {
      x: ref.current.position.x,
      z: ref.current.position.z,
    };

    const rawPath = [start, ...pathPoints];
    const effectivePath = [rawPath[0]];

    for (let i = 1; i < rawPath.length; i++) {
      const a = effectivePath[effectivePath.length - 1];
      const b = rawPath[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);

      if (d > POINT_EPS) {
        effectivePath.push(b);
      }
    }

    if (effectivePath.length < 2) {
      pathRef.current = [];
      idxRef.current = 0;
      tRef.current = 0;
      movingRef.current = false;
      console.log("[Car] trajet ignoré : points trop proches");
      return;
    }

    pathRef.current = effectivePath;
    idxRef.current = 0;
    tRef.current = 0;
    movingRef.current = true;

    lastTelemAtRef.current = 0;
    lastTelemPosRef.current = {
      x: start.x,
      z: start.z,
      t: performance.now(),
    };

    console.log("[Car] nouveau trajet", {
      start,
      points: effectivePath.length,
      effectivePath,
    });
  }, [pathPoints]);

  useFrame((state, delta) => {
    const pts = pathRef.current;

    if (!ref.current || !pts || pts.length < 2) return;

    let idx = Math.min(idxRef.current, pts.length - 2);

    let p1 = new THREE.Vector3(pts[idx].x, 0, pts[idx].z);
    let p2 = new THREE.Vector3(pts[idx + 1].x, 0, pts[idx + 1].z);

    let dir = p2.clone().sub(p1);
    let segLen = dir.length();

    while (segLen < SEGMENT_EPS && idxRef.current < pts.length - 2) {
      idxRef.current += 1;
      tRef.current = 0;

      idx = Math.min(idxRef.current, pts.length - 2);
      p1 = new THREE.Vector3(pts[idx].x, 0, pts[idx].z);
      p2 = new THREE.Vector3(pts[idx + 1].x, 0, pts[idx + 1].z);
      dir = p2.clone().sub(p1);
      segLen = dir.length();
    }

    if (segLen < SEGMENT_EPS) {
      movingRef.current = false;
      tRef.current = 1;
      ref.current.position.copy(p2);
      return;
    }

    const p3 = pts[idx + 2]
      ? new THREE.Vector3(pts[idx + 2].x, 0, pts[idx + 2].z)
      : null;

    const dirNorm = dir.clone().normalize();

    let turnFactor = 1;

    if (p3) {
      const nextDir = p3.clone().sub(p2);
      if (nextDir.length() > 1e-9) {
        const angle = dirNorm.angleTo(nextDir.normalize());
        turnFactor = 1 - Math.min(angle / Math.PI, 0.7);
      }
    }

    let t = tRef.current;

    if (movingRef.current) {
      const tStep = (worldSpeed * delta) / segLen;
      t = t + tStep * (0.5 + 0.5 * turnFactor);

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

    const pos = p1.clone().lerp(p2, Math.min(t, 1));
    ref.current.position.copy(pos);

    const targetAngle = Math.atan2(dirNorm.x, dirNorm.z);
    const currentAngle = ref.current.rotation.y;

    let deltaAngle = targetAngle - currentAngle;
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));

    const rotLerp = baseRotLerp * (0.6 + 0.4 * turnFactor);
    ref.current.rotation.y = currentAngle + deltaAngle * rotLerp;

    if (camMode > 0) {
      const dist = camMode === 1 ? 1.5 : 0.2;
      const height = camMode === 1 ? 0.7 : 0.1;

      const camPos = pos.clone().add(
        new THREE.Vector3(-dirNorm.x * dist, height, -dirNorm.z * dist)
      );

      state.camera.position.lerp(camPos, 0.08);
      state.camera.lookAt(pos);
    }

    const now = performance.now();

    if (typeof toGeo === "function" && now - lastTelemAtRef.current >= 1000) {
      lastTelemAtRef.current = now;

      const headingDeg = THREE.MathUtils.radToDeg(ref.current.rotation.y);

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