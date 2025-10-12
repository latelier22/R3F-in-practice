import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { createGeoConverter } from "./utils/geo";

export function Map2D({ onPathReady, onMapReady, onNodeSelect }) {

/* global L, turf */

// --- Connexion WebSocket pour position robot ---
useEffect(() => {
  const ws = new WebSocket('wss://sti2d.latelier22.fr/fiber-ws/')
  let robotMarker = null

  ws.onopen = () => console.log('✅ WebSocket connecté (Map2D)')
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'target') {
      const { x: lat, y: lon } = msg.data
      console.log('📡 Position reçue du robot :', lat, lon)

      // on attend que la carte soit initialisée
      const map = window.__map2d
      if (!map) return

      // crée le marqueur si pas encore là
      if (!robotMarker) {
        robotMarker = L.marker([lat, lon], {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448594.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          })
        }).addTo(map)
      } else {
        // déplace le marqueur existant
        robotMarker.setLatLng([lat, lon])
      }

      // centre la vue sur le robot
      map.setView([lat, lon], map.getZoom())
    }
  }

  ws.onerror = err => console.error('❌ Erreur WebSocket Map2D:', err)
  ws.onclose = () => console.warn('🔌 WebSocket fermé')

  return () => ws.close()
}, [])



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

    ensureLibs().then(() => init(window.L, window.turf));

    function init(L, turf) {
      // Empêche la double init
      if (window.__map2d) return;

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

      // stocke les polylignes par femme
      const pathLayersByWoman = {};
      map.__pathsByWoman = pathLayersByWoman;

      // API publique pour dessiner un trajet depuis une liste d'IDs
      window.map2D_drawByNodeIds = (wid, nodeIds, color = "#c03") => {
        if (!nodeIds || nodeIds.length < 2) return;
        // Efface la précédente
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
                // IMPORTANT : même conversion que KmlExtrusions/Car → z = -y
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
                onNodeSelect && onNodeSelect(id);
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

          // Liaisons autorisées uniquement (même logique que la voiture)
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

          // Push vers la 3D : nœuds en repère 3D (x, z = -y), + liens filtrés
          if (onMapReady && originA && toLocal) {
            onMapReady({
              nodes: allNodes.map(n => {
                const v = toLocal(n.lat, n.lon); // {x, y}
                return { id: n.id, x: v.x, z: -v.y }; // repère 3D
              }),
              links: allLinks
            });
          }

          // Appel depuis bouton APPEL (voitue)
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
              onPathReady && onPathReady(path3D);
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
  }, [onPathReady, onMapReady,onNodeSelect]);

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
