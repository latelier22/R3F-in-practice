/* global L, turf */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { createGeoConverter } from "./utils/geo";

export function Map2D({ onPathReady, onMapReady, onNodeSelect }) {
  // refs pour garder les callbacks à jour sans relancer l’effet principal
  const cbRef = useRef({ onPathReady, onMapReady, onNodeSelect });
  useEffect(() => {
    cbRef.current = { onPathReady, onMapReady, onNodeSelect };
  }, [onPathReady, onMapReady, onNodeSelect]);

  const wsRef = useRef(null);

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
      const reuse = !!window.__map2d;
      init(window.L, window.turf, reuse);

      cleanup = () => {
        // Fermer proprement la WebSocket
        if (wsRef.current) {
          try { wsRef.current.close(); } catch {}
          wsRef.current = null;
        }
        // Soft reset (on garde la carte → pas de flicker)
        softReset(window.__map2d);
      };
    });

    return () => cleanup();
  }, []); // init une seule fois

  // ---- SOFT RESET : on garde le fond de plan / la map, mais on efface notre session
  function softReset(map) {
    if (!map) return;
    // Supprimer nos couches (tracés par woman, dernier chemin, robot)
    if (map.__pathsByWoman) {
      Object.values(map.__pathsByWoman).forEach(l => { try { map.removeLayer(l); } catch {} });
      map.__pathsByWoman = {};
    }
    if (map.__lastPathLayer) { try { map.removeLayer(map.__lastPathLayer); } catch {} map.__lastPathLayer = null; }
    if (map.__robotMarker) { try { map.removeLayer(map.__robotMarker); } catch {} map.__robotMarker = null; }

    // Désabonner les events qu’on aurait posés (évite doublons)
    try { map.off(); } catch {}

    // Réinitialiser les états de session
    map.__selectedNode = null;
    map.__allNodes = [];
    map.__allLinks = [];
    map.__obstacles = [];
    map.__extrusionsData = [];
    map.__originA = null;
    map.__toLocal = null;

    // Nettoyage des helpers globaux éventuels
    delete window.map2D_drawByNodeIds;
    delete window.callAppelFromButton;
  }

  function init(L, turf, reuse = false) {
    let map = window.__map2d;
    if (!reuse || !map) {
      map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
      window.__map2d = map;

      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "© OSM France", maxZoom: 20,
      }).addTo(map);
    } else {
      // Si on réutilise la carte existante → soft reset pour repartir propre
      softReset(map);
    }

    // États de session portés par la map (persistants entre renders, mais reset au refresh)
    map.__pathsByWoman = map.__pathsByWoman || {};
    map.__selectedNode = null;
    map.__lastPathLayer = null;
    map.__robotMarker = null;

    map.__allNodes = [];
    map.__allLinks = [];
    map.__obstacles = [];
    map.__extrusionsData = [];
    map.__originA = null;
    map.__toLocal = null;

    const allNodes = map.__allNodes;
    const allLinks = map.__allLinks;
    const obstacles = map.__obstacles;
    const extrusionsData = map.__extrusionsData;

    // Helper global (dessin d’un chemin par ids pour une “woman”)
    window.map2D_drawByNodeIds = (wid, nodeIds, color = "#c03") => {
      if (!nodeIds || nodeIds.length < 2) return;
      if (map.__pathsByWoman[wid]) {
        map.removeLayer(map.__pathsByWoman[wid]);
        delete map.__pathsByWoman[wid];
      }
      const latlngs = nodeIds.map(id => {
        const n = allNodes.find(nn => nn.id === id);
        return [n.lat, n.lon];
      });
      map.__pathsByWoman[wid] = L.polyline(latlngs, { color, weight: 4, opacity: 0.8 }).addTo(map);
    };

    // Nommer les noeuds A, B, C, ... Z, AA, AB, ...
    const nodeName = (i) => {
      let s = "";
      while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
      return s;
    };

    // --- Charger KML et construire le graphe
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
              map.__originA = { lat, lon };
              map.__toLocal = createGeoConverter(lat, lon, 0.05);
            }

            const marker = L.circleMarker([lat, lon], {
              radius: 6, color: "black", fillColor: "orange", fillOpacity: 0.9,
            }).addTo(map);
            marker.bindTooltip(id);
            marker.on("click", () => {
              map.__selectedNode = id;
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

        // Liaisons du graphe (toutes paires valides, pas d’intersection avec obstacles)
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

        // --- Dijkstra
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

        // --- Highlight chemin robot
        function highlightRobotPath(path) {
          if (map.__lastPathLayer) {
            try { map.removeLayer(map.__lastPathLayer); } catch {}
            map.__lastPathLayer = null;
          }
          if (!path.length) return;
          const latlngs = path.map(id => {
            const n = allNodes.find(nn => nn.id === id);
            return [n.lat, n.lon];
          });
          map.__lastPathLayer = L.polyline(latlngs, { color: "orange", weight: 4 }).addTo(map);
        }

        // --- WebSocket (une seule fois par session UI)
        const ws = new WebSocket("wss://sti2d.latelier22.fr/fiber-ws/");
        wsRef.current = ws;

        ws.onopen = () => console.log("✅ WebSocket connecté (Map2D)");
        ws.onmessage = e => {
          const msg = JSON.parse(e.data);
          if (msg.type === "target") {
            const { x: lat, y: lon } = msg.data;

            // Crée / déplace le marker robot
            if (!map.__robotMarker) {
              map.__robotMarker = L.marker([lat, lon], {
                icon: L.icon({
                  iconUrl: "https://cdn-icons-png.flaticon.com/512/3448/3448594.png",
                  iconSize: [32, 32],
                  iconAnchor: [16, 16],
                })
              }).addTo(map);
            } else {
              map.__robotMarker.setLatLng([lat, lon]);
            }

            // Nœud le plus proche
            let nearest = null, minDist = Infinity;
            allNodes.forEach(n => {
              const d = turf.distance([lon, lat], [n.lon, n.lat]);
              if (d < minDist) { minDist = d; nearest = n; }
            });

            if (nearest) {
              map.__selectedNode = nearest.id;
              const path = dijkstra("A", nearest.id);
              highlightRobotPath(path);
              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(nearest.id);
            }
          }
        };

        ws.onerror = err => console.error("❌ Erreur WebSocket Map2D:", err);
        ws.onclose = () => console.warn("🔌 WebSocket fermé");

        // --- Notifier la 3D quand le graphe est prêt
        if (cbRef.current.onMapReady && map.__originA && map.__toLocal) {
          cbRef.current.onMapReady({
            nodes: allNodes.map(n => {
              const v = map.__toLocal(n.lat, n.lon);
              return { id: n.id, x: v.x, z: -v.y };
            }),
            links: allLinks
          });
        }

        // Conversion d’un id de nœud vers coords 3D locales
        function nodeTo3D(id) {
          const n = allNodes.find(nn => nn.id === id);
          if (!n || !map.__toLocal) return { x: 0, z: 0 };
          const v = map.__toLocal(n.lat, n.lon);
          return { x: v.x, z: -v.y };
        }

        // Déclenche l’envoi du chemin A→selected vers la 3D
        function triggerAppel() {
          if (map.__selectedNode) {
            const ids = dijkstra("A", map.__selectedNode);
            const path3D = ids.map(id => nodeTo3D(id));
            cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);
          } else {
            alert("⚠️ Aucun nœud sélectionné !");
          }
        }

        // Helpers globaux (facultatif)
        window.callAppelFromButton = triggerAppel;
        window.addEventListener("keydown", (e) => {
          if ((e.code === "Space" || e.key === " ")) triggerAppel();
        });
      });
  }

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
