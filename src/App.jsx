import "./index.css";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/cannon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Scene } from "./Scene";
import { Map2D } from "./Map2D";

function makeLinkKey(a, b) {
  return [a, b].sort().join("|");
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;

  if (abLenSq <= 1e-9) {
    return Math.hypot(px - ax, pz - az);
  }

  let t = (apx * abx + apz * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

function computeImpactedLinkKeys(mapData, obstacle, extraClearance = 0.3) {
  if (!mapData?.links?.length || !mapData?.nodes?.length || !obstacle?.position) {
    return [];
  }

  const nodesById = new Map(mapData.nodes.map((node) => [node.id, node]));
  const impacted = new Set();
  const px = obstacle.position.x;
  const pz = obstacle.position.z;
  const primaryKey = obstacle.linkKey;

  for (const link of mapData.links) {
    const fromNode = nodesById.get(link.from);
    const toNode = nodesById.get(link.to);
    if (!fromNode || !toNode) continue;

    const linkKey = makeLinkKey(link.from, link.to);
    const distance = distancePointToSegment2D(
      px,
      pz,
      fromNode.x,
      fromNode.z,
      toNode.x,
      toNode.z
    );

    if (distance <= extraClearance) {
      impacted.add(linkKey);
    }
  }

  if (primaryKey) {
    impacted.add(primaryKey);
  }

  return Array.from(impacted);
}

export default function App() {
  const [pathPoints, setPathPoints] = useState([]);
  const [mapData, setMapData] = useState(null);
  const [robotGeo, setRobotGeo] = useState(null);
  const [robotLocal3D, setRobotLocal3D] = useState(null);

  const [routeInfo, setRouteInfo] = useState({
    nodeIds: [],
    targetId: null,
  });

  const [activeObstacle, setActiveObstacle] = useState(null);
  const [blockedLinks, setBlockedLinks] = useState([]);
  const blockedLinksRef = useRef([]);

  const [rerouteState, setRerouteState] = useState(null);
  // null | { phase: 'backtrack' | 'detour', resumeNodeId: string, targetId: string, blockedLinkKeys: string[] }

  const spawnObstacleEnabledRef = useRef(true);

  useEffect(() => {
    blockedLinksRef.current = blockedLinks;
  }, [blockedLinks]);

  const isMobile = window.innerWidth < 768;
  const isLandscape = window.innerWidth > window.innerHeight;

  const containerStyle = {
    display: "flex",
    flexDirection: isMobile ? (isLandscape ? "row" : "column") : "row",
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
  };

  const mapStyle = {
    flex: isMobile ? (isLandscape ? "0.5" : "0.4") : "0.35",
    height: isMobile ? (isLandscape ? "100%" : "40%") : "100%",
    minHeight: 220,
  };

  const sceneStyle = {
    flex: "1",
    position: "relative",
    background: "#000",
    minHeight: 260,
  };

  const buttonPanel = {
    position: "absolute",
    left: "50%",
    bottom: "12px",
    transform: "translateX(-50%)",
    display: "flex",
    gap: "10px",
    zIndex: 9999,
    pointerEvents: "auto",
  };

  const btn = {
    background: "#222",
    color: "white",
    border: "1px solid #555",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "14px",
    cursor: "pointer",
  };

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const r = await fetch("https://sti2d.latelier22.fr/fiber/api/robot-last", {
          cache: "no-store",
        });
        const j = await r.json();

        if (!alive) return;

        if (j?.ok && j?.robot && typeof j.robot.x === "number" && typeof j.robot.y === "number") {
          setRobotGeo({
            lat: j.robot.x,
            lon: j.robot.y,
            heading: typeof j.robot.heading === "number" ? j.robot.heading : null,
            time: j.robot.time ?? null,
          });
        }
      } catch (e) {
        console.log("[App] robot-last ERROR", String(e));
      }
    }

    tick();
    const id = setInterval(tick, 2000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!robotGeo) return;
    if (!mapData?.toLocal) return;

    const v = mapData.toLocal(robotGeo.lat, robotGeo.lon);
    setRobotLocal3D({ x: v.x, z: -v.y });
  }, [robotGeo, mapData]);

  const handleNodeSelect = useCallback((id) => {
    console.log("✅ Node sélectionné :", id);
    spawnObstacleEnabledRef.current = true;
    setActiveObstacle(null);
    setBlockedLinks([]);
    setRerouteState(null);
  }, []);

  const handlePathReady = useCallback(
    (payload) => {
      if (Array.isArray(payload)) {
        setPathPoints(payload);
        setRouteInfo({ nodeIds: [], targetId: null });
        return;
      }

      const pts = payload?.pathPoints || [];
      const nodeIds = payload?.nodeIds || [];
      const targetId = payload?.targetId || null;

      setPathPoints(pts);
      setRouteInfo({ nodeIds, targetId });

      if (rerouteState?.phase === "detour") {
        setRerouteState(null);
      }

      if (!mapData) return;
      if (!nodeIds || nodeIds.length < 2) return;
      if (!spawnObstacleEnabledRef.current) return;
      if (rerouteState) return;

      const minSegIdx = nodeIds.length >= 4 ? 1 : 0;
      const maxSegIdx = nodeIds.length - 2;
      if (maxSegIdx < minSegIdx) return;

      const segIdx = randInt(minSegIdx, maxSegIdx);
      const fromId = nodeIds[segIdx];
      const toId = nodeIds[segIdx + 1];
      const linkKey = makeLinkKey(fromId, toId);

      if (blockedLinksRef.current.includes(linkKey)) return;

      const fromNode = mapData.nodes.find((n) => n.id === fromId);
      const toNode = mapData.nodes.find((n) => n.id === toId);
      if (!fromNode || !toNode) return;

      setActiveObstacle({
        id: `${linkKey}-${Date.now()}`,
        fromId,
        toId,
        linkKey,
        clearance: 0.3,
        position: {
          x: fromNode.x + (toNode.x - fromNode.x) * 0.5,
          y: 0.18,
          z: fromNode.z + (toNode.z - fromNode.z) * 0.5,
        },
      });

      spawnObstacleEnabledRef.current = false;
    },
    [mapData, rerouteState]
  );

  const handleObstacleDetected = useCallback(
    (payload) => {
      if (!activeObstacle || !mapData || !routeInfo.targetId) return;

      const impactedKeys = computeImpactedLinkKeys(
        mapData,
        activeObstacle,
        activeObstacle.clearance ?? 0.3
      );

      const fallbackKeys = [payload?.blockedLinkKey, activeObstacle.linkKey].filter(Boolean);
      const blockedLinkKeys = Array.from(new Set([...impactedKeys, ...fallbackKeys]));

      setBlockedLinks((prev) => Array.from(new Set([...prev, ...blockedLinkKeys])));

      const prevNode = mapData.nodes.find((n) => n.id === activeObstacle.fromId);
      if (!prevNode) return;

      setRerouteState({
        phase: "backtrack",
        resumeNodeId: activeObstacle.fromId,
        targetId: routeInfo.targetId,
        blockedLinkKeys,
      });

      // Retour physique vers le nœud précédent AVANT le nouveau Dijkstra.
      setPathPoints([{ x: prevNode.x, z: prevNode.z }]);
      spawnObstacleEnabledRef.current = false;
    },
    [activeObstacle, mapData, routeInfo.targetId]
  );

  const handleCarPathComplete = useCallback(() => {
    setRerouteState((prev) => {
      if (!prev) return prev;
      if (prev.phase === "backtrack") {
        return { ...prev, phase: "detour" };
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (rerouteState?.phase !== "detour") return;

    const id = requestAnimationFrame(() => {
      setTimeout(() => {
        window.callAppelFromButton?.();
      }, 0);
    });

    return () => cancelAnimationFrame(id);
  }, [rerouteState?.phase, blockedLinks.join("|")]);

  const handleResetObstacles = useCallback(() => {
    setActiveObstacle(null);
    setBlockedLinks([]);
    setRerouteState(null);
    spawnObstacleEnabledRef.current = true;
  }, []);

  const handleRetour = () => {
    if (typeof window.callReturnToBase === "function") {
      window.callReturnToBase();
    } else {
      alert("⚠️ Retour vers la base indisponible");
    }
  };

  const handleCamera = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
  };

  const handleAppel = () => {
    if (typeof window.callAppelFromButton === "function") {
      window.callAppelFromButton();
    } else {
      alert("⚠️ Carte pas prête");
    }
  };

  useEffect(() => {
    const resize = () => window.location.reload();
    window.addEventListener("orientationchange", resize);
    return () => window.removeEventListener("orientationchange", resize);
  }, []);

  return (
    <div style={containerStyle}>
      <div style={mapStyle}>
        <Map2D
          robotLocal3D={robotLocal3D}
          blockedLinks={blockedLinks}
          activeObstacle={activeObstacle}
          forcedStartNodeId={rerouteState?.phase === "detour" ? rerouteState.resumeNodeId : null}
          onPathReady={handlePathReady}
          onMapReady={(data) => setMapData(data)}
          onNodeSelect={handleNodeSelect}
        />
      </div>

      <div style={sceneStyle}>
        <Canvas shadows>
          <Physics gravity={[0, -9.81, 0]}>
            {mapData && (
              <Scene
                pathPoints={pathPoints}
                mapData={mapData}
                robotGeo={robotGeo}
                activeObstacle={activeObstacle}
                onObstacleDetected={handleObstacleDetected}
                onPathComplete={handleCarPathComplete}
                ignoreObstacle={rerouteState?.phase === "backtrack"}
              />
            )}
          </Physics>
        </Canvas>

        <div style={buttonPanel}>
          <button style={btn} onClick={handleCamera}>🎥 CAMÉRA</button>
          <button style={btn} onClick={handleAppel}>🚑 APPEL</button>
          <button style={btn} onClick={handleRetour}>🔙 RETOUR</button>
          <button style={btn} onClick={handleResetObstacles}>🧱 RESET OBS</button>
        </div>
      </div>
    </div>
  );
}
