// src/Scene.jsx
import {
  Environment,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { Ground } from "./Ground";
import { KmlExtrusions } from "./KmlExtrusions";
import { Woman } from "./Woman";
import { Car } from "./Car";

export function Scene({ pathPoints, mapData }) {
  const [thirdPerson, setThirdPerson] = useState(false);
  const [cameraPosition, setCameraPosition] = useState([0, 3.9, 6.21]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "k") setThirdPerson(t => !t);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Suspense fallback={null}>
      <Environment files={process.env.PUBLIC_URL + "/textures/envmap.hdr"} background={"both"} />
      <PerspectiveCamera makeDefault position={cameraPosition} fov={40} />
      {!thirdPerson && <OrbitControls target={[0, 0, 0]} />}
      <Ground />
      <KmlExtrusions />

      {mapData?.nodes?.length > 0 &&
        [...Array(3)].map((_, i) => {
          const start = mapData.nodes[Math.floor(Math.random() * mapData.nodes.length)];
          let end = mapData.nodes[Math.floor(Math.random() * mapData.nodes.length)];
          while (end.id === start.id) {
            end = mapData.nodes[Math.floor(Math.random() * mapData.nodes.length)];
          }
          return (
            <Woman
              key={i}
              id={`W${i}`}
              mapData={mapData}
              startNode={start}
              endNode={end}
              speed={0.02}
            />
          );
        })}

      <Car pathPoints={pathPoints} thirdPerson={thirdPerson} />
    </Suspense>
  );
}
