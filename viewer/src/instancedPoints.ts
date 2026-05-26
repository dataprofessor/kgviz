import * as THREE from "three"
import { NODE_OPACITY } from "./graphUtils"
import type { NodeData } from "./types"

export const INSTANCED_MAP_DEFAULT_THRESHOLD = 1500

export const INSTANCED_POINTS_LAYER_NAME = "__kgviz_instanced_points"
const LAYER_NAME = INSTANCED_POINTS_LAYER_NAME

export type InstancedPointsOptions = {
  getColor: (node: NodeData) => string
  isVisible: (node: NodeData) => boolean
  highlightIds?: Set<string>
  searchIds?: Set<string>
}

/** Screen-space point size (px) for map LOD. */
export function lodPointSize(_cameraDistance: number, nodeCount: number): number {
  if (nodeCount > 80_000) return 1.2
  if (nodeCount > 30_000) return 1.5
  if (nodeCount > 10_000) return 2
  if (nodeCount > 5_000) return 2.5
  if (nodeCount > 2_000) return 3
  return 3.5
}

/** World-space radius from node count and layout span. */
export function lodWorldRadius(nodeCount: number, span: number): number {
  const px = lodPointSize(0, nodeCount)
  return Math.max(span * 0.004, px * 0.35)
}

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

/** Scene root used by 3d-force-graph (first non-light child). */
export function resolveForceGraphRoot(scene: THREE.Scene): THREE.Object3D {
  for (const child of scene.children) {
    if (child.type === "AmbientLight" || child.type === "DirectionalLight") continue
    return child
  }
  return scene
}

export class InstancedPointsLayer {
  private mesh: THREE.InstancedMesh | null = null
  private geometry: THREE.SphereGeometry | null = null
  private material: THREE.MeshBasicMaterial | null = null
  private indexNodes: NodeData[] = []
  private layoutSpan = 200
  private worldRadius = 1.2
  private readonly dummy = new THREE.Object3D()

  get count() {
    return this.indexNodes.length
  }

  attach(parent: THREE.Object3D, nodes: NodeData[], opts: InstancedPointsOptions) {
    this.dispose(parent)

    const visible: NodeData[] = []
    for (const node of nodes) {
      if (!opts.isVisible(node)) continue
      visible.push(node)
    }
    this.indexNodes = visible

    const n = visible.length
    if (n === 0) return

    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    let zMin = Infinity
    let zMax = -Infinity
    for (const node of visible) {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const z = node.z ?? 0
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
      if (z < zMin) zMin = z
      if (z < zMax) zMax = z
    }
    this.layoutSpan = Math.max(xMax - xMin, yMax - yMin, zMax - zMin, 1)
    this.worldRadius = lodWorldRadius(n, this.layoutSpan)

    this.geometry = new THREE.SphereGeometry(1, 8, 8)
    this.material = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      opacity: NODE_OPACITY,
    })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, n)
    this.mesh.name = LAYER_NAME
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10

    const c = new THREE.Color()

    for (let i = 0; i < n; i++) {
      const node = visible[i]
      const x = node.x ?? 0
      const y = node.y ?? 0
      const z = node.z ?? 0
      this.dummy.position.set(x, y, z)
      this.dummy.scale.setScalar(this.worldRadius)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      c.set(this.resolveColor(node, opts))
      this.mesh.setColorAt(i, c)
    }

    this.mesh.instanceMatrix.needsUpdate = true

    parent.add(this.mesh)
  }

  private resolveColor(node: NodeData, opts: InstancedPointsOptions): string {
    const id = String(node.id)
    if (opts.searchIds?.has(id)) return "#f0b429"
    return opts.getColor(node)
  }

  syncPositions(nodes: NodeData[]) {
    if (!this.mesh) return
    for (let i = 0; i < this.indexNodes.length; i++) {
      const src = nodes.find(n => n.id === this.indexNodes[i].id) ?? this.indexNodes[i]
      this.indexNodes[i] = src
      const x = src.x ?? 0
      const y = src.y ?? 0
      const z = src.z ?? 0
      this.dummy.position.set(x, y, z)
      this.dummy.scale.setScalar(this.worldRadius)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  updateColors(opts: InstancedPointsOptions) {
    if (!this.mesh) return
    const c = new THREE.Color()
    for (let i = 0; i < this.indexNodes.length; i++) {
      c.set(this.resolveColor(this.indexNodes[i], opts))
      if (this.mesh.setColorAt) this.mesh.setColorAt(i, c)
      else if (this.mesh.instanceColor) {
        this.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b)
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  setPointSize(sizePx: number) {
    if (!this.mesh) return
    this.worldRadius = Math.max(this.layoutSpan * 0.004, sizePx * 0.35)
    for (let i = 0; i < this.indexNodes.length; i++) {
      const node = this.indexNodes[i]
      this.dummy.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      this.dummy.scale.setScalar(this.worldRadius)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  pick(
    raycaster: THREE.Raycaster,
    pointer: THREE.Vector2,
    camera: THREE.Camera,
    width: number,
    height: number,
  ): NodeData | null {
    if (!this.mesh || this.indexNodes.length === 0) return null

    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObject(this.mesh, false)
    if (hits.length > 0 && hits[0].instanceId != null) {
      return this.indexNodes[hits[0].instanceId] ?? null
    }

    const matrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    const ndc = new THREE.Vector3()
    let bestIdx = -1
    let bestDist = Infinity
    const mx = (pointer.x * 0.5 + 0.5) * width
    const my = (-pointer.y * 0.5 + 0.5) * height
    const thresh = Math.max(8, this.worldRadius * 4)

    for (let i = 0; i < this.indexNodes.length; i++) {
      const node = this.indexNodes[i]
      ndc.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      ndc.applyMatrix4(matrix)
      const sx = (ndc.x * 0.5 + 0.5) * width
      const sy = (-ndc.y * 0.5 + 0.5) * height
      const d = (sx - mx) ** 2 + (sy - my) ** 2
      if (d < thresh * thresh && d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    return bestIdx >= 0 ? this.indexNodes[bestIdx] : null
  }

  dispose(parent: THREE.Object3D) {
    const existing = parent.getObjectByName(LAYER_NAME)
    if (existing) parent.remove(existing)
    this.geometry?.dispose()
    this.material?.dispose()
    this.mesh = null
    this.geometry = null
    this.material = null
    this.indexNodes = []
  }
}
