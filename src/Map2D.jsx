import "leaflet/dist/leaflet.css";
import { useEffect } from "react";

export function Map2D({ onPathReady }) {
  useEffect(() => {
    // Charge Leaflet + Turf via CDN si non présents
    const ensureLibs = async () => {
      const needLeaflet = typeof window.L === "undefined";
      const needTurf = typeof window.turf === "undefined";

      const loaders = [];
      if (needLeaflet) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
      }
      if (needTurf) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/@turf/turf@6/turf.min.js";
        loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
      }
      await Promise.all(loaders);
    };

    let map, pathLayer;

    const init = async () => {
      await ensureLibs();
      const L = window.L;
      const turf = window.turf;

      // --- Carte 2D
      map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "© OSM France",
        maxZoom: 20,
        crossOrigin: true
      }).addTo(map);

      // --- Données
      let allNodes = [];          // {id, lat, lon}
      let allLinks = [];          // {from,to,dist}
      let obstacles = [];         // [[ [lat,lon], ... ]]
      let selectedNode = null;    // id du nœud cliqué
      let originA = null;         // {lat,lon} de A (référence 3D)

      const nodeName = (i) => {
        let s = "";
        while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
        return s;
      };

      // --- Charge KML
      const txt = await fetch(process.env.PUBLIC_URL + "/lycee.kml").then(r => r.text());
      const xml = new DOMParser().parseFromString(txt, "text/xml");
      const placemarks = xml.querySelectorAll("Placemark");

      placemarks.forEach(pm => {
        const name = pm.querySelector("name")?.textContent || "";
        const point = pm.querySelector("Point>coordinates");
        const poly = pm.querySelector("Polygon>outerBoundaryIs>LinearRing>coordinates");

        if (point) {
          const [lon, lat] = point.textContent.trim().split(",").map(Number);
          const id = nodeName(allNodes.length);
          if (id === "A") originA = { lat, lon }; // A sera (0,0) en 3D

          const m = L.circleMarker([lat, lon], {
            radius: 6, color: "black", fillColor: "orange", fillOpacity: 0.9
          }).addTo(map);
          m.bindTooltip(id, { permanent: false, direction: "top" });
          m.on("click", () => {
            selectedNode = id;
            const path = dijkstra("A", id);
            highlightPath(path);
            // On n’envoie PAS encore à la 3D => seulement à l’espace
          });

          allNodes.push({ id, lat, lon });
        }

        if (poly) {
          const coords = poly.textContent.trim().split(/\s+/).map(c => {
            const [lon, lat] = c.split(",").map(Number);
            return [lat, lon];
          });

          // Fit sur "limites"
          if (name.toLowerCase().includes("limites")) {
            const b = L.latLngBounds(coords);
            map.fitBounds(b.pad(0.15));
          }

          // Classement visuel + ajout en obstacles
          let color = "gray", fill = "lightgray";
          if (name === "" || name.toLowerCase().includes("sans titre")) {
            color = "green"; fill = "lightgreen";   // pelouse
          } else if (name.toLowerCase().includes("bat")) {
            color = "blue"; fill = "lightblue";     // bâtiment
          }
          L.polygon(coords, { color, fillColor: fill, fillOpacity: 0.5 }).addTo(map);

          // Tous les polygones sont des obstacles à éviter
          obstacles.push(coords);
        }
      });

      // --- Construit le graphe (interdiction de traverser obstacles)
      for (let i = 0; i < allNodes.length; i++) {
        for (let j = i + 1; j < allNodes.length; j++) {
          const n1 = allNodes[i], n2 = allNodes[j];

          // Segment n1-n2
          const line = turf.lineString([[n1.lon, n1.lat], [n2.lon, n2.lat]]);

          // S’il coupe un obstacle → lien interdit
          let cutsObstacle = false;
          for (const coords of obstacles) {
            const poly = turf.polygon([coords.map(([lat, lon]) => [lon, lat])]);
            if (turf.lineIntersect(line, poly).features.length > 0) {
              cutsObstacle = true;
              break;
            }
          }
          if (cutsObstacle) continue;

          const dist = turf.distance([n1.lon, n1.lat], [n2.lon, n2.lat]) * 1000; // m
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

          allLinks
            .filter(l => l.from === u || l.to === u)
            .forEach(l => {
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

      // --- Helper : path 2D → polyline
      function highlightPath(path) {
        if (pathLayer) { map.removeLayer(pathLayer); pathLayer = null; }
        if (!path || path.length < 2) return;
        const latlngs = path.map(id => {
          const n = allNodes.find(nn => nn.id === id);
          return [n.lat, n.lon];
        });
        pathLayer = window.L.polyline(latlngs, { color: "orange", weight: 4 }).addTo(map);
      }

      // --- Conversion vers coordonnées 3D (A = 0,0)
      function nodeTo3D(id) {
        const n = allNodes.find(nn => nn.id === id);
        if (!n || !originA) return { x: 0, z: 0 };
        const dx = (n.lon - originA.lon) * 10000;   // échelle à ajuster si besoin
        const dz = -(n.lat - originA.lat) * 10000;   // idem
        return { x: dx, z: dz };
      }

      // --- Espace = "appel robot" => envoie le chemin 3D au Car
      const onKey = (e) => {
        if (e.code === "Space" && selectedNode) {
          const path = dijkstra("A", selectedNode);
          highlightPath(path);
          const pts = path.map(id => nodeTo3D(id));
          onPathReady(pts); // <-- pousse à la 3D
        }
      };
      window.addEventListener("keydown", onKey);

      // cleanup
      return () => {
        window.removeEventListener("keydown", onKey);
        if (map) map.remove();
      };
    };

    const cleanupPromise = init();

    return () => {
      // si besoin, attendre le cleanup de init()
      if (cleanupPromise && typeof cleanupPromise.then === "function") {
        cleanupPromise.then((c) => { if (typeof c === "function") c(); });
      }
    };
  }, [onPathReady]);

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
