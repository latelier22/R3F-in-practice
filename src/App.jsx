import "./index.css";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/cannon";
import { Scene } from "./Scene";
import { Map2D } from "./Map2D";
import { useState, useRef, useEffect } from "react";

// Styles adaptatifs (mobile/paysage)
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
};

const sceneStyle = {
  flex: "1",
  position: "relative",
  background: "#000",
};

const buttonPanel = {
  position: "absolute",
  bottom: "10px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  gap: "10px",
  zIndex: 10,
};

const btn = {
  background: "#222",
  color: "white",
  border: "1px solid #555",
  borderRadius: "6px",
  padding: "8px 14px",
  fontSize: "14px",
  cursor: "pointer",
};

export default function App() {
  const [pathPoints, setPathPoints] = useState([]);
  const [lastPath, setLastPath] = useState(null);
  const selectedNodeRef = useRef(null); // ✅ stable, non réinitialisé

  const [mapData, setMapData] = useState(null);

  // ✅ quand un point est cliqué sur la carte
  const handleNodeSelect = (id) => {
    console.log("✅ Node sélectionné :", id);
    selectedNodeRef.current = id;
  };

  // ✅ bouton APPEL : démarre le trajet actuel
  const handleAppel = () => {
    if (selectedNodeRef.current && lastPath) {
      console.log("🚗 Appel vers", selectedNodeRef.current);
      setPathPoints(lastPath);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    } else {
      alert("⚠️ Sélectionnez un point sur la carte avant d'appeler le robot !");
    }
  };

  // ✅ bouton RETOUR : refait le trajet inverse
  const handleRetour = () => {
    if (lastPath && lastPath.length > 0) {
      const retour = [...lastPath].reverse();
      console.log("↩️ Retour vers A");
      setPathPoints(retour);
    } else {
      alert("⚠️ Aucun trajet précédent !");
    }
  };

  // ✅ bouton CAMÉRA : toggle K
  const handleCamera = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
  };

  useEffect(() => {
    const resize = () => window.location.reload();
    window.addEventListener("orientationchange", resize);
    return () => window.removeEventListener("orientationchange", resize);
  }, []);

  return (
    <div style={containerStyle}>
      {/* Carte 2D */}
      <div style={mapStyle}>
       <Map2D
  onPathReady={(pts) => { setPathPoints(pts); setLastPath(pts); }}
  onMapReady={(data) => setMapData(data)}
  onNodeSelect={handleNodeSelect}
/>
      </div>

      {/* Scène 3D */}
      <div style={sceneStyle}>
        <Canvas shadows>
          <Physics gravity={[0, -9.81, 0]}>
           {mapData && <Scene pathPoints={pathPoints} mapData={mapData} />}
          </Physics>
        </Canvas>

        {/* Boutons de commande */}
        <div style={buttonPanel}>
          <button style={btn} onClick={handleCamera}>🎥 CAMÉRA</button>
          <button style={btn} onClick={() => window.callAppelFromButton?.()}>
  🚑 APPEL
</button>

          <button style={btn} onClick={handleRetour}>🔙 RETOUR</button>
        </div>
      </div>
    </div>
  );
}
