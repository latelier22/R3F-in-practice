import * as THREE from "three";
import { useEffect, useCallback, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { createGeoConverter } from "./utils/geo";

export function KmlExtrusions({ file = "/lycee.kml", onOrigin }) {
  const { scene } = useThree();

  const originRef = useRef(null);
  const toLocalRef = useRef(null);

  const parseKML = useCallback((kmlText) => {
    const xml = new DOMParser().parseFromString(kmlText, "text/xml");
    const placemarks = xml.querySelectorAll("Placemark");

    placemarks.forEach(pm => {
      const point = pm.querySelector("Point>coordinates");
      const name = pm.querySelector("name")?.textContent?.trim().toUpperCase();
      if (point && name === "A") {
        const [lon, lat] = point.textContent.trim().split(",").map(Number);
        originRef.current = { lat, lon };
        toLocalRef.current = createGeoConverter(lat, lon, 0.05);
        onOrigin?.(originRef.current);
        console.log("✅ Origine KML fixée sur A:", originRef.current);
      }
    });

    placemarks.forEach(pm => {
      const name = pm.querySelector("name")?.textContent?.toLowerCase() || "";
      const poly = pm.querySelector("Polygon>outerBoundaryIs>LinearRing>coordinates");
      if (!poly || !toLocalRef.current) return;

      const coords = poly.textContent.trim().split(/\s+/).map(c => {
        const [lon, lat] = c.split(",").map(Number);
        return toLocalRef.current(lat, lon);
      });

      if (coords.length < 3) return;
      const shape = new THREE.Shape(coords);

      if (name.includes("limite")) {
        const geom = new THREE.BufferGeometry().setFromPoints(coords);
        const line = new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color: 0x000000 }));
        line.rotation.x = -Math.PI / 2;
        line.position.y = 0.01;
        scene.add(line);
        return;
      }

      const isBat = name.includes("bat");
      const isPelouse = name === "" || name.includes("sans titre");
      const depth = isBat ? 1 : isPelouse ? 0.01 : 0;
      if (!depth) return;

      const color = isBat ? 0x1e90ff : 0x228b22;
      const mesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color, opacity: 0.85, transparent: true })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.0;
      scene.add(mesh);
    });
  }, [scene, onOrigin]);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + file)
      .then(r => r.text())
      .then(text => parseKML(text));
  }, [file, parseKML]);

  return null;
}
