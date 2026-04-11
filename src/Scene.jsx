import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { Ground } from "./Ground";
import { KmlExtrusions } from "./KmlExtrusions";
import { Car } from "./Car";
import { CharactersGroup } from "./CharactersGroup";
import { ObstacleCube } from "./ObstacleCube";

export function Scene({
  pathPoints,
  mapData,
  robotGeo,
  activeObstacle,
  onObstacleDetected,
  onPathComplete,
  ignoreObstacle = false,
}) {
  const [thirdPerson, setThirdPerson] = useState(false);
  const [cameraPosition] = useState([0, 3.9, 6.21]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "k") setThirdPerson((t) => !t);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Suspense fallback={null}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />

      <PerspectiveCamera makeDefault position={cameraPosition} fov={40} />
      {!thirdPerson && <OrbitControls target={[0, 0, 0]} />}

      <Ground />
      <KmlExtrusions />
      <CharactersGroup mapData={mapData} nRemi={5} nWoman={5} />
      <ObstacleCube obstacle={activeObstacle} />

      <Car
        pathPoints={pathPoints}
        toGeo={mapData?.toGeo}
        toLocal={mapData?.toLocal}
        robotGeo={robotGeo}
        activeObstacle={activeObstacle}
        onObstacleDetected={onObstacleDetected}
        onPathComplete={onPathComplete}
        ignoreObstacle={ignoreObstacle}
      />
    </Suspense>
  );
}
