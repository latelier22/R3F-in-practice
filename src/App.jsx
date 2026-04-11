import "./index.css";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/cannon";
import { useEffect, useState } from "react";
import { Scene } from "./Scene";
import { Map2D } from "./Map2D-old";

export default function App() {
  const [pathPoints, setPathPoints] = useState([]);
  const [lastPath, setLastPath] = useState(null);
  const [mapData, setMapData] = useState(null);

  // -----------------------------
  // Position robot côté serveur
  // -----------------------------
  // robotGeo = position géographique réelle mémorisée par le serveur
  // ex: { lat, lon, heading, time }
  const [robotGeo, setRobotGeo] = useState(null);

  // robotLocal3D = même position, mais convertie en coordonnées de la scène 3D
  // ex: { x, z }
  const [robotLocal3D, setRobotLocal3D] = useState(null);

  // -----------------------------
  // Styles adaptatifs
  // -----------------------------
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

  // -----------------------------
  // Chargement périodique de la position serveur
  // -----------------------------
  // On récupère la dernière position réelle du robot.
  // IMPORTANT :
  // On veut connaître l'état partagé entre navigateurs.
  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const r = await fetch("https://sti2d.latelier22.fr/fiber/api/robot-last", {
          cache: "no-store",
        });
        const j = await r.json();

        if (!alive) return;

        if (j?.ok && j?.robot && typeof j.robot.x === "number" && typeof j.robot.y === "number") {
          setRobotGeo({
            lat: j.robot.x,
            lon: j.robot.y,
            heading: typeof j.robot.heading === "number" ? j.robot.heading : null,
            time: j.robot.time ?? null,
          });

          console.log("[App] robot-last OK", j.robot);
        } else {
          console.log("[App] robot-last : pas de robot dispo");
        }
      } catch (e) {
        console.log("[App] robot-last ERROR", String(e));
      }
    }

    tick();
    const id = setInterval(tick, 2000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // -----------------------------
  // Conversion géo -> 3D
  // -----------------------------
  // Dès qu'on a mapData.toLocal + robotGeo, on convertit la position serveur
  // en coordonnées locales de scène.
  useEffect(() => {
    if (!robotGeo) return;
    if (!mapData?.toLocal) return;

    const v = mapData.toLocal(robotGeo.lat, robotGeo.lon);
    const local3D = { x: v.x, z: -v.y };

    setRobotLocal3D(local3D);

    console.log("[App] robotLocal3D =", local3D);
  }, [robotGeo, mapData]);

  // -----------------------------
  // Sélection de nœud
  // -----------------------------
  const handleNodeSelect = (id) => {
    console.log("✅ Node sélectionné :", id);
  };

  // -----------------------------
  // Retour local simple
  // -----------------------------
  // Ici on garde ton comportement existant :
  // on inverse le dernier chemin connu dans CE navigateur.
  // Plus tard, on pourra remplacer ça par un vrai recalcul start -> end.
  const handleRetour = () => {
  if (typeof window.callReturnToBase === "function") {
    window.callReturnToBase();
  } else {
    alert("⚠️ Retour vers la base indisponible");
  }
};

  // -----------------------------
  // Toggle caméra
  // -----------------------------
  const handleCamera = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
  };

  // -----------------------------
  // Appel
  // -----------------------------
  const handleAppel = () => {
    if (typeof window.callAppelFromButton === "function") {
      window.callAppelFromButton();
    } else {
      alert("⚠️ Carte pas prête");
    }
  };

  // -----------------------------
  // Rechargement si changement orientation mobile
  // -----------------------------
  useEffect(() => {
    const resize = () => window.location.reload();
    window.addEventListener("orientationchange", resize);
    return () => window.removeEventListener("orientationchange", resize);
  }, []);

  return (
    <div style={containerStyle}>
      {/* -----------------------------
          Carte 2D
         ----------------------------- */}
      <div style={mapStyle}>
        <Map2D
          robotLocal3D={robotLocal3D}
          onPathReady={(pts) => {
            setPathPoints(pts);
            setLastPath(pts);
          }}
          onMapReady={(data) => setMapData(data)}
          onNodeSelect={handleNodeSelect}
        />
      </div>

      {/* -----------------------------
          Scène 3D
         ----------------------------- */}
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

        <div style={buttonPanel}>
          <button style={btn} onClick={handleCamera}>🎥 CAMÉRA</button>
          <button style={btn} onClick={handleAppel}>🚑 APPEL</button>
          <button style={btn} onClick={handleRetour}>🔙 RETOUR</button>
        </div>
      </div>
    </div>
  );
}