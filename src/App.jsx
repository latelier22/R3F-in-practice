import "./index.css";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/cannon";
import { useEffect, useState } from "react";
import { Scene } from "./Scene";
import { Map2D } from "./Map2D";

export default function App() {
  const [pathPoints, setPathPoints] = useState([]);
  const [lastPath, setLastPath] = useState(null);
  const [mapData, setMapData] = useState(null);

  // ---- robot state (depuis serveur)
  const [robotGeo, setRobotGeo] = useState(null);        // {lat, lon}
  const [robotLocal3D, setRobotLocal3D] = useState(null); // {x, z} (coords 3D)

  // ---- styles
  const isMobile = window.innerWidth < 768;
  const isLandscape = window.innerWidth > window.innerHeight;

  const containerStyle = {
    display: "flex",
    flexDirection: isMobile ? (isLandscape ? "row" : "column") : "row",
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
  };

  const mapStyle = {
    flex: isMobile ? (isLandscape ? "0.5" : "0.4") : "0.35",
    height: isMobile ? (isLandscape ? "100%" : "40%") : "100%",
    minHeight: 220,
  };

  const sceneStyle = {
    flex: "1",
    position: "relative",
    background: "#000",
    minHeight: 260,
  };

  const buttonPanel = {
    position: "absolute",
    left: "50%",
    bottom: "12px",
    transform: "translateX(-50%)",
    display: "flex",
    gap: "10px",
    zIndex: 9999,
    pointerEvents: "auto",
  };

  const btn = {
    background: "#222",
    color: "white",
    border: "1px solid #555",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "14px",
    cursor: "pointer",
  };

  const handleNodeSelect = (id) => {
    console.log("✅ Node sélectionné :", id);
  };

  const handleRetour = () => {
    if (lastPath && lastPath.length > 0) {
      const retour = [...lastPath].reverse();
      console.log("↩️ Retour");
      setPathPoints(retour);
    } else {
      alert("⚠️ Aucun trajet précédent !");
    }
  };

  const handleCamera = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
  };

  const handleAppel = () => {
    if (typeof window.callAppelFromButton === "function") {
      window.callAppelFromButton();
    } else {
      alert("⚠️ Carte pas prête (callAppelFromButton manquant)");
    }
  };

  // ---- 1) poll serveur : /robot-last
  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const r = await fetch("https://sti2d.latelier22.fr/fiber/api/robot-last", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;

        if (j?.ok && j?.robot && typeof j.robot.x === "number" && typeof j.robot.y === "number") {
          const lat = j.robot.x;
          const lon = j.robot.y;
          setRobotGeo({ lat, lon });
          console.log("[App] ✅ robot-last", { lat, lon, time: j.robot.time });
        } else {
          console.log("[App] ⚠️ robot-last ok=false");
        }
      } catch (e) {
        console.log("[App] ❌ robot-last error", String(e));
      }
    }

    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ---- 2) quand mapData (toLocal) est prêt + robotGeo reçu → calcule robotLocal3D {x,z}
  useEffect(() => {
    if (!robotGeo) return;
    if (!mapData?.toLocal) return;

    const v = mapData.toLocal(robotGeo.lat, robotGeo.lon); // Vector2(x,y) où y = north+
    const local3D = { x: v.x, z: -v.y }; // 3D: z = -north
    setRobotLocal3D(local3D);

    console.log("[App] ✅ robotLocal3D computed", local3D);
  }, [robotGeo, mapData]);

  // orientation reload (comme tu faisais)
  useEffect(() => {
    const resize = () => window.location.reload();
    window.addEventListener("orientationchange", resize);
    return () => window.removeEventListener("orientationchange", resize);
  }, []);

  return (
    <div style={containerStyle}>
      {/* 2D */}
      <div style={mapStyle}>
        <Map2D
          robotLocal3D={robotLocal3D}
          onPathReady={(pts) => { setPathPoints(pts); setLastPath(pts); }}
          onMapReady={(data) => setMapData(data)}
          onNodeSelect={handleNodeSelect}
        />
      </div>

      {/* 3D */}
      <div style={sceneStyle}>
        <Canvas shadows>
          <Physics gravity={[0, -9.81, 0]}>
            {mapData && (
              <Scene
                pathPoints={pathPoints}
                mapData={mapData}
                robotGeo={robotGeo}
              />
            )}
          </Physics>
        </Canvas>

        {/* Boutons */}
        <div style={buttonPanel}>
          <button style={btn} onClick={handleCamera}>🎥 CAMÉRA</button>
          <button style={btn} onClick={handleAppel}>🚑 APPEL</button>
          <button style={btn} onClick={handleRetour}>🔙 RETOUR</button>
        </div>
      </div>
    </div>
  );
}
