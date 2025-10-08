// src/Map2D.jsx
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { createGeoConverter } from "./utils/geo";

export function Map2D({ onPathReady, onMapReady, onNodeSelect }) {
  const mapRef = useRef(null);

  useEffect(() => {
    const ensureLibs = async () => {
      const needL = !window.L;
      const needT = !window.turf;
      const loaders = [];
      if (needL) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(new Promise((res) => { s.onload = res; document.head.appendChild(s); }));
      }
      if (needT) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/@turf/turf@6/turf.min.js";
        loaders.push(new Promise((res) => { s.onload = res; document.head.appendChild(s); }));
      }
      await Promise.all(loaders);
    };

    ensureLibs().then(() => {
      if (!mapRef.current) init(window.L, window.turf);
    });

    function init(L, turf) {
      // évite l’erreur “Map container is already initialized”
      if (mapRef.current || (L.DomUtil.get("map2d") && L.DomUtil.get("map2d")._leaflet_id)) return;

      const map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "© OSM France", maxZoom: 20,
      }).addTo(map);

      const SCALE = 0.05; // même valeur que KmlExtrusions / toLocal
      const R = 6378137;

      let allNodes = [], allLinks = [], obstacles = [], extrusionsData = [];
      let selectedNode = null;
      let originA = null;
      let toLocal = null;
      let lastPathLayer = null;

      // stockage des tracés par agent
      const agentLayers = new Map();

      const nodeName = (i) => {
        let s = "";
        while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
        return s;
      };

      fetch(process.env.PUBLIC_URL + "/lycee.kml")
        .then((r) => r.text())
        .then((txt) => {
          const xml = new DOMParser().parseFromString(txt, "text/xml");
          const placemarks = xml.querySelectorAll("Placemark");

          placemarks.forEach((pm) => {
            const name = pm.querySelector("name")?.textContent || "";
            const point = pm.querySelector("Point>coordinates");
            const poly = pm.querySelector("Polygon>outerBoundaryIs>LinearRing>coordinates");

            // Points (nœuds)
            if (point) {
              const [lon, lat] = point.textContent.trim().split(",").map(Number);
              const id = nodeName(allNodes.length);
              if (id === "A") {
                originA = { lat, lon };
                toLocal = createGeoConverter(lat, lon, SCALE);
              }

              const marker = L.circleMarker([lat, lon], {
                radius: 6, color: "black", fillColor: "orange", fillOpacity: 0.9,
              }).addTo(map);
              marker.bindTooltip(id);

              marker.on("click", () => {
                selectedNode = id;
                const path = dijkstra("A", id);
                highlightPath(path);
                if (typeof onNodeSelect === "function") onNodeSelect(id);
              });

              allNodes.push({ id, lat, lon });
            }

            // Polygones
            if (poly) {
              const coords = poly.textContent.trim().split(/\s+/).map(c => {
                const [lon, lat] = c.split(",").map(Number);
                return [lat, lon];
              });

              let color = "gray", fill = "lightgray", type = "autre";
              if (name === "" || name.toLowerCase().includes("sans titre")) {
                color = "green"; fill = "lightgreen"; type = "pelouse";
              } else if (name.toLowerCase().includes("bat")) {
                color = "blue"; fill = "lightblue"; type = "bat";
              }

              L.polygon(coords, { color, fillColor: fill, fillOpacity: 0.5 }).addTo(map);
              obstacles.push(coords);
              extrusionsData.push({ coords, type });
            }
          });

          // Liens du graphe (chemins autorisés)
          for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
              const n1 = allNodes[i], n2 = allNodes[j];
              const line = turf.lineString([[n1.lon, n1.lat], [n2.lon, n2.lat]]);
              let interdit = false;
              obstacles.forEach(coords => {
                const poly = turf.polygon([coords.map(([lat, lon]) => [lon, lat])]);
                if (turf.lineIntersect(line, poly).features.length > 0) interdit = true;
              });
              if (interdit) continue;
              const dist = turf.distance([n1.lon, n1.lat], [n2.lon, n2.lat]) * 1000;
              allLinks.push({ from: n1.id, to: n2.id, dist });
            }
          }

          // Envoi vers la 3D
          if (onMapReady && originA) {
            onMapReady({
              extrusions3D: extrusionsData.map(obj => ({
                shape: obj.coords.map(([lat, lon]) => {
                  const v = toLocal(lat, lon);
                  return { x: v.x, z: v.y };
                }),
                type: obj.type
              })),
              nodes: allNodes.map(n => {
                const v = toLocal(n.lat, n.lon);
                return { id: n.id, x: v.x, z: v.y };
              }),
              links: allLinks
            });
          }

          // ---- Algorithmes / helpers ----
          function dijkstra(start, end) {
            const dist = {}, prev = {}, Q = new Set(allNodes.map(n => n.id));
            allNodes.forEach(n => dist[n.id] = Infinity);
            dist[start] = 0;
            while (Q.size > 0) {
              let u = [...Q].reduce((a, b) => dist[a] < dist[b] ? a : b);
              Q.delete(u);
              if (u === end) break;
              allLinks.filter(l => l.from === u || l.to === u).forEach(l => {
                const v = (l.from === u ? l.to : l.from);
                if (!Q.has(v)) return;
                const alt = dist[u] + l.dist;
                if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
              });
            }
            let path = [], u = end;
            while (u) { path.unshift(u); u = prev[u]; }
            return path;
          }

          function highlightPath(path) {
            if (lastPathLayer) map.removeLayer(lastPathLayer);
            if (!path.length) return;
            const latlngs = path.map(id => {
              const n = allNodes.find(nn => nn.id === id);
              return [n.lat, n.lon];
            });
            lastPathLayer = L.polyline(latlngs, { color: "orange", weight: 4 }).addTo(map);
          }

          // inverse de toLocal : (x,z local 3D) -> (lat, lon)
          function fromLocal(x, z) {
            if (!originA) return { lat: 0, lon: 0 };
            const phi0 = originA.lat * Math.PI / 180;
            const dLat = (-z) / (R * SCALE); // attention au signe: Three z = -local y
            const dLon = (x) / (R * Math.cos(phi0) * SCALE);
            return {
              lat: originA.lat + dLat * 180 / Math.PI,
              lon: originA.lon + dLon * 180 / Math.PI
            };
          }

          function colorFor(id) {
            // couleur stable par id
            let h = 0;
            for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
            return `hsl(${h}, 85%, 50%)`;
          }

          // ---- API PUBLIQUE POUR LES WOMEN ----
          window.map2D_drawLocalPath = (agentId, localPoints /* [{x,z}, ...] */) => {
            if (!Array.isArray(localPoints) || localPoints.length < 2) return;

            // convertit en lat/lon
            const latlngs = localPoints.map(p => {
              const { lat, lon } = fromLocal(p.x, p.z);
              return [lat, lon];
            });

            // remplace la polyline de cet agent
            const old = agentLayers.get(agentId);
            if (old) map.removeLayer(old);

            const line = L.polyline(latlngs, { color: colorFor(agentId), weight: 3, opacity: 0.9 })
              .addTo(map);
            agentLayers.set(agentId, line);
          };

          window.map2D_clearAgentPath = (agentId) => {
            const old = agentLayers.get(agentId);
            if (old) { map.removeLayer(old); agentLayers.delete(agentId); }
          };

          // ---- Appel robot (Espace + bouton) ----
          function nodeTo3D(id) {
            const n = allNodes.find(nn => nn.id === id);
            if (!n || !toLocal) return { x: 0, z: 0 };
            const v = toLocal(n.lat, n.lon);
            return { x: v.x, z: -v.y };
          }
          function triggerAppel() {
            if (selectedNode) {
              const path = dijkstra("A", selectedNode);
              const path3D = path.map(id => nodeTo3D(id));
              onPathReady(path3D);
            } else {
              alert("⚠️ Aucun nœud sélectionné !");
            }
          }
          window.callAppelFromButton = triggerAppel;
          window.addEventListener("keydown", (e) => {
            if ((e.code === "Space" || e.key === " ")) triggerAppel();
          });
        });
    }
  }, [onPathReady, onMapReady]);

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
