import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/cannon";
import { Scene } from "./Scene";
import { Map2D } from "./Map2D";
import { useState } from "react";

export default function App() {
  const [pathPoints, setPathPoints] = useState([]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* 2D map à gauche */}
      <div style={{ width: "35%", height: "100%", borderRight: "2px solid #aaa" }}>
        <Map2D onPathReady={setPathPoints} />
      </div>

      {/* 3D scene à droite */}
      <div style={{ flex: 1 }}>
        <Canvas>
          <Physics broadphase="SAP" gravity={[0, -2.6, 0]}>
            <Scene pathPoints={pathPoints} />
          </Physics>
        </Canvas>

        <div className="controls">
          <p>🧭 Clique un nœud sur la carte</p>
          <p>▶️ Appuie sur <b>Espace</b> pour lancer la voiture</p>
          <p>🎥 Appuie sur <b>K</b> pour activer la caméra embarquée</p>
        </div>
      </div>
    </div>
  );
}
