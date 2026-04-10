import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { createGeoConverter } from "./utils/geo";

export function Map2D({ onPathReady, onMapReady, onNodeSelect, robotLocal3D }) {
  const cbRef = useRef({ onPathReady, onMapReady, onNodeSelect });

  useEffect(() => {
    cbRef.current = { onPathReady, onMapReady, onNodeSelect };
  }, [onPathReady, onMapReady, onNodeSelect]);

  const wsRef = useRef(null);
  const wsStateRef = useRef({
    retry: 0,
    hbTimer: null,
    idleTimer: null,
    boundKeydown: false,
  });

  const pendingAppelRef = useRef(false);
  const lastAppelTsRef = useRef(null);

  // ------------------------------------------------
  // Heartbeat WS
  // ------------------------------------------------
  function startHeartbeat(ws) {
    const sendPing = () => {
      try {
        ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
      } catch {}
    };

    wsStateRef.current.hbTimer = setInterval(sendPing, 20000);

    const resetIdleTimer = () => {
      if (wsStateRef.current.idleTimer) clearTimeout(wsStateRef.current.idleTimer);
      wsStateRef.current.idleTimer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
      }, 45000);
    };

    resetIdleTimer();
    return resetIdleTimer;
  }

  function clearHeartbeat() {
    if (wsStateRef.current.hbTimer) {
      clearInterval(wsStateRef.current.hbTimer);
      wsStateRef.current.hbTimer = null;
    }
    if (wsStateRef.current.idleTimer) {
      clearTimeout(wsStateRef.current.idleTimer);
      wsStateRef.current.idleTimer = null;
    }
  }

  function connectWS(onMessage) {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket("wss://sti2d.latelier22.fr/fiber-ws/");
    wsRef.current = ws;
    let resetIdleTimer = () => {};

    ws.onopen = () => {
      console.log("✅ WS ouverte");
      wsStateRef.current.retry = 0;
      clearHeartbeat();
      resetIdleTimer = startHeartbeat(ws);

      try {
        ws.send(JSON.stringify({ type: "hello", client: "map2d" }));
      } catch {}
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

  // ------------------------------------------------
  // Nettoyage carte
  // ------------------------------------------------
  function softReset(map) {
    if (!map) return;

    if (map.__pathsByWoman) {
      Object.values(map.__pathsByWoman).forEach((l) => {
        try { map.removeLayer(l); } catch {}
      });
      map.__pathsByWoman = {};
    }

    if (map.__lastPathLayer) {
      try { map.removeLayer(map.__lastPathLayer); } catch {}
      map.__lastPathLayer = null;
    }

    if (map.__robotLiveMarker) {
      try { map.removeLayer(map.__robotLiveMarker); } catch {}
      map.__robotLiveMarker = null;
    }

    if (map.__robotLiveTrail) {
      try { map.removeLayer(map.__robotLiveTrail); } catch {}
      map.__robotLiveTrail = null;
    }

    if (map.__targetMarker) {
      try { map.removeLayer(map.__targetMarker); } catch {}
      map.__targetMarker = null;
    }

    try { map.off(); } catch {}

    map.__selectedNode = null;
    map.__startNodeId = "A";
    map.__allNodes = [];
    map.__allLinks = [];
    map.__obstacles = [];
    map.__originA = null;
    map.__toLocal = null;

    delete window.callAppelFromButton;
    delete window.callReturnToBase;
  }

  // ------------------------------------------------
  // Initialisation
  // ------------------------------------------------
  useEffect(() => {
    const ensureLibs = async () => {
      const loaders = [];

      if (!window.L) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(new Promise((res) => {
          s.onload = res;
          document.head.appendChild(s);
        }));
      }

      if (!window.turf) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/@turf/turf@6/turf.min.js";
        loaders.push(new Promise((res) => {
          s.onload = res;
          document.head.appendChild(s);
        }));
      }

      await Promise.all(loaders);
    };

    let cleanup = () => {};

    ensureLibs().then(() => {
      const reuse = !!window.__map2d;
      init(window.L, window.turf, reuse);

      cleanup = () => {
        if (wsRef.current) {
          try {
            wsRef.current.onclose = null;
            wsRef.current.close();
          } catch {}
          wsRef.current = null;
        }
        clearHeartbeat();
        softReset(window.__map2d);
      };
    });

    return () => cleanup();
  }, []);

  // ------------------------------------------------
  // Si la position robot serveur arrive après init,
  // on calcule le nœud de départ le plus proche
  // ------------------------------------------------
  useEffect(() => {
    const map = window.__map2d;
    if (!map) return;
    if (!robotLocal3D) return;
    if (!map.__toLocal || !map.__allNodes?.length) return;

    const { lat, lon } = map.__toLocal.inv(robotLocal3D.x, -robotLocal3D.z);
    const nearest = findNearestNode(map, window.turf, lat, lon);

    if (nearest) {
      map.__startNodeId = nearest.id;
      console.log("[Map2D] startNodeId depuis position serveur =", nearest.id);
    }
  }, [robotLocal3D]);

  // ------------------------------------------------
  // Helper nearest node
  // ------------------------------------------------
  function findNearestNode(map, turf, lat, lon) {
    const allNodes = map.__allNodes || [];
    let nearest = null;
    let min = Infinity;

    allNodes.forEach((n) => {
      const d = turf.distance([lon, lat], [n.lon, n.lat]);
      if (d < min) {
        min = d;
        nearest = n;
      }
    });

    return nearest;
  }

  // ------------------------------------------------
  // Fonction principale d'init
  // ------------------------------------------------
  function init(L, turf, reuse = false) {
    let map = window.__map2d;

    if (!reuse || !map) {
      map = L.map("map2d", { preferCanvas: true }).setView([48.185, -2.758], 19);
      window.__map2d = map;

      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "© OSM France",
        maxZoom: 20,
      }).addTo(map);
    } else {
      softReset(map);
    }

    map.__pathsByWoman = map.__pathsByWoman || {};
    map.__selectedNode = null;
    map.__startNodeId = "A";

    map.__robotLiveMarker = null;
    map.__robotLiveTrail = null;
    map.__robotLiveTrailCoords = [];
    map.__targetMarker = null;

    map.__allNodes = [];
    map.__allLinks = [];
    map.__obstacles = [];
    map.__originA = null;
    map.__toLocal = null;

    const allNodes = map.__allNodes;
    const allLinks = map.__allLinks;
    const obstacles = map.__obstacles;

    const nodeName = (i) => {
      let s = "";
      while (i >= 0) {
        s = String.fromCharCode(65 + (i % 26)) + s;
        i = Math.floor(i / 26) - 1;
      }
      return s;
    };

    fetch(process.env.PUBLIC_URL + "/lycee.kml")
      .then((r) => r.text())
      .then((txt) => {
        const xml = new DOMParser().parseFromString(txt, "text/xml");
        const placemarks = xml.querySelectorAll("Placemark");

        // --------------------------------------------
        // Lecture KML : points + obstacles
        // --------------------------------------------
        placemarks.forEach((pm) => {
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

            const cm = L.circleMarker([lat, lon], {
              radius: 6,
              color: "black",
              fillColor: "orange",
              fillOpacity: 0.9,
            }).addTo(map);

            cm.bindTooltip(id);

            cm.on("click", () => {
              map.__selectedNode = id;

              // IMPORTANT :
              // le calcul ne part plus de A en dur,
              // mais du nœud de départ actuel du robot.
              const start = map.__startNodeId || "A";
              const path = dijkstra(start, id);

              highlightPath(path);

              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(id);

              if (pendingAppelRef.current) {
                pendingAppelRef.current = false;
                triggerAppel();
              }
            });

            allNodes.push({ id, lat, lon });
          }

          if (poly) {
            const coords = poly.textContent.trim().split(/\s+/).map((c) => {
              const [lo, la] = c.split(",").map(Number);
              return [la, lo];
            });

            let color = "gray";
            let fill = "lightgray";

            if (name === "" || name.toLowerCase().includes("sans titre")) {
              color = "green";
              fill = "lightgreen";
            } else if (name.toLowerCase().includes("bat")) {
              color = "blue";
              fill = "lightblue";
            }

            L.polygon(coords, {
              color,
              fillColor: fill,
              fillOpacity: 0.5,
            }).addTo(map);

            obstacles.push(coords);
          }
        });

        // --------------------------------------------
        // Construction du graphe
        // --------------------------------------------
        for (let i = 0; i < allNodes.length; i++) {
          for (let j = i + 1; j < allNodes.length; j++) {
            const n1 = allNodes[i];
            const n2 = allNodes[j];

            const line = turf.lineString([
              [n1.lon, n1.lat],
              [n2.lon, n2.lat],
            ]);

            let interdit = false;

            obstacles.forEach((coords) => {
              const poly = turf.polygon([coords.map(([la, lo]) => [lo, la])]);
              if (turf.lineIntersect(line, poly).features.length > 0) {
                interdit = true;
              }
            });

            if (interdit) continue;

            const dist = turf.distance([n1.lon, n1.lat], [n2.lon, n2.lat]) * 1000;
            allLinks.push({ from: n1.id, to: n2.id, dist });
          }
        }


        // ------------------------------------------------
        // Retour vers la base A
        // ------------------------------------------------
        // Ici on ne fait plus un simple reverse du dernier chemin.
        // On recalcule un vrai chemin :
        //   départ = position actuelle du robot (convertie en nœud proche)
        //   arrivée = A
        function triggerReturnToBase() {
          const start = map.__startNodeId || "A";
          const end = "A";

          // Si le robot est déjà à la base, rien à faire
          if (start === end) {
            console.log("[Map2D] RETURN : déjà à la base A");
            return;
          }

          const ids = dijkstra(start, end);

          // Si jamais aucun chemin n'est trouvé
          if (!ids || ids.length < 2) {
            console.warn("[Map2D] RETURN : aucun chemin trouvé vers A", { start, end, ids });
            alert("⚠️ Aucun chemin trouvé vers la base A");
            return;
          }

          // Affichage du chemin sur la carte 2D
          highlightPath(ids);

          // Conversion du chemin en points 3D pour la voiture
          const path3D = ids.map((id) => nodeTo3D(id));

          // Envoi du chemin au composant parent
          cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);

          // On met aussi la destination sélectionnée sur A
          map.__selectedNode = "A";
          cbRef.current.onNodeSelect && cbRef.current.onNodeSelect("A");

          console.log("[Map2D] RETURN vers A", { start, end, ids });
        }


        // --------------------------------------------
        // Dijkstra : chemin entre nœud start et nœud end
        // --------------------------------------------
        function dijkstra(start, end) {
          const dist = {};
          const prev = {};
          const Q = new Set(allNodes.map((n) => n.id));

          allNodes.forEach((n) => {
            dist[n.id] = Infinity;
          });

          dist[start] = 0;

          while (Q.size > 0) {
            let u = [...Q].reduce((a, b) => (dist[a] < dist[b] ? a : b));
            Q.delete(u);

            if (u === end) break;

            allLinks
              .filter((l) => l.from === u || l.to === u)
              .forEach((l) => {
                const v = l.from === u ? l.to : l.from;
                if (!Q.has(v)) return;

                const alt = dist[u] + l.dist;
                if (alt < dist[v]) {
                  dist[v] = alt;
                  prev[v] = u;
                }
              });
          }

          const path = [];
          for (let u = end; u; u = prev[u]) {
            path.unshift(u);
          }

          return path;
        }

        // --------------------------------------------
        // Affichage d'un chemin 2D
        // --------------------------------------------
        function highlightPath(path) {
          if (map.__lastPathLayer) {
            try { map.removeLayer(map.__lastPathLayer); } catch {}
            map.__lastPathLayer = null;
          }

          if (!path || path.length < 2) return;

          const latlngs = path.map((id) => {
            const n = allNodes.find((nn) => nn.id === id);
            return [n.lat, n.lon];
          });

          map.__lastPathLayer = L.polyline(latlngs, {
            color: "orange",
            weight: 4,
          }).addTo(map);
        }

        // --------------------------------------------
        // Conversion nœud -> point 3D
        // --------------------------------------------
        function nodeTo3D(id) {
          const n = allNodes.find((nn) => nn.id === id);
          if (!n || !map.__toLocal) return { x: 0, z: 0 };

          const v = map.__toLocal(n.lat, n.lon);
          return { x: v.x, z: -v.y };
        }


        


        // --------------------------------------------
        // Calcul du trajet complet
        // --------------------------------------------
        function triggerAppel() {
          const start = map.__startNodeId || "A";
          const end = map.__selectedNode;

          if (!end) {
            alert("⚠️ Aucun nœud sélectionné !");
            return;
          }

          const ids = dijkstra(start, end);
          const path3D = ids.map((id) => nodeTo3D(id));

          cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);

          console.log("[Map2D] trajet calculé", { start, end, ids });
        }

        window.callAppelFromButton = triggerAppel;


        window.callReturnToBase = triggerReturnToBase;

        // --------------------------------------------
        // Exposition des fonctions mapData
        // --------------------------------------------
        if (cbRef.current.onMapReady && map.__originA && map.__toLocal) {
          const toGeo = (X, Z) => {
            const v = map.__toLocal.inv(X, -Z);
            return { lat: v.lat, lon: v.lon };
          };

          const toLocal = (lat, lon) => map.__toLocal(lat, lon);

          cbRef.current.onMapReady({
            nodes: allNodes.map((n) => {
              const v = map.__toLocal(n.lat, n.lon);
              return { id: n.id, x: v.x, z: -v.y };
            }),
            links: allLinks,
            toGeo,
            toLocal,
            origin: map.__originA,
          });
        }

        // --------------------------------------------
        // Si on a déjà une position robot connue,
        // on initialise le startNode immédiatement.
        // --------------------------------------------
        if (robotLocal3D && map.__toLocal) {
          const { lat, lon } = map.__toLocal.inv(robotLocal3D.x, -robotLocal3D.z);
          const nearest = findNearestNode(map, turf, lat, lon);

          if (nearest) {
            map.__startNodeId = nearest.id;
            console.log("[Map2D] startNodeId initial =", nearest.id);
          }
        }

        // --------------------------------------------
        // WebSocket : appel / target / robot
        // --------------------------------------------
        connectWS((msg) => {
          if (msg.type === "appel") {
            const t = Number(msg.data?.t || msg.data?.time || Date.now());

            if (lastAppelTsRef.current && t <= lastAppelTsRef.current) return;
            lastAppelTsRef.current = t;

            if (!map.__selectedNode) {
              pendingAppelRef.current = true;
            } else {
              triggerAppel();
            }
            return;
          }

          // D) RETURN : retour à la base A demandé par le serveur
          if (msg.type === "return") {
            const t = Number(msg.data?.t || msg.data?.time || Date.now());

            // Évite de traiter deux fois le même return
            if (lastAppelTsRef.current && t <= lastAppelTsRef.current) return;
            lastAppelTsRef.current = t;

            triggerReturnToBase();
            return;
          }

          if (msg.type === "target") {
            const { x: lat, y: lon } = msg.data || {};
            if (typeof lat !== "number" || typeof lon !== "number") return;

            if (!map.__targetMarker) {
              map.__targetMarker = L.marker([lat, lon], {
                icon: L.icon({
                  iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
                  iconSize: [28, 28],
                  iconAnchor: [14, 14],
                }),
              }).addTo(map);
            } else {
              map.__targetMarker.setLatLng([lat, lon]);
            }

            // La destination réelle est convertie en nœud le plus proche
            const endNearest = findNearestNode(map, turf, lat, lon);

            if (endNearest) {
              map.__selectedNode = endNearest.id;

              const start = map.__startNodeId || "A";
              const path = dijkstra(start, endNearest.id);

              highlightPath(path);
              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(endNearest.id);

              if (pendingAppelRef.current) {
                pendingAppelRef.current = false;
                triggerAppel();
              }
            }
            return;
          }

          if (msg.type === "robot") {
            const { x: lat, y: lon } = msg.data || {};
            if (typeof lat !== "number" || typeof lon !== "number") return;

            const ll = L.latLng(lat, lon);

            if (!map.__robotLiveMarker) {
              map.__robotLiveMarker = L.marker(ll, {
                icon: L.icon({
                  iconUrl: "https://cdn-icons-png.flaticon.com/512/3448/3448594.png",
                  iconSize: [32, 32],
                  iconAnchor: [16, 16],
                }),
              }).addTo(map);

              map.__robotLiveTrailCoords = [ll];
              map.__robotLiveTrail = L.polyline(map.__robotLiveTrailCoords, {
                weight: 3,
                opacity: 0.85,
              }).addTo(map);
            } else {
              map.__robotLiveMarker.setLatLng(ll);
              map.__robotLiveTrailCoords.push(ll);
              map.__robotLiveTrail.setLatLngs(map.__robotLiveTrailCoords.slice(-800));
            }

            // Très important :
            // le nœud de départ évolue avec la position réelle du robot
            const nearest = findNearestNode(map, turf, lat, lon);
            if (nearest && map.__startNodeId !== nearest.id) {
              map.__startNodeId = nearest.id;
              console.log("[Map2D] startNodeId mis à jour =", nearest.id);
            }

            return;
          }
        });

        if (!wsStateRef.current.boundKeydown) {
          window.addEventListener("keydown", (e) => {
            if (e.code === "Space" || e.key === " ") {
              triggerAppel();
            }
          });
          wsStateRef.current.boundKeydown = true;
        }
      });
  }

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}