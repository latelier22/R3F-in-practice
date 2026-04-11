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

  const lastEventTsRef = useRef(null);

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

  function softReset(map) {
    if (!map) return;

    if (map.__lastPathLayer) {
      try {
        map.removeLayer(map.__lastPathLayer);
      } catch {}
      map.__lastPathLayer = null;
    }

    if (map.__robotLiveMarker) {
      try {
        map.removeLayer(map.__robotLiveMarker);
      } catch {}
      map.__robotLiveMarker = null;
    }

    if (map.__robotLiveTrail) {
      try {
        map.removeLayer(map.__robotLiveTrail);
      } catch {}
      map.__robotLiveTrail = null;
    }

    if (map.__targetMarker) {
      try {
        map.removeLayer(map.__targetMarker);
      } catch {}
      map.__targetMarker = null;
    }

    try {
      map.off();
    } catch {}

    map.__selectedNode = null;
    map.__allNodes = [];
    map.__allLinks = [];
    map.__originA = null;
    map.__toLocal = null;
    map.__robotLiveTrailCoords = [];
    map.__robotLastGeo = null;
    map.__debugNearestNode = null;

    delete window.callAppelFromButton;
    delete window.callReturnToBase;
  }

  function findNearestNode(map, turf, lat, lon) {
    const allNodes = map.__allNodes || [];
    let nearest = null;
    let min = Infinity;

    allNodes.forEach((n) => {
      const d = turf.distance([lon, lat], [n.lon, n.lat], {
        units: "kilometers",
      });
      if (d < min) {
        min = d;
        nearest = n;
      }
    });

    return nearest;
  }

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

    map.__selectedNode = null;
    map.__lastPathLayer = null;
    map.__robotLiveMarker = null;
    map.__robotLiveTrail = null;
    map.__robotLiveTrailCoords = [];
    map.__targetMarker = null;
    map.__allNodes = [];
    map.__allLinks = [];
    map.__originA = null;
    map.__toLocal = null;
    map.__robotLastGeo = null;
    map.__debugNearestNode = null;

    fetch("https://sti2d.latelier22.fr/fiber/api/graph", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok || !j?.graph) {
          throw new Error("graph_not_ready");
        }

        const graph = j.graph;

        map.__allNodes = graph.nodes || [];
        map.__allLinks = graph.links || [];
        map.__obstacles = graph.obstacles || [];

        map.__obstacles.forEach((obs) => {
          const coords = obs.coords.map(([lon, lat]) => [lat, lon]);

          let color = "gray";
          let fill = "lightgray";

          const name = (obs.name || "").toLowerCase();

          if (name.includes("sans titre") || name === "") {
            color = "green";
            fill = "lightgreen";
          } else if (name.includes("bat")) {
            color = "blue";
            fill = "lightblue";
          }

          L.polygon(coords, {
            color,
            fillColor: fill,
            fillOpacity: 0.5,
          }).addTo(map);
        });

        const allNodes = map.__allNodes;
        const allLinks = map.__allLinks;

        if (!allNodes.length) {
          throw new Error("graph_nodes_empty");
        }

        const originNode = allNodes.find((n) => n.id === "A") || allNodes[0];
        map.__originA = { lat: originNode.lat, lon: originNode.lon };
        map.__toLocal = createGeoConverter(originNode.lat, originNode.lon, 0.05);

        function dijkstraWithCost(start, end) {
          const dist = {};
          const prev = {};
          const Q = new Set(allNodes.map((n) => n.id));

          allNodes.forEach((n) => {
            dist[n.id] = Infinity;
          });
          dist[start] = 0;

          while (Q.size > 0) {
            let u = null;
            let best = Infinity;

            for (const id of Q) {
              if (dist[id] < best) {
                best = dist[id];
                u = id;
              }
            }

            if (!u) break;
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
          if (dist[end] !== Infinity) {
            for (let u = end; u; u = prev[u]) {
              path.unshift(u);
            }
          }

          return {
            path,
            cost: dist[end],
          };
        }

        function highlightPath(path) {
          if (map.__lastPathLayer) {
            try {
              map.removeLayer(map.__lastPathLayer);
            } catch {}
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

        function nodeTo3D(id) {
          const n = allNodes.find((nn) => nn.id === id);
          if (!n || !map.__toLocal) return { x: 0, z: 0 };

          const v = map.__toLocal(n.lat, n.lon);
          return { x: v.x, z: -v.y };
        }

        function getRobotGeoNow() {
          if (map.__robotLiveMarker) {
            const ll = map.__robotLiveMarker.getLatLng();
            return { lat: ll.lat, lon: ll.lng };
          }

          if (map.__robotLastGeo) {
            return map.__robotLastGeo;
          }

          return null;
        }

        function findSnapNode(mapObj, turfObj, lat, lon, snapMeters = 0.8) {
          let best = null;
          let bestMeters = Infinity;

          for (const n of mapObj.__allNodes || []) {
            const dKm = turfObj.distance([lon, lat], [n.lon, n.lat], {
              units: "kilometers",
            });
            const dMeters = dKm * 1000;

            if (dMeters < bestMeters) {
              bestMeters = dMeters;
              best = n;
            }
          }

          if (best && bestMeters <= snapMeters) {
            return { node: best, distanceMeters: bestMeters };
          }

          return null;
        }

        function findNearestCandidates(mapObj, turfObj, lat, lon, limit = 4) {
          return (mapObj.__allNodes || [])
            .map((n) => ({
              node: n,
              dKm: turfObj.distance([lon, lat], [n.lon, n.lat], {
                units: "kilometers",
              }),
            }))
            .sort((a, b) => a.dKm - b.dKm)
            .slice(0, limit);
        }

        function chooseBestStartNode(mapObj, turfObj, lat, lon, endId) {
          const candidates = findNearestCandidates(mapObj, turfObj, lat, lon, 4);

          let best = null;

          for (const c of candidates) {
            const dj = dijkstraWithCost(c.node.id, endId);
            if (!dj.path.length || !Number.isFinite(dj.cost)) continue;

            const robotToNodeMeters = c.dKm * 1000;
            const totalCost = robotToNodeMeters + dj.cost;

            if (!best || totalCost < best.totalCost) {
              best = {
                startId: c.node.id,
                totalCost,
                robotToNodeMeters,
                graphCost: dj.cost,
                path: dj.path,
              };
            }
          }

          return best;
        }

        function computeBestPathTo(endId) {
          const robotGeo = getRobotGeoNow();

          if (
            robotGeo &&
            typeof robotGeo.lat === "number" &&
            typeof robotGeo.lon === "number"
          ) {
            const snapped = findSnapNode(map, turf, robotGeo.lat, robotGeo.lon, 0.8);

            if (snapped?.node) {
              const snappedId = snapped.node.id;

              if (snappedId === endId) {
                return {
                  start: snappedId,
                  ids: [snappedId],
                  meta: {
                    snapped: true,
                    distanceMeters: snapped.distanceMeters,
                    alreadyAtTarget: true,
                  },
                };
              }

              const dj = dijkstraWithCost(snappedId, endId);

              return {
                start: snappedId,
                ids: dj.path,
                meta: {
                  snapped: true,
                  distanceMeters: snapped.distanceMeters,
                  graphCost: dj.cost,
                },
              };
            }

            const best = chooseBestStartNode(map, turf, robotGeo.lat, robotGeo.lon, endId);

            if (best?.path?.length) {
              return {
                start: best.startId,
                ids: best.path,
                meta: best,
              };
            }
          }

          const fallbackStart = allNodes[0]?.id || "A";
          const fallback = dijkstraWithCost(fallbackStart, endId);

          return {
            start: fallbackStart,
            ids: fallback.path,
            meta: null,
          };
        }

        function triggerAppel() {
          const end = map.__selectedNode;

          if (!end) {
            alert("⚠️ Aucun nœud sélectionné !");
            return;
          }

          const result = computeBestPathTo(end);

          if (result.meta?.alreadyAtTarget) {
            console.log("[Map2D] déjà sur la cible", result);
            highlightPath(null);
            return;
          }

          if (!result.ids || result.ids.length < 2) {
            alert("⚠️ Aucun chemin trouvé");
            return;
          }

          const path3D = result.ids.map((id) => nodeTo3D(id));

          highlightPath(result.ids);
          cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);

          console.log("[Map2D] trajet calculé", {
            start: result.start,
            end,
            ids: result.ids,
            meta: result.meta,
          });
        }

        function triggerReturnToBase() {
          const end = "A";
          const result = computeBestPathTo(end);

          if (result.meta?.alreadyAtTarget) {
            console.log("[Map2D] déjà à la base A", result);
            map.__selectedNode = "A";
            cbRef.current.onNodeSelect && cbRef.current.onNodeSelect("A");
            highlightPath(null);
            return;
          }

          if (!result.ids || result.ids.length < 2) {
            console.warn("[Map2D] RETURN : aucun chemin trouvé vers A", result);
            alert("⚠️ Aucun chemin trouvé vers la base A");
            return;
          }

          highlightPath(result.ids);

          const path3D = result.ids.map((id) => nodeTo3D(id));
          cbRef.current.onPathReady && cbRef.current.onPathReady(path3D);

          map.__selectedNode = "A";
          cbRef.current.onNodeSelect && cbRef.current.onNodeSelect("A");

          console.log("[Map2D] RETURN vers A", {
            start: result.start,
            end,
            ids: result.ids,
            meta: result.meta,
          });
        }

        allNodes.forEach((n) => {
          const cm = L.circleMarker([n.lat, n.lon], {
            radius: 6,
            color: "black",
            fillColor: "orange",
            fillOpacity: 0.9,
          }).addTo(map);

          cm.bindTooltip(n.id);

          cm.on("click", () => {
            map.__selectedNode = n.id;

            const result = computeBestPathTo(n.id);
            if (result.meta?.alreadyAtTarget) {
              highlightPath(null);
            } else {
              highlightPath(result.ids);
            }

            cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(n.id);

            console.log("[Map2D] prévisualisation trajet", {
              start: result.start,
              end: n.id,
              ids: result.ids,
              meta: result.meta,
            });
          });
        });

        window.callAppelFromButton = triggerAppel;
        window.callReturnToBase = triggerReturnToBase;

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

        if (robotLocal3D && map.__toLocal) {
          const { lat, lon } = map.__toLocal.inv(robotLocal3D.x, -robotLocal3D.z);
          map.__robotLastGeo = { lat, lon };

          const nearest = findNearestNode(map, turf, lat, lon);
          if (nearest) {
            map.__debugNearestNode = nearest.id;
            console.log("[Map2D] nearest initial debug =", nearest.id);
          }
        }

        connectWS((msg) => {
          if (msg.type === "appel") {
            const t = Number(msg.data?.t || msg.data?.time || Date.now());

            if (lastEventTsRef.current && t <= lastEventTsRef.current) return;
            lastEventTsRef.current = t;

            if (map.__selectedNode) {
              triggerAppel();
            } else {
              console.warn("[Map2D] appel reçu mais aucun nœud sélectionné");
            }
            return;
          }

          if (msg.type === "return") {
            const t = Number(msg.data?.t || msg.data?.time || Date.now());

            if (lastEventTsRef.current && t <= lastEventTsRef.current) return;
            lastEventTsRef.current = t;

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

            const endNearest = findNearestNode(map, turf, lat, lon);

            if (endNearest) {
              map.__selectedNode = endNearest.id;
              cbRef.current.onNodeSelect && cbRef.current.onNodeSelect(endNearest.id);
              triggerAppel();
            }
            return;
          }

          if (msg.type === "robot") {
            const { x: lat, y: lon } = msg.data || {};
            if (typeof lat !== "number" || typeof lon !== "number") return;

            map.__robotLastGeo = { lat, lon };

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

            const nearest = findNearestNode(map, turf, lat, lon);
            if (nearest) {
              map.__debugNearestNode = nearest.id;
            }
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
      })
      .catch((e) => {
        console.error("❌ /api/graph error", e);
      });
  }

  useEffect(() => {
    const ensureLibs = async () => {
      const loaders = [];

      if (!window.L) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        loaders.push(
          new Promise((res) => {
            s.onload = res;
            document.head.appendChild(s);
          })
        );
      }

      if (!window.turf) {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/@turf/turf@6/turf.min.js";
        loaders.push(
          new Promise((res) => {
            s.onload = res;
            document.head.appendChild(s);
          })
        );
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

  useEffect(() => {
    const map = window.__map2d;
    if (!map) return;
    if (!robotLocal3D) return;
    if (!map.__toLocal || !window.turf) return;

    const { lat, lon } = map.__toLocal.inv(robotLocal3D.x, -robotLocal3D.z);
    map.__robotLastGeo = { lat, lon };

    const nearest = findNearestNode(map, window.turf, lat, lon);
    if (nearest) {
      map.__debugNearestNode = nearest.id;
      console.log("[Map2D] nearest debug depuis position serveur =", nearest.id);
    }
  }, [robotLocal3D]);

  return <div id="map2d" style={{ width: "100%", height: "100%" }} />;
}