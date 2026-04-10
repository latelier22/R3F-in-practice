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

  // ------------------------------------------------
  // Ces refs pilotent le mouvement réel du véhicule
  // ------------------------------------------------
  const pathRef = useRef([]);
  const idxRef = useRef(0);
  const tRef = useRef(0);
  const movingRef = useRef(false);

  // ------------------------------------------------
  // Cette ref sert à savoir si on a déjà initialisé
  // la position du robot depuis le serveur.
  // ------------------------------------------------
  const bootstrappedFromServerRef = useRef(false);

  // ------------------------------------------------
  // Caméra
  // ------------------------------------------------
  const [camMode, setCamMode] = useState(0);

  // ------------------------------------------------
  // Télémétrie
  // ------------------------------------------------
  const lastTelemAtRef = useRef(0);
  const lastTelemPosRef = useRef({ x: null, z: null, t: 0 });

  const baseSpeed = 0.004;
  const baseRotLerp = 0.12;

  // ------------------------------------------------
  // Initialisation modèle
  // ------------------------------------------------
  useEffect(() => {
    if (!model) return;
    model.scale.set(0.0006, 0.0006, 0.0006);
    model.children[0]?.position.set(-365, -18, -67);
  }, [model]);

  // ------------------------------------------------
  // Toggle caméra avec K
  // ------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "k") {
        setCamMode((m) => (m + 1) % 3);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------
  // Envoi télémétrie au serveur
  // ------------------------------------------------
  const postTelemetry = useCallback((lat, lon, headingDeg = null, speed = null) => {
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
  }, [telemetryUrl]);

  // ------------------------------------------------
  // Placement du robot depuis l'état serveur
  // ------------------------------------------------
  // IMPORTANT :
  // On ne veut PAS que chaque refresh serveur casse
  // un trajet local déjà en cours.
  //
  // Donc :
  // - au premier chargement : on place le robot
  // - plus tard : on ne replace que s'il est à l'arrêt
  // ------------------------------------------------
  useEffect(() => {
    if (!ref.current) return;
    if (!robotGeo) return;
    if (typeof toLocal !== "function") return;

    // Si le robot roule déjà, on ignore la mise à jour serveur
    // pour ne pas casser le mouvement local.
    if (movingRef.current) {
      console.log("[Car] robotGeo ignoré car mouvement en cours");
      return;
    }

    const v = toLocal(robotGeo.lat, robotGeo.lon);

    // Placement position
    ref.current.position.set(v.x, 0, -v.y);

    // Réapplication orientation si dispo
    if (typeof robotGeo.heading === "number") {
      ref.current.rotation.y = THREE.MathUtils.degToRad(robotGeo.heading);
    }

    // Reset des refs de mouvement
    pathRef.current = [];
    idxRef.current = 0;
    tRef.current = 0;
    movingRef.current = false;

    // Reset télémétrie baseline
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

  // ------------------------------------------------
  // Nouveau chemin à suivre
  // ------------------------------------------------
  // On part de la position courante réelle du robot,
  // pas du premier point brut du chemin.
  // ------------------------------------------------
  useEffect(() => {
    if (!ref.current) return;

    if (!pathPoints || pathPoints.length < 2) {
      pathRef.current = [];
      idxRef.current = 0;
      tRef.current = 0;
      movingRef.current = false;
      return;
    }

    // Départ = position actuelle du robot dans la scène
    const start = {
      x: ref.current.position.x,
      z: ref.current.position.z,
    };

    // On injecte la position actuelle au début du trajet
    // pour éviter une téléportation si la position réelle
    // n'est pas exactement sur le premier nœud.
    const effectivePath = [start, ...pathPoints];

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
    });
  }, [pathPoints]);

  // ------------------------------------------------
  // Animation frame par frame
  // ------------------------------------------------
  useFrame((state, delta) => {
    const pts = pathRef.current;

    if (!ref.current || !pts || pts.length < 2) return;

    const idx = Math.min(idxRef.current, pts.length - 2);

    const p1 = new THREE.Vector3(pts[idx].x, 0, pts[idx].z);
    const p2 = new THREE.Vector3(pts[idx + 1].x, 0, pts[idx + 1].z);
    const p3 = pts[idx + 2]
      ? new THREE.Vector3(pts[idx + 2].x, 0, pts[idx + 2].z)
      : null;

    const dir = p2.clone().sub(p1);
    const dirNorm =
      dir.length() > 1e-9
        ? dir.clone().normalize()
        : new THREE.Vector3(0, 0, 1);

    // ------------------------------------------------
    // Ralentissement léger dans les virages
    // ------------------------------------------------
    let turnFactor = 1;

    if (p3) {
      const nextDir = p3.clone().sub(p2);
      if (nextDir.length() > 1e-9) {
        const angle = dirNorm.angleTo(nextDir.normalize());
        turnFactor = 1 - Math.min(angle / Math.PI, 0.7);
      }
    }

    const adjustedSpeed = movingRef.current
      ? baseSpeed * (0.5 + 0.5 * turnFactor)
      : 0;

    // ------------------------------------------------
    // Avancement dans le segment courant
    // ------------------------------------------------
    let t = tRef.current;

    if (movingRef.current) {
      t = t + adjustedSpeed * (delta * 60);

      if (t >= 1) {
        if (idxRef.current < pts.length - 2) {
          idxRef.current += 1;
          t = 0;
        } else {
          // Fin du trajet
          movingRef.current = false;
          t = 1;
        }
      }

      tRef.current = t;
    }

    // ------------------------------------------------
    // Position du robot
    // ------------------------------------------------
    const pos = p1.clone().lerp(p2, Math.min(t, 1));
    ref.current.position.copy(pos);

    // ------------------------------------------------
    // Orientation du robot
    // ------------------------------------------------
    const targetAngle = Math.atan2(dirNorm.x, dirNorm.z);
    const currentAngle = ref.current.rotation.y;

    let deltaAngle = targetAngle - currentAngle;
    deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));

    const rotLerp = baseRotLerp * (0.6 + 0.4 * turnFactor);
    ref.current.rotation.y = currentAngle + deltaAngle * rotLerp;

    // ------------------------------------------------
    // Caméra embarquée
    // ------------------------------------------------
    if (camMode > 0) {
      const dist = camMode === 1 ? 1.5 : 0.2;
      const height = camMode === 1 ? 0.7 : 0.1;

      const camPos = pos.clone().add(
        new THREE.Vector3(-dirNorm.x * dist, height, -dirNorm.z * dist)
      );

      state.camera.position.lerp(camPos, 0.08);
      state.camera.lookAt(pos);
    }

    // ------------------------------------------------
    // Télémétrie 1 fois par seconde
    // ------------------------------------------------
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