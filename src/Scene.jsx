import {
  Environment,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { Ground } from "./Ground";
import { KmlExtrusions } from "./KmlExtrusions";
import { Car } from "./Car";
import { CharactersGroup } from "./CharactersGroup";

export function Scene({ pathPoints, mapData }) {
  const [thirdPerson, setThirdPerson] = useState(false);
  const [cameraPosition] = useState([0, 3.9, 6.21]); // setCameraPosition supprimé

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
      <CharactersGroup mapData={mapData} nRemi={20} nWoman={20} />
      <Car pathPoints={pathPoints} thirdPerson={thirdPerson} />
    </Suspense>
  );
}
