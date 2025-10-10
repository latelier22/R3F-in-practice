import React, { useEffect, useRef } from "react";
import { Remi } from "./Characters/Remi";
import { Woman } from "./Characters/Woman";
import * as THREE from "three";

const MIN_DIST = 0.2;
const DETECT_RADIUS = 0.6;
const AVOID_FORCE = 0.1;
const RETURN_RATE = 0.9;
const SPEED_RECOVER = 1;

export function CharactersGroup({ mapData, nRemi = 20, nWoman = 20 }) {
  const remiRefs = useRef([]);
  const womanRefs = useRef([]);

  useEffect(() => {
    const tick = () => {
      const everyone = [
        ...remiRefs.current.map(r => r?.current).filter(Boolean),
        ...womanRefs.current.map(w => w?.current).filter(Boolean),
      ];

      for (let i = 0; i < everyone.length; i++) {
        const me = everyone[i];
        if (!me) continue;
        me.userData.avoid ||= new THREE.Vector3();
        me.userData.speedFactor ||= 1;
        me.userData.avoidTimer ||= 0;

        for (let j = i + 1; j < everyone.length; j++) {
          const other = everyone[j];
          if (!other) continue;
          other.userData.avoid ||= new THREE.Vector3();
          other.userData.speedFactor ||= 1;
          other.userData.avoidTimer ||= 0;

          const offset = me.position.clone().sub(other.position);
          const dist = offset.length();
          if (dist > DETECT_RADIUS || dist < 0.0001) continue;

          const dir = offset.normalize();
          if (dist < MIN_DIST) {
            const side = new THREE.Vector3(-dir.z, 0, dir.x);
            const lateral = side.multiplyScalar((MIN_DIST - dist) * AVOID_FORCE * 1.5);
            me.userData.avoid.add(lateral);
            other.userData.avoid.add(lateral.clone().multiplyScalar(-1));

            // correction douce
            const push = dir.clone().multiplyScalar((MIN_DIST - dist) * 0.5);
            me.position.add(push);
            other.position.add(push.multiplyScalar(-1));

            me.userData.avoidTimer = 1;
            other.userData.avoidTimer = 1;
          }

          const slow = THREE.MathUtils.clamp(dist / DETECT_RADIUS, 0.6, 1);
          me.userData.speedFactor = Math.min(me.userData.speedFactor, slow);
          other.userData.speedFactor = Math.min(other.userData.speedFactor, slow);
        }

        // retour progressif à la trajectoire
        me.userData.avoid.multiplyScalar(RETURN_RATE);
        me.userData.speedFactor = THREE.MathUtils.lerp(me.userData.speedFactor, 1, SPEED_RECOVER);
        if (me.userData.avoidTimer > 0) me.userData.avoidTimer -= 0.02;
      }

      requestAnimationFrame(tick);
    };
    tick();
  }, []);

  return (
    <group>
      {Array.from({ length: nRemi }).map((_, i) => {
        remiRefs.current[i] = remiRefs.current[i] || React.createRef();
        return (
          <Remi
            key={`R${i}`}
            rid={`R${i}`}
            mapData={mapData}
            ref={remiRefs.current[i]}
          />
        );
      })}

      {Array.from({ length: nWoman }).map((_, i) => {
        womanRefs.current[i] = womanRefs.current[i] || React.createRef();
        return (
          <Woman
            key={`W${i}`}
            wid={`W${i}`}
            mapData={mapData}
            ref={womanRefs.current[i]}
          />
        );
      })}
    </group>
  );
}
