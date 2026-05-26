import * as THREE from "three"
import type { NodeData } from "./types"

export type MapCamera = {
  yaw: number
  pitch: number
}

export type MapProjected = {
  x: number
  y: number
  depth: number
}

export function defaultMapCamera(): MapCamera {
  return { yaw: -0.85, pitch: 0.5 }
}

/** Rotate embedding coords into screen-space (Canvas Y-down). */
export function projectMapPoint(
  x: number,
  y: number,
  z: number,
  cam: MapCamera,
): MapProjected {
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)

  const x1 = x * cy + z * sy
  const z1 = -x * sy + z * cy
  const y2 = y * cp - z1 * sp
  const z2 = y * sp + z1 * cp

  return { x: x1, y: -y2, depth: z2 }
}

export function projectMapNodes(
  nodes: NodeData[],
  cam: MapCamera,
  getCoord: (node: NodeData) => { x: number; y: number; z: number },
): NodeData[] {
  const projected = nodes.map((node) => {
    const { x, y, z } = getCoord(node)
    const p = projectMapPoint(x, y, z, cam)
  return {
      ...node,
      x: p.x,
      y: p.y,
      fx: p.x,
      fy: p.y,
      __mapDepth: p.depth,
    } as NodeData
  })
  projected.sort(
    (a, b) => ((a as NodeData & { __mapDepth?: number }).__mapDepth ?? 0)
      - ((b as NodeData & { __mapDepth?: number }).__mapDepth ?? 0),
  )
  return projected
}

export function depthScale(depth: number, minD: number, maxD: number): number {
  if (maxD <= minD) return 1
  const t = (depth - minD) / (maxD - minD)
  return 0.55 + 0.45 * t
}

/** Fit the ForceGraph3D camera to map node bounds (map 3D orbit helper). */
export function fitMapCamera(
  g: {
    cameraPosition?: (...args: unknown[]) => unknown
    controls?: () => { target?: THREE.Vector3; update?: () => void }
  },
  nodes: NodeData[],
  padding = 1.25,
) {
  if (!nodes.length || !g.cameraPosition) return
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  let zMin = Infinity
  let zMax = -Infinity
  for (const n of nodes) {
    const x = n.x ?? 0
    const y = n.y ?? 0
    const z = n.z ?? 0
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
    if (z < zMin) zMin = z
    if (z < zMax) zMax = z
  }
  const cx = (xMin + xMax) / 2
  const cy = (yMin + yMax) / 2
  const cz = (zMin + zMax) / 2
  const span = Math.max(xMax - xMin, yMax - yMin, zMax - zMin, 1) * padding
  g.cameraPosition(
    { x: cx, y: cy, z: cz + span },
    { x: cx, y: cy, z: cz },
    0,
  )
  const controls = g.controls?.()
  if (controls?.target) {
    controls.target.set(cx, cy, cz)
    controls.update?.()
  }
}

export function depthRange(nodes: NodeData[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const node of nodes) {
    const d = (node as NodeData & { __mapDepth?: number }).__mapDepth
    if (d == null) continue
    if (d < min) min = d
    if (d > max) max = d
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 }
  return { min, max }
}
