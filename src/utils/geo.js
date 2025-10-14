import * as THREE from "three";

export function createGeoConverter(originLat, originLon, scale = 0.05) {
  const R   = 6378137;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // meters per radian at this latitude
  const kx = R * Math.cos(originLat * rad); // E–W
  const ky = R;                              // N–S

  // -------- forward: (lat,lon) -> local (x,y)
  const toLocal = (lat, lon) => {
    const dLat = (lat - originLat) * rad;
    const dLon = (lon - originLon) * rad;
    const x = dLon * kx * scale;  // east+
    const y = dLat * ky * scale;  // north+
    // you were returning (x, z); keep same shape: y == “z” in your 3D, that’s fine
    return new THREE.Vector2(x, y);
  };

  // -------- inverse: local (x,y) -> {lat, lon}
  // NOTE: Map2D will call inv(X, -Z) because your 3D uses Z = -Y.
  toLocal.inv = (x, y) => {
    const lat = originLat + (y / (ky * scale)) * deg;
    const lon = originLon + (x / (kx * scale)) * deg;
    return { lat, lon };
  };

  return toLocal;
}
