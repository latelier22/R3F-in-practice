/* global L, turf */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { createGeoConverter } from "./utils/geo";

export function Map2D({ onPathReady, onMapReady, onNodeSelect }) {
  // refs pour toujours avoir la dernière version des callbacks sans relancer l'effet
  const cbRef = useRef({ onPathReady, onMapReady, onNodeSelect });
  useEffect(() => {
    cbRef.current = { onPathReady, onMapReady, onNodeSelect };
  }, [onPathReady, onMapReady, onNodeSelect]);

  const wsRef = useRef(null);
  const robotMarkerRef = useRef(null);

  useEffect(() => {
    const ensureLibs = async () => {
      const needL = !window.L;
      const needT = !window.turf;
      const loaders = [];
      if (needL) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
      }
      if (needT) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/@turf/turf@6/turf.min.js";
        loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
      }
      await Promise.all(loaders);
    };

    let cleanup = () => {};
    ensureLibs().then(() => {
      // ⚠️ ne plus détruire/recréer si déjà initialisée (évite le clignotement)
      if (window.__map2d) {
        // carte déjà créée (ex: StrictMode), on ne fait rien
        return;
      }

      init(window.L, window.turf);
      cleanup = () => {
        // fermeture WS quand le composant est démonté
        if (wsRef.current) {
          try { wsRef.current.close(); } catch {}
          wsRef.current = null;
        }
        // on peut laisser la carte vivre si tu navigues dans l’app
        // sinon, pour forcer cleanup total :
        // if (window.__map2d) { window.__map2d.remove(); delete window.__map2d; }
      };
    });

    return () => cleanup();
  // 👇 important: initialiser UNE SEULE FOIS
  }, []);

  function init(L, turf) {
    const map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
    window.__map2d = map;

    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution: "© OSM France", maxZoom: 20,
    }).addTo(map);

    let allNodes = [], allLinks = [], obstacles = [], extrusionsData = [];
    let selectedNode = null;
    let originA = null;
    let toLocal = null;
    let lastPathLayer = null;

    const pathLayersByWoman = {};
    map.__pathsByWoman = pathLayersByWoman;

    window.map2D_drawByNodeIds = (wid, nodeIds, color = "#c03") => {
      if (!nodeIds || nodeIds.length < 2) return;
      if (pathLayersByWoman[wid]) {
        map.removeLayer(pathLayersByWoman[wid]);
        delete pathLayersByWoman[wid];
      }
      const latlngs = nodeIds.map(id => {
        const n = allNodes.find(nn => nn.id === id);
        return [n.lat, n.lon];
      });
      pathLayersByWoman[wid] = L.polyline(latlngs, { color, weight: 4, opacity: 0.8 }).addTo(map);
    };

    const nodeName = (i) => {
      let s = "";
      while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
      return s;
    };

    fetch(process.env.PUBLIC_URL + "/lycee.kml")
      .then(r => r.text())
      .then(txt => {
        const xml = new DOMParser().parseFromString(txt, "text/xml");
        const placemarks = xml.querySelectorAll("Placemark");

        placemarks.forEach(pm => {
          const name = pm.querySelector("name")?.textContent || "";
          const point = pm.querySelector("Point>coordinates");
          const poly = pm.querySelector("Polygon>outerBoundaryIs>LinearRing>coordinates");

          if (point) {
            const [lon, lat] = point.textContent.trim().split(",").map(Number);
            const id = nodeName(allNodes.length);
            if (id === "A") {
              originA = { lat, lon };
              toLocal = createGeoConverter(lat, lon, 0.05);
            }

            const marker = L.circleMarker([lat, lon], {
              radius: 6, color: "black", fillColor: "orange", fillOpacity: 0.9,
            }).addTo(map);
            marker.bindTooltip(id);
            marker.on("click", () => {
              selectedNode = id;
              const path = dijkstra("A", id);
              highlightRobotPath(path);
              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(id);
            });

            allNodes.push({ id, lat, lon });
          }

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

        // Graphe des liaisons
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

        // Dijkstra
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
          const path = [];
          for (let u = end; u; u = prev[u]) path.unshift(u);
          return path;
        }

        function highlightRobotPath(path) {
          if (lastPathLayer) {
            map.removeLayer(lastPathLayer);
            lastPathLayer = null;
          }
          if (!path.length) return;
          const latlngs = path.map(id => {
            const n = allNodes.find(nn => nn.id === id);
            return [n.lat, n.lon];
          });
          lastPathLayer = L.polyline(latlngs, { color: "orange", weight: 4 }).addTo(map);
        }

        // WebSocket (une seule fois, pas de recréation)
        const ws = new WebSocket('wss://sti2d.latelier22.fr/fiber-ws/');
        wsRef.current = ws;

        ws.onopen = () => console.log('✅ WebSocket connecté (Map2D)');
        ws.onmessage = e => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'target') {
            const { x: lat, y: lon } = msg.data;

            // crée / déplace le marker
            if (!robotMarkerRef.current) {
              robotMarkerRef.current = L.marker([lat, lon], {
                icon: L.icon({
                  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448594.png',
                  iconSize: [32, 32],
                  iconAnchor: [16, 16]
                })
              }).addTo(map);
            } else {
              robotMarkerRef.current.setLatLng([lat, lon]);
            }

            // nœud le plus proche
            let nearest = null, minDist = Infinity;
            allNodes.forEach(n => {
              const d = turf.distance([lon, lat], [n.lon, n.lat]);
              if (d < minDist) { minDist = d; nearest = n; }
            });

            if (nearest) {
              selectedNode = nearest.id; // état logique courant
              const path = dijkstra("A", nearest.id);
              highlightRobotPath(path);
              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(nearest.id);
            }
          }
        };

        ws.onerror = err => console.error('❌ Erreur WebSocket Map2D:', err);
        ws.onclose = () => console.warn('🔌 WebSocket fermé');

        // notify 3D quand prêt
        if (cbRef.current.onMapReady && originA && toLocal) {
          cbRef.current.onMapReady({
            nodes: allNodes.map(n => {
              const v = toLocal(n.lat, n.lon);
              return { id: n.id, x: v.x, z: -v.y };
            }),
            links: allLinks
          });
        }

        function nodeTo3D(id) {
          const n = allNodes.find(nn => nn.id === id);
          if (!n || !toLocal) return { x: 0, z: 0 };
          const v = toLocal(n.lat, n.lon);
          return { x: v.x, z: -v.y };
        }

        function triggerAppel() {
          if (selectedNode) {
            const ids = dijkstra("A", selectedNode);
            const path3D = ids.map(id => nodeTo3D(id));
            cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);
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

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
