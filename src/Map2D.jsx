/* global L, turf */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { createGeoConverter } from "./utils/geo";

const ALLOW_AUTO_SNAP = false; // si true: affiche un chemin "guide" au plus proche tant que l'utilisateur n'a rien choisi

export function Map2D({ onPathReady, onMapReady, onNodeSelect }) {
  const cbRef = useRef({ onPathReady, onMapReady, onNodeSelect });
  useEffect(() => { cbRef.current = { onPathReady, onMapReady, onNodeSelect }; }, [onPathReady, onMapReady, onNodeSelect]);

  const wsRef = useRef(null);
  const wsStateRef = useRef({ retry: 0, hbTimer: null, idleTimer: null, boundKeydown: false });

  useEffect(() => {
    const ensureLibs = async () => {
      const loaders = [];
      if (!window.L) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
      }
      if (!window.turf) {
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
        if (wsRef.current) {
          try { wsRef.current.onclose = null; wsRef.current.close(); } catch {}
          wsRef.current = null;
        }
        clearHeartbeat();
        softReset(window.__map2d);
      };
    });

    return () => cleanup();
  }, []);

  // ---------------- WS utils (reconnexion + heartbeat) ----------------
  function startHeartbeat(ws) {
    const sendPing = () => { try { ws.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {} };
    wsStateRef.current.hbTimer = setInterval(sendPing, 20000);
    const resetIdleTimer = () => {
      if (wsStateRef.current.idleTimer) clearTimeout(wsStateRef.current.idleTimer);
      wsStateRef.current.idleTimer = setTimeout(() => { try { ws.close(); } catch {} }, 45000);
    };
    resetIdleTimer();
    return resetIdleTimer;
  }
  function clearHeartbeat() {
    if (wsStateRef.current.hbTimer) { clearInterval(wsStateRef.current.hbTimer); wsStateRef.current.hbTimer = null; }
    if (wsStateRef.current.idleTimer) { clearTimeout(wsStateRef.current.idleTimer); wsStateRef.current.idleTimer = null; }
  }
  function connectWS(onMessage) {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket("wss://sti2d.latelier22.fr/fiber-ws/");
    wsRef.current = ws;
    let resetIdleTimer = () => {};

    ws.onopen = () => {
      console.log("✅ WS ouverte");
      wsStateRef.current.retry = 0;
      clearHeartbeat();
      resetIdleTimer = startHeartbeat(ws);
      try { ws.send(JSON.stringify({ type: "hello", client: "map2d" })); } catch {}
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== "pong") onMessage(msg);
      } catch {}
      resetIdleTimer();
    };
    ws.onerror = (err) => console.warn("❌ WS erreur", err);
    ws.onclose = () => {
      console.warn("🔌 WS fermée");
      clearHeartbeat();
      const n = Math.min(10000, 500 * Math.pow(2, wsStateRef.current.retry++));
      setTimeout(() => connectWS(onMessage), n);
    };
  }

  // ---------------- SOFT RESET ----------------
  function softReset(map) {
    if (!map) return;
    if (map.__pathsByWoman) {
      Object.values(map.__pathsByWoman).forEach(l => { try { map.removeLayer(l); } catch {} });
      map.__pathsByWoman = {};
    }
    if (map.__lastPathLayer) { try { map.removeLayer(map.__lastPathLayer); } catch {} map.__lastPathLayer = null; }
    if (map.__robotMarker) { try { map.removeLayer(map.__robotMarker); } catch {} map.__robotMarker = null; }

    try { map.off(); } catch {}

    map.__selectedNode = null;
    map.__userSelected = false;
    map.__allNodes = [];
    map.__allLinks = [];
    map.__obstacles = [];
    map.__extrusionsData = [];
    map.__originA = null;
    map.__toLocal = null;

    delete window.map2D_drawByNodeIds;
    delete window.callAppelFromButton;
  }

  // ---------------- INIT ----------------
  function init(L, turf, reuse = false) {
    let map = window.__map2d;
    if (!reuse || !map) {
      map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
      window.__map2d = map;
      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "© OSM France", maxZoom: 20,
      }).addTo(map);
    } else {
      softReset(map);
    }

    map.__pathsByWoman = map.__pathsByWoman || {};
    map.__selectedNode = null;
    map.__userSelected = false;
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

    const nodeName = (i) => { let s = ""; while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } return s; };

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
              map.__userSelected = true; // <-- sélection par l’utilisateur
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
            if (name === "" || name.toLowerCase().includes("sans titre")) { color = "green"; fill = "lightgreen"; type = "pelouse"; }
            else if (name.toLowerCase().includes("bat")) { color = "blue"; fill = "lightblue"; type = "bat"; }
            L.polygon(coords, { color, fillColor: fill, fillOpacity: 0.5 }).addTo(map);
            obstacles.push(coords);
            extrusionsData.push({ coords, type });
          }
        });

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
          if (map.__lastPathLayer) { try { map.removeLayer(map.__lastPathLayer); } catch {} map.__lastPathLayer = null; }
          if (!path.length) return;
          const latlngs = path.map(id => {
            const n = allNodes.find(nn => nn.id === id);
            return [n.lat, n.lon];
          });
          map.__lastPathLayer = L.polyline(latlngs, { color: "orange", weight: 4 }).addTo(map);
        }

        const findNearestNode = (lat, lon) => {
          let nearest = null, min = Infinity;
          allNodes.forEach(n => {
            const d = turf.distance([lon, lat], [n.lon, n.lat]);
            if (d < min) { min = d; nearest = n; }
          });
          return nearest;
        };

        // WS: on ne sélectionne JAMAIS depuis la socket.
        connectWS((msg) => {
          if (msg.type === "target") {
            const { x: lat, y: lon } = msg.data;

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

            // Optionnel: affichage guide sans sélectionner
            if (ALLOW_AUTO_SNAP && !map.__userSelected) {
              const nearest = findNearestNode(lat, lon);
              if (nearest) highlightRobotPath(dijkstra("A", nearest.id));
            }
          }
        });

        if (cbRef.current.onMapReady && map.__originA && map.__toLocal) {
          cbRef.current.onMapReady({
            nodes: allNodes.map(n => {
              const v = map.__toLocal(n.lat, n.lon);
              return { id: n.id, x: v.x, z: -v.y };
            }),
            links: allLinks
          });
        }

        function nodeTo3D(id) {
          const n = allNodes.find(nn => nn.id === id);
          if (!n || !map.__toLocal) return { x: 0, z: 0 };
          const v = map.__toLocal(n.lat, n.lon);
          return { x: v.x, z: -v.y };
        }

        function triggerAppel() {
          if (map.__selectedNode) {
            const ids = dijkstra("A", map.__selectedNode);
            const path3D = ids.map(id => nodeTo3D(id));
            cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);
          } else {
            alert("⚠️ Aucun nœud sélectionné !");
          }
        }

        window.callAppelFromButton = triggerAppel;
        if (!wsStateRef.current.boundKeydown) {
          window.addEventListener("keydown", (e) => {
            if ((e.code === "Space" || e.key === " ")) triggerAppel();
          });
          wsStateRef.current.boundKeydown = true;
        }
      });
  }

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}
