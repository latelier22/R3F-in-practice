import React, { useRef } from "react";
import Ferret from "./Ferret";

const Wildlife = ({ animalsQuantity = 5 }) => {
  const group = useRef();
  const animals = [];

  for (let i = 0; i < animalsQuantity; i++) {
    animals.push(
      <Ferret
        key={i}
        position={[
          (Math.random() - 0.5) * 100,
          -2.5,
          (Math.random() - 0.5) * 100,
        ]}
      />
    );
  }

  return <group ref={group}>{animals}</group>;
};

export default Wildlife;
