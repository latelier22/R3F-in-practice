import * as THREE from "three";

export function createGeoConverter(originLat, originLon, scale = 0.05) {
  const R = 6378137;
  return (lat, lon) => {
    const dLat = (lat - originLat) * Math.PI / 180;
    const dLon = (lon - originLon) * Math.PI / 180;
    const x = R * dLon * Math.cos(originLat * Math.PI / 180);
    const z = R * dLat;
    return new THREE.Vector2(x * scale, z * scale);
  };
}
