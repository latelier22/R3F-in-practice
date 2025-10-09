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
import { RemiAnimated } from "./Remi";

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
      <RemiAnimated/>

    {mapData && [...Array(50)].map((_, i) => (
  <Woman key={i} wid={`W${i}`} mapData={mapData} speed={0.002} />
))}


      <Car pathPoints={pathPoints} thirdPerson={thirdPerson} />
    </Suspense>
  );
}
