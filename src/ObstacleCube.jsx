export function ObstacleCube({ obstacle }) {
  if (!obstacle) return null;

  return (
    <mesh position={[obstacle.position.x, obstacle.position.y, obstacle.position.z]} castShadow>
      <boxGeometry args={[0.25, 0.25, 0.25]} />
      <meshStandardMaterial color="crimson" />
    </mesh>
  );
}