import {
  Environment,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { Car } from "./Car";
import { Ground } from "./Ground";
import { KmlExtrusions } from "./KmlExtrusions";

export function Scene({ pathPoints }) {
  const [thirdPerson, setThirdPerson] = useState(false);
  const [cameraPosition, setCameraPosition] = useState([0, 3.9, 6.21]);

  useEffect(() => {
    function keydownHandler(e) {
      if (e.key === "k") {
        if (thirdPerson)
          setCameraPosition([-6, 3.9, 6.21 + Math.random() * 0.01]);
        setThirdPerson(!thirdPerson);
      }
    }

    window.addEventListener("keydown", keydownHandler);
    return () => window.removeEventListener("keydown", keydownHandler);
  }, [thirdPerson]);

  return (
    <Suspense fallback={null}>
      <Environment
        files={process.env.PUBLIC_URL + "/textures/envmap.hdr"}
        background={"both"}
      />

      <PerspectiveCamera makeDefault position={cameraPosition} fov={40} />
      {!thirdPerson && <OrbitControls target={[0, 0, 0]} />}

      <Ground />
      <KmlExtrusions /> {/* 🏗️ Bâtiments + Pelouses visibles */}
      <Car pathPoints={pathPoints} thirdPerson={thirdPerson} />
    </Suspense>
  );
}
