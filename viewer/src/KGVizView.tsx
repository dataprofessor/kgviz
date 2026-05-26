import {
  Streamlit,
  withStreamlitConnection,
  ComponentProps,
} from "streamlit-component-lib"
import { useEffect, useCallback, useRef, useState, useMemo } from "react"
import ForceGraph2D from "react-force-graph-2d"
import ForceGraph3D from "react-force-graph-3d"
import * as THREE from "three"
import SpriteText from "three-spritetext"
import { ComponentArgs, NodeData } from "./types"
import { buildPerfProfile, PERF_THRESHOLDS } from "./performance"
import {
  fitMapCamera,
  INSTANCED_POINTS_LAYER_NAME,
  InstancedPointsLayer,
  lodPointSize,
  resolveForceGraphRoot,
} from "./instancedPoints"
import { GraphLegend } from "./GraphLegend"
import {
  buildLegendFromField,
  computeClusterCentroids,
  computeNeighborhood,
  getEdgeLabel,
  linkKey,
  NODE_OPACITY,
  nodeMatchesSearch,
  type GraphLink,
} from "./graphUtils"
import {
  defaultMapCamera,
  depthRange,
  depthScale,
  projectMapNodes,
  projectMapPoint,
  type MapCamera,
} from "./mapProjection"

export interface KGVizViewProps {
  args: ComponentArgs
  theme?: { backgroundColor?: string }
  streamlitMode?: boolean
}

const AUTO_HEIGHT_VH = 0.85

function getParentViewportHeight(): number {
  try { return window.parent.innerHeight } catch { return window.innerHeight || 600 }
}

// Match only unambiguous CSS colour syntax — hex (#rgb, #rrggbb, #rrggbbaa) or
// functional (rgb/rgba/hsl/hsla). Bare words like "color", "size", "type" are NOT
// matched so they are treated as column names, not colour strings.
const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\s*\(|hsla?\s*\()/
function isColorString(v: string) { return CSS_COLOR_RE.test(v.trim()) }
function getNodeColor(node: NodeData, k: string) { return isColorString(k) ? k : (node[k] as string) ?? "#cccccc" }
function getNodeSize(node: NodeData, k: string | number) { return typeof k === "number" ? k : (node[k] as number) ?? 3 }
function resolveLinkColor(link: Record<string, unknown>, k: string) { return isColorString(k) ? k : (link[k] as string) ?? "#ffffff" }

const GLOW_NAME = "__kg3d_glow"
const EDGE_GLOW_NAME = "__kg3d_edge_glow"
const SEARCH_GLOW_NAME = "__kg3d_search_glow"
const HOVER_GLOW_NAME = "__kgviz_hover_glow"

const GRAIN_PLANE_NAME = "__kg3d_grain_plane"

/** Pure-alpha grain — RGB is neutral gray, only A encodes noise so any background shows through. */
function createGrainOverlay(strength = 0.13, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext("2d")!
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i+1] = d[i+2] = 128                    // neutral gray (colour irrelevant under NormalBlending)
    d[i+3] = (Math.random() * strength * 255) | 0    // random low-opacity alpha = the visible grain
  }
  ctx.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(canvas)
}

function createGlow(radius: number, color: string, name: string = GLOW_NAME): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  const N = 10
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const scale = 1.2 + t * 1.8          // 1.2 → 3.0
    const opacity = 0.28 * Math.exp(-t * 3.5) // smooth exponential falloff
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(radius * scale, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        side: THREE.FrontSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    ))
  }
  return group
}

function nodeRadius(size: number) {
  return Math.cbrt(size) * 2
}

function shadeColor(color: string, factor: number) {
  const c = new THREE.Color(color)
  c.r = Math.min(1, Math.max(0, c.r * factor))
  c.g = Math.min(1, Math.max(0, c.g * factor))
  c.b = Math.min(1, Math.max(0, c.b * factor))
  return `#${c.getHexString()}`
}

function colorWithAlpha(color: string, alpha: number) {
  const c = new THREE.Color(color)
  return `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${alpha})`
}

const GLOW_LAYERS = 10
const HOVER_GLOW_RADIUS_FACTOR = 0.85

function glowShellRadius(baseRadius: number, layer: number) {
  const t = layer / (GLOW_LAYERS - 1)
  const scale = 1.2 + t * 1.8
  return baseRadius * scale
}

function glowShellOpacity(layer: number) {
  const t = layer / (GLOW_LAYERS - 1)
  return 0.28 * Math.exp(-t * 3.5)
}

/** Canvas glow matching createGlow() — shared by click/search/hover halos in 2D. */
function drawGlow2d(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const prevComp = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = "lighter"
  for (let i = 0; i < GLOW_LAYERS; i++) {
    const shellR = glowShellRadius(radius, i)
    ctx.beginPath()
    ctx.arc(x, y, shellR, 0, 2 * Math.PI)
    ctx.fillStyle = colorWithAlpha(color, glowShellOpacity(i))
    ctx.fill()
  }
  ctx.globalCompositeOperation = prevComp
}

function hoverGlowRadius(sphereRadius: number) {
  return sphereRadius * HOVER_GLOW_RADIUS_FACTOR
}

function drawMapSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  selected = false,
) {
  ctx.save()
  ctx.globalAlpha = 1
  ctx.strokeStyle = selected ? "#ffffff" : color
  ctx.lineWidth = Math.max(selected ? 2 : 1.5, radius * (selected ? 0.22 : 0.14))
  ctx.beginPath()
  ctx.arc(x, y, radius + ctx.lineWidth * 0.55, 0, 2 * Math.PI)
  ctx.stroke()
  ctx.restore()
}

function paintMapNodeInteraction(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  state: { isSearch: boolean; isSelected: boolean; isHovered: boolean },
  useGlow: boolean,
) {
  if (useGlow && state.isSearch) drawGlow2d(ctx, x, y, radius, "#f0b429")
  if (state.isSelected) {
    if (useGlow) drawGlow2d(ctx, x, y, radius, color)
    drawMapSelectionRing(ctx, x, y, radius, color, true)
    return
  }
  if (state.isHovered) {
    if (useGlow) drawGlow2d(ctx, x, y, hoverGlowRadius(radius), color)
    drawMapSelectionRing(ctx, x, y, radius, color, false)
  }
}

/** 2D sphere fill — mirrors MeshBasicMaterial (flat) / MeshStandardMaterial (HQ). */
function drawSphere2d(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  hq: boolean,
  alpha = NODE_OPACITY,
) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, 2 * Math.PI)

  if (!hq) {
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
    return
  }

  const base = new THREE.Color(color).multiplyScalar(0.55)
  const hex = `#${base.getHexString()}`
  const highlight = shadeColor(hex, 1.85)
  const mid = shadeColor(hex, 1.25)
  const shadow = shadeColor(hex, 0.55)
  const grad = ctx.createRadialGradient(
    x - radius * 0.45, y - radius * 0.45, radius * 0.05,
    x + radius * 0.1, y + radius * 0.15, radius,
  )
  grad.addColorStop(0, highlight)
  grad.addColorStop(0.45, mid)
  grad.addColorStop(1, shadow)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.restore()
}

const LABEL_FONT_SIZE = 200
const LABEL_FONT_FACE = "system-ui"
const LABEL_FONT_WEIGHT = "normal"
const LABEL_STROKE_WIDTH = 10
const LABEL_GAP = 1

/** 2D label rendering — mirrors three-spritetext / SpriteText used in 3D. */
function drawNodeLabel2d(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  label: string,
  outline: boolean,
) {
  const textHeight = radius * 0.8
  const font = `${LABEL_FONT_WEIGHT} ${LABEL_FONT_SIZE}px ${LABEL_FONT_FACE}`

  const offscreen = document.createElement("canvas")
  const octx = offscreen.getContext("2d")!
  octx.font = font
  const innerWidth = octx.measureText(label).width
  const innerHeight = LABEL_FONT_SIZE
  offscreen.width = Math.max(1, Math.ceil(innerWidth))
  offscreen.height = Math.max(1, Math.ceil(innerHeight))

  octx.font = font
  octx.textAlign = "left"
  octx.textBaseline = "bottom"
  octx.fillStyle = "#ffffff"
  const textX = 0
  const textY = innerHeight
  if (outline) {
    octx.lineJoin = "round"
    octx.lineWidth = LABEL_STROKE_WIDTH * LABEL_FONT_SIZE / 10
    octx.strokeStyle = "#000000"
    octx.strokeText(label, textX, textY)
  }
  octx.fillText(label, textX, textY)

  const worldH = textHeight
  const worldW = worldH * (offscreen.width / offscreen.height)
  const centerY = y - radius - textHeight - LABEL_GAP
  ctx.drawImage(offscreen, x - worldW / 2, centerY - worldH / 2, worldW, worldH)
}

function drawClusterLabel2d(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  fontSize = 14,
) {
  ctx.save()
  ctx.font = `700 ${fontSize}px ${LABEL_FONT_FACE}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(2, fontSize * 0.22)
  ctx.strokeStyle = "rgba(0,0,0,0.82)"
  ctx.strokeText(text, x, y)
  ctx.fillStyle = "#ffffff"
  ctx.fillText(text, x, y)
  ctx.restore()
}

function createGrainDataUrl(strength = 0.13, size = 256): string {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 128
    d[i + 3] = (Math.random() * strength * 255) | 0
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

function grainRepeat(density: string): [number, number] {
  if (density === "light") return [6, 4]
  if (density === "dense") return [16, 11]
  return [10, 7]
}

// ── Plotly-style SVG icons ──────────────────────────────────────────────────
const ICONS: Record<string, JSX.Element> = {
  zoomIn: <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 600 }}>+</span>,
  zoomOut: <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 600 }}>−</span>,
  fit: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  ),
  label: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/>
    </svg>
  ),
  hq: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 1l2.39 7.26H22l-6.19 4.5 2.37 7.24L12 15.51l-6.18 4.49 2.37-7.24L2 8.26h7.61z"/>
    </svg>
  ),
  grain: (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor">
      <circle cx="1.5" cy="1.5" r="0.9"/><circle cx="5"   cy="0.8" r="0.9"/>
      <circle cx="9"   cy="1.8" r="0.9"/><circle cx="12.5" cy="0.7" r="0.9"/>
      <circle cx="0.8" cy="5.5" r="0.9"/><circle cx="3.8" cy="4.5" r="0.9"/>
      <circle cx="7.5" cy="5"   r="0.9"/><circle cx="11.5" cy="4.8" r="0.9"/>
      <circle cx="2"   cy="9"   r="0.9"/><circle cx="6"   cy="8.5" r="0.9"/>
      <circle cx="10"  cy="9.5" r="0.9"/><circle cx="13"  cy="8"   r="0.9"/>
      <circle cx="0.7" cy="12.5" r="0.9"/><circle cx="4.5" cy="13" r="0.9"/>
      <circle cx="8.5" cy="12"   r="0.9"/><circle cx="12.5" cy="13" r="0.9"/>
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z"/>
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
  ),
  view2d: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <circle cx="7" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="17" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="17" cy="16" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8"/>
      <line x1="10.5" y1="10.5" x2="14" y2="9" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="10.5" y1="13.5" x2="14" y2="15" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  view3d: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2L4 6.5v11L12 22l8-4.5v-11L12 2zm0 2.2l5.8 3.3-5.8 3.3-5.8-3.3L12 4.2zM6 8.8l6 3.4v6.8l-6-3.4V8.8zm12 0v6.8l-6 3.4v-6.8l6-3.4z"/>
    </svg>
  ),
  focus: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
    </svg>
  ),
  clearFocus: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
    </svg>
  ),
  clearSel: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M16 9h-2.29l3-3-1.42-1.42-3 3V6h-2v2.29l-3-3-1.42 1.42 3 3H6v2h2.29l-3 3 1.42 1.42 3-3V16h2v-2.29l3 3 1.42-1.42-3-3H16V9z"/>
    </svg>
  ),
}

// ── Toolbar button ───────────────────────────────────────────────────────────
function ToolBtn({
  icon, title, active, onClick, onMouseDown, onMouseUp,
}: { icon: keyof typeof ICONS; title: string; active?: boolean; onClick?: (e: React.MouseEvent) => void; onMouseDown?: (e: React.MouseEvent) => void; onMouseUp?: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false)
  const fireClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onClick?.(e)
  }
  return (
    <div
      title={title}
      onClick={onClick ? fireClick : undefined}
      onMouseDown={(e) => {
        e.stopPropagation()
        onMouseDown?.(e)
      }}
      onMouseUp={(e) => { e.stopPropagation(); onMouseUp?.(e) }}
      onMouseLeave={(e) => { setHover(false); onMouseUp?.(e) }}
      onMouseEnter={() => setHover(true)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26,
        borderRadius: 3,
        border: "1px solid rgba(255,255,255,0.18)",
        background: active
          ? "rgba(255,255,255,0.22)"
          : hover
            ? "rgba(255,255,255,0.12)"
            : "rgba(20,20,30,0.6)",
        color: active ? "#fff" : "rgba(255,255,255,0.75)",
        cursor: "pointer",
        userSelect: "none",
        transition: "background 0.12s, color 0.12s",
        backdropFilter: "blur(6px)",
      }}
    >
      {ICONS[icon]}
    </div>
  )
}

// ── Divider ──────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "2px 0" }} />
}

// Keys to exclude from the hover tooltip
const TOOLTIP_EXCLUDE = new Set(["__threeObj", "vx", "vy", "vz", "fx", "fy", "fz", "index"])

type ViewMode = "2d" | "3d"
/** 3D simulation XYZ (z preserved across 2D). */
type XYZCoord = { x: number; y: number; z: number }
/** Viewport pixel position — matches what you see on screen. */
type ScreenCoord = { sx: number; sy: number }
type ViewTransform2d = { kind: "2d"; zoom: number; center: { x: number; y: number } }
type ViewTransform3d = { kind: "3d"; camera: { x: number; y: number; z: number } }
type SimNode = NodeData & { vx?: number; vy?: number; vz?: number }

type GraphCoordApi = {
  graph2ScreenCoords?: (x: number, y: number, z?: number) => { x: number; y: number }
  screen2GraphCoords?: (x: number, y: number, z?: number) => { x: number; y: number; z?: number }
  cameraPosition?: () => { x: number; y: number; z: number }
}

function readGraphSimNodes(g: { graphData?: () => { nodes: SimNode[] } } | null): SimNode[] {
  try {
    return g?.graphData?.()?.nodes ?? []
  } catch {
    return []
  }
}

function pinSimNode(sim: SimNode, x: number, y: number, z?: number) {
  sim.x = x
  sim.y = y
  sim.fx = x
  sim.fy = y
  sim.vx = 0
  sim.vy = 0
  if (z !== undefined) {
    sim.z = z
    sim.fz = z
    sim.vz = 0
  } else {
    sim.fz = undefined
  }
}

function buildGraphLinks(
  edges: Record<string, unknown>[],
  bidirectional: boolean,
): Record<string, unknown>[] {
  const links: Record<string, unknown>[] = []
  for (const edge of edges) {
    links.push(edge)
    if (bidirectional || edge.bidirectional) {
      links.push({ ...edge, source: edge.target, target: edge.source, __synthetic: true })
    }
  }
  return links
}

/** Shallow clone with fx/fy/fz preset so the force engine cannot flatten Z before React effects run. */
function cloneNodeWithPinnedCoords(node: NodeData, mode: ViewMode): NodeData {
  const copy = { ...node }
  if (node.x == null || node.y == null) return copy
  const z = node.z ?? 0
  copy.x = node.x
  copy.y = node.y
  copy.fx = node.x
  copy.fy = node.y
  if (mode === "3d") {
    copy.z = z
    copy.fz = z
  }
  return copy
}

function restorePinned3dCoordinates(
  nodes: NodeData[],
  xyz: Map<string | number, XYZCoord>,
) {
  for (const node of nodes) {
    const saved = xyz.get(node.id)
    if (!saved) continue
    pinSimNode(node as SimNode, saved.x, saved.y, saved.z)
  }
}

/** Keep fixed embedding coords on map nodes (skip screen-projection sync). */
function restoreMapPinnedCoordinates(nodes: NodeData[]) {
  for (const node of nodes) {
    if (node.x == null || node.y == null) continue
    pinSimNode(node as SimNode, node.x, node.y, node.z ?? 0)
  }
}

function cameraDistance3d(g3: GraphCoordApi | null): number {
  const c = g3?.cameraPosition?.() ?? { x: 0, y: 0, z: 400 }
  return Math.hypot(c.x, c.y, c.z) || 400
}

/** Distance along the view ray from camera to a world point (for screen2GraphCoords). */
function depthAlongViewRay(
  g3: GraphCoordApi | null,
  sx: number,
  sy: number,
  wx: number,
  wy: number,
  wz: number,
): number {
  if (!g3?.screen2GraphCoords) return cameraDistance3d(g3)
  const near = g3.screen2GraphCoords(sx, sy, 0)
  const far = g3.screen2GraphCoords(sx, sy, 1)
  const nx = near.x
  const ny = near.y
  const nz = near.z ?? 0
  const fx = far.x
  const fy = far.y
  const fz = far.z ?? 0
  const rx = fx - nx
  const ry = fy - ny
  const rz = fz - nz
  const len2 = rx * rx + ry * ry + rz * rz
  if (len2 < 1e-9) return cameraDistance3d(g3)
  const vx = wx - nx
  const vy = wy - ny
  const vz = wz - nz
  const t = (vx * rx + vy * ry + vz * rz) / len2
  return Number.isFinite(t) && t > 0 ? t : cameraDistance3d(g3)
}

type Graph2dViewApi = GraphCoordApi & {
  zoom?: {
    (): number
    (k: number, ms?: number): unknown
  }
  centerAt?: (x?: number, y?: number, ms?: number) => { x: number; y: number } | unknown
  graph2ScreenCoords?: (x: number, y: number) => { x: number; y: number }
  screen2GraphCoords?: (x: number, y: number) => { x: number; y: number }
}

/** Match 2D zoom/pan so nodes sit at the same viewport pixels as the 3D capture. */
function fit2dViewToCapturedScreen(
  g2: Graph2dViewApi | null,
  nodes: NodeData[],
  screen: Map<string | number, ScreenCoord>,
  width: number,
  height: number,
  captureWidth?: number,
  captureHeight?: number,
): ViewTransform2d | null {
  if (!g2?.screen2GraphCoords || !g2.zoom || !g2.centerAt || width < 1 || height < 1) return null

  const sxScale = captureWidth && captureWidth > 0 ? width / captureWidth : 1
  const syScale = captureHeight && captureHeight > 0 ? height / captureHeight : 1

  g2.zoom(1, 0)
  g2.centerAt(0, 0, 0)

  for (const node of nodes) {
    const s = screen.get(node.id)
    if (!s) continue
    const graph = g2.screen2GraphCoords!(
      s.sx * sxScale,
      s.sy * syScale,
    )
    pinSimNode(node as SimNode, graph.x, graph.y)
  }

  const pts: { gx: number; gy: number; sx: number; sy: number }[] = []
  for (const n of nodes) {
    const s = screen.get(n.id)
    const sim = n as SimNode
    if (!s || sim.x == null || sim.y == null) continue
    pts.push({
      gx: sim.x,
      gy: sim.y,
      sx: s.sx * sxScale,
      sy: s.sy * syScale,
    })
  }
  if (pts.length < 2) return null

  let gxMin = Infinity
  let gxMax = -Infinity
  let gyMin = Infinity
  let gyMax = -Infinity
  let sxMin = Infinity
  let sxMax = -Infinity
  let syMin = Infinity
  let syMax = -Infinity
  let gcx = 0
  let gcy = 0
  let scx = 0
  let scy = 0

  for (const p of pts) {
    gxMin = Math.min(gxMin, p.gx)
    gxMax = Math.max(gxMax, p.gx)
    gyMin = Math.min(gyMin, p.gy)
    gyMax = Math.max(gyMax, p.gy)
    sxMin = Math.min(sxMin, p.sx)
    sxMax = Math.max(sxMax, p.sx)
    syMin = Math.min(syMin, p.sy)
    syMax = Math.max(syMax, p.sy)
    gcx += p.gx
    gcy += p.gy
    scx += p.sx
    scy += p.sy
  }
  gcx /= pts.length
  gcy /= pts.length
  scx /= pts.length
  scy /= pts.length

  const graphW = Math.max(gxMax - gxMin, 1e-6)
  const graphH = Math.max(gyMax - gyMin, 1e-6)
  const screenW = Math.max(sxMax - sxMin, 1e-6)
  const screenH = Math.max(syMax - syMin, 1e-6)

  const kx = screenW / graphW
  const ky = screenH / graphH
  let k = (kx + ky) / 2
  if (!Number.isFinite(k) || k <= 0) k = 1

  const cx = gcx - (scx - width / 2) / k
  const cy = gcy - (scy - height / 2) / k

  g2.zoom(k, 0)
  g2.centerAt(cx, cy, 0)

  return { kind: "2d", zoom: k, center: { x: cx, y: cy } }
}

/** Snapshot screen pixels + XYZ from the active graph before toggling. */
function captureLayoutSnapshot(
  g: GraphCoordApi | null,
  fromMode: ViewMode,
  xyz: Map<string | number, XYZCoord>,
  screen: Map<string | number, ScreenCoord>,
) {
  if (!g?.graph2ScreenCoords) return
  const prev = new Map(xyz)
  xyz.clear()
  screen.clear()
  for (const sim of readGraphSimNodes(g as { graphData?: () => { nodes: SimNode[] } } | null)) {
    const x = sim.x ?? 0
    const y = sim.y ?? 0
    const z = sim.z ?? 0
    const savedZ = prev.get(sim.id)?.z ?? z
    if (fromMode === "3d") {
      xyz.set(sim.id, { x, y, z })
      const s = g.graph2ScreenCoords!(x, y, z)
      screen.set(sim.id, { sx: s.x, sy: s.y })
    } else {
      xyz.set(sim.id, { x, y: -y, z: savedZ })
      const s = g.graph2ScreenCoords!(x, y)
      screen.set(sim.id, { sx: s.x, sy: s.y })
    }
  }
}

/** Place nodes so they appear at the same viewport pixels (orientation-safe). */
function applyLayoutFromScreen(
  nodes: NodeData[],
  toMode: ViewMode,
  g2: GraphCoordApi | null,
  g3: GraphCoordApi | null,
  screen: Map<string | number, ScreenCoord>,
  xyz: Map<string | number, XYZCoord>,
) {
  const g = (toMode === "3d" ? g3 : g2) as GraphCoordApi | null
  if (!g?.screen2GraphCoords || screen.size === 0) return false

  for (const node of nodes) {
    const s = screen.get(node.id)
    const p = xyz.get(node.id)
    if (!s) continue
    const sim = node as SimNode
    const depth = toMode === "3d" && p
      ? depthAlongViewRay(g3, s.sx, s.sy, p.x, p.y, p.z)
      : undefined
    const graph = toMode === "3d"
      ? g.screen2GraphCoords!(s.sx, s.sy, depth)
      : g.screen2GraphCoords!(s.sx, s.sy)
    if (toMode === "3d") {
      pinSimNode(sim, graph.x, graph.y, graph.z ?? p?.z ?? 0)
    } else {
      pinSimNode(sim, graph.x, graph.y)
      if (p) sim.z = p.z
    }
  }
  return true
}

function restoreViewTransform(
  toMode: ViewMode,
  fromMode: ViewMode,
  g2: GraphCoordApi & { centerAt?: (x: number, y: number, ms?: number) => unknown; zoom?: (k: number, ms?: number) => unknown },
  g3: GraphCoordApi & { cameraPosition?: (...args: unknown[]) => unknown },
  view2d: ViewTransform2d | null,
  view3d: ViewTransform3d | null,
) {
  if (toMode === "3d" && view3d?.camera && g3?.cameraPosition) {
    g3.cameraPosition(view3d.camera, { x: 0, y: 0, z: 0 }, 0)
    syncOrbitControlsFromCamera(g3)
  } else if (toMode === "2d" && fromMode === "2d" && view2d && g2?.centerAt && g2?.zoom) {
    g2.centerAt(view2d.center.x, view2d.center.y, 0)
    g2.zoom(view2d.zoom, 0)
  }
}

function finalizeLayoutAfterToggle(
  graph2dData: { nodes: NodeData[]; links: Record<string, unknown>[] },
  graph3dData: { nodes: NodeData[]; links: Record<string, unknown>[] },
  toMode: ViewMode,
  fromMode: ViewMode,
  g2: any,
  g3: any,
  screen: Map<string | number, ScreenCoord>,
  xyz: Map<string | number, XYZCoord>,
  view2d: ViewTransform2d | null,
  view3d: ViewTransform3d | null,
  viewport: { width: number; height: number },
  captureSize: { width: number; height: number } | null,
  on2dViewFitted?: (view: ViewTransform2d) => void,
): ViewTransform2d | null {
  const targetNodes = toMode === "3d" ? graph3dData.nodes : graph2dData.nodes
  restoreViewTransform(toMode, fromMode, g2, g3, view2d, view3d)
  applyLayoutFromScreen(targetNodes, toMode, g2, g3, screen, xyz)
  setGraphPlaybackForView(toMode, g2, g3, true)
  syncBothGraphs(graph2dData, graph3dData, g2, g3, toMode, true)

  let fitted2d: ViewTransform2d | null = null
  if (toMode === "2d" && fromMode === "3d") {
    fitted2d = fit2dViewToCapturedScreen(
      g2,
      graph2dData.nodes,
      screen,
      viewport.width,
      viewport.height,
      captureSize?.width,
      captureSize?.height,
    )
    if (fitted2d) on2dViewFitted?.(fitted2d)
  }

  if (toMode === "3d") {
    restorePinned3dCoordinates(graph3dData.nodes, xyz)
    syncOrbitControlsFromCamera(g3)
    stabilize3dSimulation(g3)
    tune3dControls(g3)
  }

  return fitted2d
}

function syncBothGraphs(
  graph2dData: { nodes: NodeData[]; links: Record<string, unknown>[] },
  graph3dData: { nodes: NodeData[]; links: Record<string, unknown>[] },
  g2: any,
  g3: any,
  activeMode: ViewMode,
  freeze3d = true,
) {
  if (g3) {
    g3.graphData?.(graph3dData)
    if (activeMode === "3d") {
      resumeActiveGraph(g3, { freezeSimulation: freeze3d })
      if (freeze3d) stabilize3dSimulation(g3)
    } else {
      pauseInactiveGraph(g3)
      stabilize3dSimulation(g3)
    }
  }
  if (g2) {
    g2.graphData?.(graph2dData)
    if (activeMode === "2d") resumeActiveGraph(g2)
    else pauseInactiveGraph(g2)
  }
}

function releasePinnedNodes(nodes: NodeData[]) {
  for (const node of nodes) {
    node.fx = undefined
    node.fy = undefined
    node.fz = undefined
  }
}

/** Stop force simulation on hidden graph (save GPU). */
function pauseInactiveGraph(g: {
  pauseAnimation?: () => void
  d3AlphaMin?: (v: number) => unknown
} | null) {
  if (!g) return
  try {
    g.d3AlphaMin?.(0)
    g.pauseAnimation?.()
  } catch { /* noop */ }
}

/** Keep render loop alive; freeze 3D force sim so camera rotation stays steady. */
function resumeActiveGraph(
  g: {
    resumeAnimation?: () => void
    refresh?: () => void
    d3AlphaMin?: (v: number) => unknown
    d3Alpha?: (v: number) => unknown
  } | null,
  opts?: { freezeSimulation?: boolean },
) {
  if (!g) return
  try {
    if (opts?.freezeSimulation) stabilize3dSimulation(g)
    else g.d3AlphaMin?.(0.001)
    g.resumeAnimation?.()
    g.refresh?.()
  } catch { /* noop */ }
}

type OrbitControlsLike = {
  enableDamping?: boolean
  dampingFactor?: number
  rotateSpeed?: number
  zoomSpeed?: number
  panSpeed?: number
  target?: THREE.Vector3
  update?: () => void
}

type TrackballControlsLike = {
  rotateSpeed?: number
  staticMoving?: boolean
  dynamicDampingFactor?: number
  update?: () => void
}

function stabilize3dSimulation(g: {
  d3AlphaMin?: (v: number) => unknown
  d3Alpha?: (v: number) => unknown
  graphData?: () => { nodes: SimNode[] }
} | null) {
  if (!g) return
  try {
    g.d3AlphaMin?.(0)
    g.d3Alpha?.(0)
    for (const sim of readGraphSimNodes(g)) {
      sim.vx = 0
      sim.vy = 0
      sim.vz = 0
    }
  } catch { /* noop */ }
}

function syncOrbitControlsFromCamera(g3: {
  camera?: () => THREE.Camera
  controls?: () => OrbitControlsLike
  cameraPosition?: (...args: unknown[]) => unknown
} | null) {
  if (!g3?.controls || !g3.camera) return
  const controls = g3.controls()
  const lookAt = (g3.cameraPosition?.() as { lookAt?: { x: number; y: number; z: number } } | undefined)?.lookAt
    ?? { x: 0, y: 0, z: 0 }
  if (controls.target) {
    controls.target.set(lookAt.x, lookAt.y, lookAt.z)
  }
  controls.update?.()
}

function setGraphPlaybackForView(
  viewMode: ViewMode,
  g2: any,
  g3: any,
  freeze3d = true,
  mapMode = false,
) {
  if (mapMode) {
    resumeActiveGraph(g2, { freezeSimulation: true })
    pauseInactiveGraph(g3)
    return
  }
  if (viewMode === "3d") {
    resumeActiveGraph(g3, { freezeSimulation: freeze3d })
    pauseInactiveGraph(g2)
  } else {
    resumeActiveGraph(g2)
    pauseInactiveGraph(g3)
  }
}

function clearForceGraph2dCanvas(g2: { refresh?: () => void } | null, bgColor: string) {
  if (!g2) return
  try {
    const canvas = (g2 as { canvas?: () => HTMLCanvasElement }).canvas?.()
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.restore()
      }
    }
    g2.refresh?.()
  } catch { /* noop */ }
}

function tune3dControls(g: { controls?: () => OrbitControlsLike & TrackballControlsLike } | null) {
  const controls = g?.controls?.()
  if (!controls) return
  if ("enableDamping" in controls) {
    controls.enableDamping = false
    controls.rotateSpeed = 0.85
    controls.zoomSpeed = 1.0
    controls.panSpeed = 0.6
  } else {
    controls.rotateSpeed = 2.0
    controls.staticMoving = true
    controls.dynamicDampingFactor = 0.08
  }
}

function graphLayerStyle(active: boolean, disablePointer = false): React.CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    visibility: active ? "visible" : "hidden",
    pointerEvents: active && !disablePointer ? "auto" : "none",
    zIndex: active ? 1 : 0,
  }
}

// ── Main component ───────────────────────────────────────────────────────────
export function KGVizView({ args, theme, streamlitMode = false }: KGVizViewProps) {
  const {
    graph_data, node_color = "color", node_size = "size", node_label = "label",
    edge_color = "#ffffff", edge_width = 1.5, height: heightProp = null, width = null,
    edge_label = "label", show_edge_labels = false,
    legend_node_by = null, legend_edge_by = null, show_legend = false,
    focus_hops = 2, enable_focus = true,
    search_keys = ["label", "id"], enable_multi_select = true,
    dag_mode = null, bg_color = "", show_nav_info = false,
    link_directional_arrow = false, arrow_size = "medium", warmup_ticks = 0, show_labels = false,
    bidirectional = false, label_outline = false, grain_density = "medium",
    particle_flow = false, particle_speed = 0.003,
    default_view = "3d",
    use_coordinates = false,
    performance_mode = "auto",
    map_mode = false,
    layout_method = null,
    instanced_map_threshold = PERF_THRESHOLDS.instancedMap,
  } = args as ComponentArgs

  const instancedThreshold = Math.max(100, instanced_map_threshold ?? PERF_THRESHOLDS.instancedMap)

  const arrowLength = map_mode || !link_directional_arrow ? 0
    : arrow_size === "small" ? 2
    : arrow_size === "large" ? 6
    : 4  // medium

  const [height, setHeight] = useState(() => {
    if (streamlitMode) {
      return heightProp !== null ? heightProp : Math.round(getParentViewportHeight() * AUTO_HEIGHT_VH)
    }
    return window.innerHeight
  })

  const resolvedBgColor = bg_color || theme?.backgroundColor || "#0e1117"
  const containerRef = useRef<HTMLDivElement>(null)
  const graph3dRef = useRef<any>(null)
  const graph2dRef = useRef<any>(null)
  const instancedLayerRef = useRef<InstancedPointsLayer | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerNdcRef = useRef(new THREE.Vector2())
  if (!instancedLayerRef.current) instancedLayerRef.current = new InstancedPointsLayer()
  const [containerWidth, setContainerWidth] = useState<number>(800)
  const [labelsOn, setLabelsOn] = useState(show_labels)
  const [hovered, setHovered] = useState(false)
  const [hqMode, setHqMode] = useState(false)
  const [sandyBg, setSandyBg] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const baseInitialView: ViewMode = map_mode ? "2d" : (default_view === "2d" ? "2d" : "3d")
  const [viewMode, setViewMode] = useState<ViewMode>(baseInitialView)
  const [layoutLocked, setLayoutLocked] = useState(false)
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string | number>>(new Set())
  const [focusRootId, setFocusRootId] = useState<string | number | null>(null)
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set())
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set())
  const lastClickRef = useRef<{ id: string | number; t: number } | null>(null)
  const holdRafRef = useRef<number | null>(null)
  const toggleFromModeRef = useRef<ViewMode>("3d")
  const pendingLayoutSyncRef = useRef(false)
  const controlsTunedRef = useRef(false)
  const layoutXYZRef = useRef<Map<string | number, XYZCoord>>(new Map())
  const layoutScreenRef = useRef<Map<string | number, ScreenCoord>>(new Map())
  const layoutCaptureSizeRef = useRef<{ width: number; height: number } | null>(null)
  const needs2dZoomFitRef = useRef(false)
  const viewTransform2dRef = useRef<ViewTransform2d | null>(null)
  const viewTransform3dRef = useRef<ViewTransform3d | null>(null)

  const getGraph = useCallback((mode: ViewMode = viewMode) => {
    if (map_mode) return graph2dRef.current
    return mode === "3d" ? graph3dRef.current : graph2dRef.current
  }, [viewMode, map_mode])

  const graphLinks = useMemo(
    () => map_mode
      ? []
      : buildGraphLinks(graph_data.edges as Record<string, unknown>[], bidirectional),
    [graph_data.edges, bidirectional, map_mode],
  )

  const graph3dData = useMemo(() => ({
    nodes: use_coordinates
      ? graph_data.nodes.map(n => cloneNodeWithPinnedCoords(n, "3d"))
      : graph_data.nodes.map(n => ({ ...n })),
    links: graphLinks,
  }), [graph_data.nodes, graphLinks, use_coordinates])

  const graph2dData = useMemo(() => ({
    nodes: use_coordinates
      ? graph_data.nodes.map(n => cloneNodeWithPinnedCoords(n, "2d"))
      : graph_data.nodes.map(n => ({ ...n })),
    links: graphLinks,
  }), [graph_data.nodes, graphLinks, use_coordinates])

  const perf = useMemo(
    () => buildPerfProfile(
      performance_mode,
      graph_data.nodes.length,
      graphLinks.length,
      show_labels,
      particle_flow,
      map_mode,
      instancedThreshold,
    ),
    [performance_mode, graph_data.nodes.length, graphLinks.length, show_labels, particle_flow, map_mode, instancedThreshold],
  )

  const useInstancedMap = perf.useInstancedMap
  const mapCanvas3d = map_mode && viewMode === "3d"
  const showInstancedLayer = false
  const effectiveViewMode: ViewMode = map_mode ? viewMode : (useInstancedMap ? "3d" : viewMode)
  const mounted3d = !map_mode && viewMode === "3d"
  const mounted2d = map_mode || viewMode === "2d"
  const [mapCamera, setMapCamera] = useState<MapCamera>(() => defaultMapCamera())
  const mapOverlayRef = useRef<HTMLCanvasElement>(null)
  const mapOrbitRef = useRef<{ lastX: number; lastY: number } | null>(null)
  const mapPickDownRef = useRef<{ node: NodeData; x: number; y: number } | null>(null)
  const onNodeClickRef = useRef<(node: NodeData) => void>(() => {})
  const fitMapCanvas3dRef = useRef<(() => void) | null>(null)

  const getMapSourceCoord = useCallback((node: NodeData) => {
    const saved = layoutXYZRef.current.get(node.id)
    return {
      x: saved?.x ?? node.x ?? 0,
      y: saved?.y ?? node.y ?? 0,
      z: saved?.z ?? node.z ?? 0,
    }
  }, [])

  const mapDepthBoundsRef = useRef({ min: 0, max: 1 })

  useEffect(() => {
    if (useInstancedMap && !map_mode && viewMode !== "3d") setViewMode("3d")
  }, [useInstancedMap, map_mode, viewMode])

  const effectiveLabelsOn = labelsOn && !showInstancedLayer && (
    map_mode
      ? true
      : effectiveViewMode === "2d"
        ? (perf.tier === "quality"
          || (perf.tier === "balanced" && graph_data.nodes.length <= PERF_THRESHOLDS.labelsAlways))
        : perf.useCustom3dNodes && graph_data.nodes.length <= PERF_THRESHOLDS.labelsAlways
  )

  const labelsOnHover3d = labelsOn && !showInstancedLayer && !map_mode
    && effectiveViewMode === "3d"
    && perf.useCustom3dNodes
    && graph_data.nodes.length > PERF_THRESHOLDS.labelsAlways
    && graph_data.nodes.length <= PERF_THRESHOLDS.labelsHoverOnly

  useEffect(() => {
    layoutXYZRef.current.clear()
    layoutScreenRef.current.clear()
    layoutCaptureSizeRef.current = null
    needs2dZoomFitRef.current = false
    viewTransform2dRef.current = null
    viewTransform3dRef.current = null
    setLayoutLocked(false)
    if (!use_coordinates) return
    for (const node of graph_data.nodes) {
      if (node.x == null || node.y == null) continue
      const z = node.z ?? 0
      layoutXYZRef.current.set(node.id, { x: node.x, y: node.y, z })
      if (baseInitialView === "2d" && !useInstancedMap && !map_mode) {
        layoutXYZRef.current.set(node.id, { x: node.x, y: -node.y, z })
      }
    }
    if (!map_mode && graph_data.nodes.some(n => n.x != null && n.y != null)) {
      setLayoutLocked(true)
    } else if (map_mode && use_coordinates && graph_data.nodes.some(n => n.x != null && n.y != null)) {
      setLayoutLocked(true)
    }
  }, [graph_data, use_coordinates, baseInitialView, useInstancedMap, map_mode])

  useEffect(() => {
    if (!mounted3d && !mounted2d) return
    setGraphPlaybackForView(
      viewMode,
      graph2dRef.current,
      graph3dRef.current,
      perf.freezeSimulation,
      map_mode,
    )
    if (mapCanvas3d) {
      clearForceGraph2dCanvas(graph2dRef.current, resolvedBgColor)
    }
    if (viewMode === "3d" && layoutLocked && !map_mode) {
      stabilize3dSimulation(graph3dRef.current)
      syncOrbitControlsFromCamera(graph3dRef.current)
    }
  }, [viewMode, mounted2d, mounted3d, layoutLocked, perf.freezeSimulation, map_mode, mapCanvas3d, resolvedBgColor])

  useEffect(() => {
    const g3 = graph3dRef.current
    if (!g3?.d3VelocityDecay || !g3?.d3AlphaDecay) return
    try {
      g3.d3VelocityDecay(perf.d3VelocityDecay)
      g3.d3AlphaDecay(perf.d3AlphaDecay)
    } catch { /* noop */ }
  }, [perf.d3VelocityDecay, perf.d3AlphaDecay, mounted3d])

  useEffect(() => {
    if (!mounted3d) {
      controlsTunedRef.current = false
      return
    }
    const id = requestAnimationFrame(() => {
      tune3dControls(graph3dRef.current)
      controlsTunedRef.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [mounted3d, containerWidth, height])

  useEffect(() => {
    if (width) { setContainerWidth(width); return }
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => { for (const e of entries) setContainerWidth(e.contentRect.width) })
    ro.observe(el); setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [width])

  useEffect(() => {
    if (streamlitMode) {
      if (heightProp !== null) { setHeight(heightProp); return }
      const update = () => setHeight(Math.round(getParentViewportHeight() * AUTO_HEIGHT_VH))
      try { window.parent.addEventListener("resize", update) } catch { window.addEventListener("resize", update) }
      update()
      return () => {
        try { window.parent.removeEventListener("resize", update) } catch { window.removeEventListener("resize", update) }
      }
    }

    const update = () => setHeight(window.innerHeight)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [heightProp, streamlitMode])

  useEffect(() => {
    if (streamlitMode) Streamlit.setFrameHeight(height)
  }, [height, streamlitMode])

  useEffect(() => {
    const g = graph3dRef.current; if (!g || !perf.useCustom3dNodes) return
    try {
      const renderer = (g as any).renderer() as THREE.WebGLRenderer
      const scene = (g as any).scene() as THREE.Scene
      const RIM_NAME = "__kg3d_rim"
      if (hqMode && perf.allowHq) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.3
        if (!scene.getObjectByName(RIM_NAME)) {
          const rim = new THREE.PointLight(0x6699ff, 2.0, 1200)
          rim.name = RIM_NAME; rim.position.set(-300, 300, -200); scene.add(rim)
        }
      } else {
        renderer.toneMapping = THREE.NoToneMapping
        renderer.toneMappingExposure = 1.0
        const rim = scene.getObjectByName(RIM_NAME); if (rim) scene.remove(rim)
      }
      ;(g as any).refresh?.()
    } catch {}
  }, [hqMode, perf.useCustom3dNodes, perf.allowHq])

  useEffect(() => {
    const g = graph3dRef.current; if (!g) return
    try {
      const camera = (g as any).camera() as THREE.PerspectiveCamera
      const scene  = (g as any).scene()  as THREE.Scene
      // Camera must be in the scene for its children to render
      if (!camera.parent) scene.add(camera)
      // Remove any existing grain overlay
      const old = camera.getObjectByName(GRAIN_PLANE_NAME)
      if (old) camera.remove(old)
      if (!sandyBg) return
      // Build a plane that exactly covers the viewport, parented to the camera
      const dist   = 0.2                                         // just past near clip plane (default near = 0.1)
      const vFov   = (camera.fov * Math.PI) / 180
      const planeH = 2 * Math.tan(vFov / 2) * dist
      const planeW = planeH * camera.aspect
      const [grainStrength, grainRepeatX, grainRepeatY] =
        grain_density === "light"  ? [0.06,  6,  4] :
        grain_density === "dense"  ? [0.22, 16, 11] :
                                     [0.13, 10,  7]   // medium (default)
      const tex = createGrainOverlay(grainStrength)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(grainRepeatX, grainRepeatY)
      const grain = new THREE.Mesh(
        new THREE.PlaneGeometry(planeW, planeH),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true,
          depthTest: false, depthWrite: false,
          blending: THREE.NormalBlending,
        })
      )
      grain.name = GRAIN_PLANE_NAME
      grain.position.set(0, 0, -dist)
      camera.add(grain)
    } catch {}
  }, [sandyBg, grain_density, height, containerWidth])

  const focusSet = useMemo(() => {
    if (focusRootId == null || !enable_focus) return null
    if (map_mode) {
      if (legend_node_by) {
        const root = (graph_data.nodes as NodeData[]).find(n => n.id === focusRootId)
        const group = root ? String(root[legend_node_by] ?? "") : ""
        const nodeIds = new Set<string | number>()
        for (const n of graph_data.nodes as NodeData[]) {
          if (String(n[legend_node_by] ?? "") === group) nodeIds.add(n.id)
        }
        return { nodeIds, linkKeys: new Set<string>() }
      }
      return { nodeIds: new Set([focusRootId]), linkKeys: new Set<string>() }
    }
    return computeNeighborhood(focusRootId, focus_hops, graphLinks as GraphLink[])
  }, [focusRootId, focus_hops, enable_focus, graphLinks, map_mode, legend_node_by, graph_data.nodes])

  const legendNodeEntries = useMemo(
    () => buildLegendFromField(graph_data.nodes as Record<string, unknown>[], legend_node_by ?? undefined),
    [graph_data.nodes, legend_node_by],
  )
  const legendEdgeEntries = useMemo(
    () => buildLegendFromField(graph_data.edges as Record<string, unknown>[], legend_edge_by ?? undefined),
    [graph_data.edges, legend_edge_by],
  )

  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    return new Set(
      (graph_data.nodes as NodeData[])
        .filter(node => nodeMatchesSearch(node, searchQuery, search_keys, node_label))
        .map(node => String(node.id)),
    )
  }, [searchQuery, graph_data.nodes, node_label, search_keys])

  const emitSelectionChange = useCallback(() => {
    if (!streamlitMode) return
    Streamlit.setComponentValue({
      type: "selection_change",
      node_ids: [...highlightedNodes],
      focus_id: focusRootId,
    })
  }, [streamlitMode, highlightedNodes, focusRootId])

  const selectionInitRef = useRef(true)
  useEffect(() => {
    if (selectionInitRef.current) {
      selectionInitRef.current = false
      return
    }
    emitSelectionChange()
  }, [emitSelectionChange])

  const nodePassesFilters = useCallback((node: NodeData) => {
    if (legend_node_by) {
      const t = String(node[legend_node_by] ?? "")
      if (hiddenNodeTypes.has(t)) return false
    }
    if (focusSet) return focusSet.nodeIds.has(node.id)
    return true
  }, [legend_node_by, hiddenNodeTypes, focusSet])

  const linkPassesFilters = useCallback((link: GraphLink) => {
    if (link.__synthetic) return false
    if (legend_edge_by) {
      const t = String(link[legend_edge_by] ?? "")
      if (hiddenEdgeTypes.has(t)) return false
    }
    if (focusSet) return focusSet.linkKeys.has(linkKey(link))
    return true
  }, [legend_edge_by, hiddenEdgeTypes, focusSet])

  const nodeVisibilityFn = useCallback(
    (node: NodeData) => nodePassesFilters(node),
    [nodePassesFilters],
  )
  const linkVisibilityFn = useCallback(
    (link: GraphLink) => !mapCanvas3d && !showInstancedLayer && linkPassesFilters(link),
    [linkPassesFilters, showInstancedLayer, mapCanvas3d],
  )

  const mapClusterCentroids = useMemo(() => {
    if (!map_mode || !legend_node_by) return []
    return computeClusterCentroids(
      graph2dData.nodes as NodeData[],
      legend_node_by,
      getMapSourceCoord,
      node_color,
      nodePassesFilters,
    )
  }, [map_mode, legend_node_by, graph2dData.nodes, getMapSourceCoord, node_color, nodePassesFilters])

  const pickMapOverlayNode = useCallback((clientX: number, clientY: number): NodeData | null => {
    const canvas = mapOverlayRef.current
    const g2 = graph2dRef.current as Graph2dViewApi | null
    if (!canvas || !g2?.graph2ScreenCoords || !mapCanvas3d) return null

    const rect = canvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const zoom = g2.zoom?.() ?? 1

    const projected = projectMapNodes(
      graph2dData.nodes as NodeData[],
      mapCamera,
      getMapSourceCoord,
    )
    const depthBounds = depthRange(projected)

    let best: { node: NodeData; dist2: number } | null = null
    for (const node of projected) {
      if (!nodePassesFilters(node)) continue
      const screen = g2.graph2ScreenCoords(node.x ?? 0, node.y ?? 0)
      const sizeVal = getNodeSize(node, node_size)
      let radius = nodeRadius(sizeVal) * 1.15 * zoom
      const d = (node as NodeData & { __mapDepth?: number }).__mapDepth ?? depthBounds.min
      radius *= depthScale(d, depthBounds.min, depthBounds.max)
      const dx = screen.x - sx
      const dy = screen.y - sy
      const dist2 = dx * dx + dy * dy
      if (dist2 <= radius * radius && (!best || dist2 < best.dist2)) {
        best = { node, dist2 }
      }
    }
    return best?.node ?? null
  }, [
    mapCanvas3d,
    graph2dData.nodes,
    mapCamera,
    getMapSourceCoord,
    nodePassesFilters,
    node_size,
  ])

  const redrawMapOverlay = useCallback(() => {
    const canvas = mapOverlayRef.current
    const g2 = graph2dRef.current as Graph2dViewApi | null
    if (!canvas || !g2?.graph2ScreenCoords || !mapCanvas3d) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(containerWidth * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${containerWidth}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, containerWidth, height)
    ctx.fillStyle = resolvedBgColor
    ctx.fillRect(0, 0, containerWidth, height)

    const zoom = g2.zoom?.() ?? 1

    const projected = projectMapNodes(
      graph2dData.nodes as NodeData[],
      mapCamera,
      getMapSourceCoord,
    )
    mapDepthBoundsRef.current = depthRange(projected)
    const depthBounds = mapDepthBoundsRef.current

    for (const node of projected) {
      if (!nodePassesFilters(node)) continue
      const sizeVal = getNodeSize(node, node_size)
      let radius = nodeRadius(sizeVal) * 1.15 * zoom
      const d = (node as NodeData & { __mapDepth?: number }).__mapDepth ?? depthBounds.min
      radius *= depthScale(d, depthBounds.min, depthBounds.max)
      const screen = g2.graph2ScreenCoords(node.x ?? 0, node.y ?? 0)
      const color = getNodeColor(node, node_color)
      const isSearch = searchMatchIds.has(String(node.id))
      const isSelected = highlightedNodes.has(node.id)
      const isHovered = hoveredNode?.id === node.id
      const interactionState = { isSearch, isSelected, isHovered }
      paintMapNodeInteraction(ctx, screen.x, screen.y, radius, color, interactionState, perf.light2dEffects)
      const fillAlpha = isSelected ? 0.92 : isHovered ? 0.72 : NODE_OPACITY
      drawSphere2d(ctx, screen.x, screen.y, radius, color, hqMode && perf.allowHq, fillAlpha)
      if (effectiveLabelsOn) {
        drawNodeLabel2d(
          ctx,
          screen.x,
          screen.y,
          radius,
          String(node[node_label] ?? node.id),
          label_outline,
        )
      }
    }

    for (const cluster of mapClusterCentroids) {
      const projected = projectMapPoint(cluster.x, cluster.y, cluster.z, mapCamera)
      const screen = g2.graph2ScreenCoords(projected.x, projected.y)
      drawClusterLabel2d(ctx, screen.x, screen.y, cluster.label, 15)
    }
  }, [
    mapCanvas3d,
    containerWidth,
    height,
    graph2dData.nodes,
    getMapSourceCoord,
    nodePassesFilters,
    node_size,
    node_color,
    node_label,
    effectiveLabelsOn,
    label_outline,
    searchMatchIds,
    highlightedNodes,
    hoveredNode,
    hqMode,
    perf.allowHq,
    perf.light2dEffects,
    mapCamera,
    mapClusterCentroids,
    resolvedBgColor,
  ])

  useEffect(() => {
    if (mapCanvas3d) return
    mapOrbitRef.current = null
  }, [mapCanvas3d])

  useEffect(() => {
    if (!mapCanvas3d) return
    clearForceGraph2dCanvas(graph2dRef.current, resolvedBgColor)
    let raf = 0
    const loop = () => {
      redrawMapOverlay()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [mapCanvas3d, redrawMapOverlay, resolvedBgColor])

  useEffect(() => {
    if (!mapCanvas3d) return
    const id = requestAnimationFrame(() => fitMapCanvas3dRef.current?.())
    return () => cancelAnimationFrame(id)
  }, [mapCanvas3d, graph2dData.nodes.length])

  useEffect(() => {
    if (!mapCanvas3d) return
    let cancelled = false

    const bind = () => {
      if (cancelled) return
      const canvas = mapOverlayRef.current
      if (!canvas) {
        requestAnimationFrame(bind)
        return
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const g2 = graph2dRef.current as Graph2dViewApi | null
        if (!g2?.zoom || !g2.centerAt || !g2.screen2GraphCoords) return
        const rect = canvas.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const zoomFactor = e.deltaY > 0 ? 1 / 1.12 : 1.12
        const k = Math.max(0.01, Math.min(500, g2.zoom() * zoomFactor))
        const pointer = g2.screen2GraphCoords(sx, sy)
        const center = g2.centerAt() as { x?: number; y?: number }
        const cx = center.x ?? 0
        const cy = center.y ?? 0
        const scaleRatio = 1 - 1 / zoomFactor
        g2.zoom(k, 0)
        g2.centerAt(cx + (pointer.x - cx) * scaleRatio, cy + (pointer.y - cy) * scaleRatio, 0)
      }

      const onPointerMove = (e: MouseEvent) => {
        if (mapOrbitRef.current) return
        const node = pickMapOverlayNode(e.clientX, e.clientY)
        setHoveredNode(node)
        canvas.style.cursor = node ? "pointer" : "grab"
      }

      const panMapView = (clientX: number, clientY: number, lastX: number, lastY: number) => {
        const g2 = graph2dRef.current as Graph2dViewApi | null
        if (!g2?.centerAt || !g2.screen2GraphCoords) return
        const center = g2.centerAt() as { x?: number; y?: number }
        const cx = center.x ?? 0
        const cy = center.y ?? 0
        const from = g2.screen2GraphCoords(lastX, lastY)
        const to = g2.screen2GraphCoords(clientX, clientY)
        g2.centerAt(cx + (from.x - to.x), cy + (from.y - to.y), 0)
      }

      const onMouseDown = (e: MouseEvent) => {
        const isPan = e.button === 1 || (e.button === 0 && e.shiftKey) || e.button === 2
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
        e.preventDefault()
        e.stopPropagation()

        const picked = !isPan ? pickMapOverlayNode(e.clientX, e.clientY) : null
        if (picked) {
          mapPickDownRef.current = { node: picked, x: e.clientX, y: e.clientY }
          const onPickUp = (ev: MouseEvent) => {
            const down = mapPickDownRef.current
            if (down) {
              const dx = ev.clientX - down.x
              const dy = ev.clientY - down.y
              if (dx * dx + dy * dy < 36) onNodeClickRef.current(down.node)
            }
            mapPickDownRef.current = null
            window.removeEventListener("mouseup", onPickUp)
          }
          window.addEventListener("mouseup", onPickUp)
          return
        }

        const downX = e.clientX
        const downY = e.clientY
        let dragActive = false
        let lastX = e.clientX
        let lastY = e.clientY

        const onDragMove = (ev: MouseEvent) => {
          const dx = ev.clientX - downX
          const dy = ev.clientY - downY
          if (!dragActive && dx * dx + dy * dy < 36) return
          if (!dragActive) {
            dragActive = true
            lastX = ev.clientX
            lastY = ev.clientY
            if (!isPan) mapOrbitRef.current = { lastX: ev.clientX, lastY: ev.clientY }
          }
          if (isPan) {
            panMapView(ev.clientX, ev.clientY, lastX, lastY)
            lastX = ev.clientX
            lastY = ev.clientY
            return
          }
          const orbit = mapOrbitRef.current
          if (!orbit) return
          const odx = ev.clientX - orbit.lastX
          const ody = ev.clientY - orbit.lastY
          mapOrbitRef.current = { lastX: ev.clientX, lastY: ev.clientY }
          setMapCamera(prev => ({
            yaw: prev.yaw + odx * 0.008,
            pitch: Math.max(-1.25, Math.min(1.25, prev.pitch + ody * 0.008)),
          }))
        }
        const onDragUp = () => {
          if (!dragActive && !isPan) {
            setHighlightedNodes(new Set())
            setFocusRootId(null)
          }
          mapOrbitRef.current = null
          window.removeEventListener("mousemove", onDragMove)
          window.removeEventListener("mouseup", onDragUp)
        }
        window.addEventListener("mousemove", onDragMove)
        window.addEventListener("mouseup", onDragUp)
      }

      const onContextMenu = (e: MouseEvent) => e.preventDefault()

      canvas.addEventListener("mousemove", onPointerMove)
      canvas.addEventListener("mousedown", onMouseDown, true)
      canvas.addEventListener("contextmenu", onContextMenu)
      canvas.addEventListener("wheel", onWheel, { passive: false, capture: true })
      cleanup = () => {
        canvas.removeEventListener("mousemove", onPointerMove)
        canvas.removeEventListener("mousedown", onMouseDown, true)
        canvas.removeEventListener("contextmenu", onContextMenu)
        canvas.removeEventListener("wheel", onWheel, true)
      }
    }

    let cleanup: (() => void) | undefined
    bind()
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [mapCanvas3d, containerWidth, height, pickMapOverlayNode])

  const paintMapGraphBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!mapCanvas3d) return
    const canvas = ctx.canvas
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = resolvedBgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }, [mapCanvas3d, resolvedBgColor])

  const paintMapClusterLabels2d = useCallback((
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (!map_mode || mapCanvas3d || mapClusterCentroids.length === 0) return
    const fontSize = 15 / Math.max(globalScale, 0.05)
    for (const cluster of mapClusterCentroids) {
      drawClusterLabel2d(ctx, cluster.x, cluster.y, cluster.label, fontSize)
    }
  }, [map_mode, mapCanvas3d, mapClusterCentroids])

  const paintMapGraph2dFramePost = useCallback((
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (mapCanvas3d) {
      paintMapGraphBackground(ctx)
      return
    }
    paintMapClusterLabels2d(ctx, globalScale)
  }, [mapCanvas3d, paintMapGraphBackground, paintMapClusterLabels2d])

  const highlightedIdStrings = useMemo(
    () => new Set([...highlightedNodes].map(String)),
    [highlightedNodes],
  )

  const getInstancedParent = useCallback((): THREE.Object3D | null => {
    const g = graph3dRef.current
    const scene = g?.scene?.() as THREE.Scene | null
    if (!scene) return null
    return resolveForceGraphRoot(scene)
  }, [])

  const rebuildInstancedLayer = useCallback(() => {
    const layer = instancedLayerRef.current
    const parent = getInstancedParent()
    if (!layer || !parent || !showInstancedLayer) return
    const nodes = graph3dData.nodes as NodeData[]
    layer.attach(parent, nodes, {
      getColor: (node) => getNodeColor(node, node_color),
      isVisible: nodePassesFilters,
      highlightIds: highlightedIdStrings,
      searchIds: searchMatchIds,
    })
    layer.setPointSize(lodPointSize(0, nodes.length))
  }, [
    showInstancedLayer,
    getInstancedParent,
    graph3dData.nodes,
    node_color,
    nodePassesFilters,
    highlightedIdStrings,
    searchMatchIds,
  ])

  useEffect(() => {
    if (!showInstancedLayer || !mounted3d) return
    let cancelled = false
    let retries = 0
    const attach = () => {
      if (cancelled) return
      rebuildInstancedLayer()
      const g3 = graph3dRef.current
      if (g3) fitMapCamera(g3, graph3dData.nodes as NodeData[])
      const count = instancedLayerRef.current?.count ?? 0
      if (count === 0 && retries < 8 && !cancelled) {
        retries += 1
        requestAnimationFrame(attach)
      }
    }
    const id = requestAnimationFrame(attach)
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
      const parent = getInstancedParent()
      if (parent) instancedLayerRef.current?.dispose(parent)
    }
  }, [showInstancedLayer, mounted3d, rebuildInstancedLayer, getInstancedParent, hiddenNodeTypes, hiddenEdgeTypes, graph3dData.nodes])

  useEffect(() => {
    if (!showInstancedLayer) return
    instancedLayerRef.current?.updateColors({
      getColor: (node) => getNodeColor(node, node_color),
      isVisible: nodePassesFilters,
      highlightIds: highlightedIdStrings,
      searchIds: searchMatchIds,
    })
  }, [showInstancedLayer, searchMatchIds, highlightedIdStrings, node_color, nodePassesFilters])

  // Search glow effect (3D) + camera / pan (both modes)
  useEffect(() => {
    if (viewMode === "3d" && perf.useCustom3dNodes) {
      for (const node of graph3dData.nodes as NodeData[]) {
        const threeObj = (node as any).__threeObj as THREE.Object3D | undefined
        if (threeObj) {
          const existing = threeObj.getObjectByName(SEARCH_GLOW_NAME)
          if (existing) threeObj.remove(existing)
        }
      }
      if (searchQuery.trim()) {
        for (const node of graph3dData.nodes as NodeData[]) {
          if (!searchMatchIds.has(String(node.id))) continue
          const threeObj = (node as any).__threeObj as THREE.Object3D | undefined
          if (threeObj) {
            const size = getNodeSize(node, node_size)
            const radius = nodeRadius(size)
            threeObj.add(createGlow(radius, "#f0b429", SEARCH_GLOW_NAME))
          }
        }
      }
    }

    if (!searchQuery.trim() || !getGraph()) return
    const first = (graph3dData.nodes as NodeData[]).find(n => searchMatchIds.has(String(n.id)))
    if (!first) return

    if (viewMode === "3d") {
      const { x = 0, y = 0, z = 0 } = first as NodeData & { x?: number; y?: number; z?: number }
      const d = Math.hypot(x, y, z) || 1
      const scale = 1 + 100 / d
      getGraph("3d").cameraPosition(
        { x: x * scale, y: y * scale, z: z * scale },
        { x, y, z },
        800
      )
    } else {
      const { x = 0, y = 0 } = first as NodeData & { x?: number; y?: number }
      getGraph("2d").centerAt(x, y, 800)
      if (getGraph("2d").zoom() < 1.5) getGraph("2d").zoom(1.8, 800)
    }
  }, [searchQuery, searchMatchIds, graph3dData.nodes, node_size, viewMode, getGraph, perf.useCustom3dNodes])

  // Hover glow (3D) — custom node meshes only
  useEffect(() => {
    if (viewMode !== "3d" || !perf.useCustom3dNodes) return

    for (const node of graph3dData.nodes as NodeData[]) {
      const threeObj = (node as any).__threeObj as THREE.Object3D | undefined
      if (threeObj) {
        const existing = threeObj.getObjectByName(HOVER_GLOW_NAME)
        if (existing) threeObj.remove(existing)
      }
    }

    if (!hoveredNode) return

    const graphNode = (graph3dData.nodes as NodeData[]).find(n => n.id === hoveredNode.id)
    if (!graphNode) return
    if (searchMatchIds.has(String(graphNode.id))) return

    const threeObj = (graphNode as any).__threeObj as THREE.Object3D | undefined
    if (!threeObj || threeObj.getObjectByName(GLOW_NAME) || threeObj.getObjectByName(SEARCH_GLOW_NAME)) return

    const color = getNodeColor(graphNode, node_color)
    const radius = nodeRadius(getNodeSize(graphNode, node_size))
    threeObj.add(createGlow(hoverGlowRadius(radius), color, HOVER_GLOW_NAME))
  }, [viewMode, hoveredNode, graph3dData.nodes, node_color, node_size, searchMatchIds, perf.useCustom3dNodes])

  useEffect(() => {
    if (viewMode === "2d" && !mapCanvas3d) graph2dRef.current?.refresh?.()
    if (viewMode === "3d" && perf.useCustom3dNodes && !map_mode && !showInstancedLayer) {
      for (const node of graph3dData.nodes as NodeData[]) {
        delete (node as { __threeObj?: THREE.Object3D }).__threeObj
      }
      graph3dRef.current?.refresh?.()
    }
  }, [viewMode, mapCanvas3d, map_mode, showInstancedLayer, hoveredNode, highlightedNodes, searchMatchIds, labelsOn, hqMode, effectiveLabelsOn, graph3dData.nodes, perf.useCustom3dNodes])

  // Clear search glows when search is closed (3D only)
  useEffect(() => {
    if (viewMode !== "3d" || !searchOpen) {
      if (viewMode !== "3d") return
      for (const node of graph3dData.nodes as NodeData[]) {
        const threeObj = (node as any).__threeObj as THREE.Object3D | undefined
        if (threeObj) {
          const existing = threeObj.getObjectByName(SEARCH_GLOW_NAME)
          if (existing) threeObj.remove(existing)
        }
      }
    }
  }, [searchOpen, graph3dData.nodes, viewMode])

  const ensureLights = useCallback(() => {
    const g = graph3dRef.current; if (!g) return
    const scene = g.scene(); if (!scene || scene.userData.__kg3dLights) return
    scene.userData.__kg3dLights = true
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(200, 200, 200); scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-200, -100, -200); scene.add(fill)
  }, [])

  const refresh3dScene = useCallback(() => {
    ensureLights()
    graph3dRef.current?.refresh?.()
  }, [ensureLights])

  const onLayoutSettled = useCallback(() => {
    if (layoutLocked) return
    releasePinnedNodes(graph3dData.nodes)
    releasePinnedNodes(graph2dData.nodes)
  }, [graph3dData.nodes, graph2dData.nodes, layoutLocked])

  const onEngineTick3d = useCallback(() => {
    if (!showInstancedLayer) return
    const layer = instancedLayerRef.current
    const parent = getInstancedParent()
    if (!layer || !parent) return
    if (!layer.count || !parent.getObjectByName(INSTANCED_POINTS_LAYER_NAME)) {
      rebuildInstancedLayer()
    }
  }, [showInstancedLayer, rebuildInstancedLayer, getInstancedParent])

  const onEngineStop3d = useCallback(() => {
    const g3 = graph3dRef.current
    if (layoutLocked && use_coordinates && !showInstancedLayer && !map_mode) {
      restorePinned3dCoordinates(graph3dData.nodes, layoutXYZRef.current)
    }
    if (perf.freezeSimulation) stabilize3dSimulation(g3)
    if (!controlsTunedRef.current && g3) {
      tune3dControls(g3)
      controlsTunedRef.current = true
    }
    if (viewMode === "3d" && g3 && !map_mode) {
      captureLayoutSnapshot(
        g3,
        "3d",
        layoutXYZRef.current,
        layoutScreenRef.current,
      )
    }
    if (!layoutLocked) onLayoutSettled()
    if (showInstancedLayer && g3) {
      rebuildInstancedLayer()
      ensureLights()
      fitMapCamera(g3, graph3dData.nodes as NodeData[])
      tune3dControls(g3)
    } else if (map_mode && viewMode === "3d" && g3) {
      restoreMapPinnedCoordinates(graph3dData.nodes as NodeData[])
      ensureLights()
      fitMapCamera(g3, graph3dData.nodes as NodeData[])
      tune3dControls(g3)
      refresh3dScene()
    } else {
      refresh3dScene()
    }
    if (pendingLayoutSyncRef.current && layoutLocked && effectiveViewMode === "3d") {
      finalizeLayoutAfterToggle(
        graph2dData,
        graph3dData,
        "3d",
        toggleFromModeRef.current,
        graph2dRef.current,
        graph3dRef.current,
        layoutScreenRef.current,
        layoutXYZRef.current,
        viewTransform2dRef.current,
        viewTransform3dRef.current,
        { width: containerWidth, height },
        layoutCaptureSizeRef.current,
        v => { viewTransform2dRef.current = v },
      )
      pendingLayoutSyncRef.current = false
      stabilize3dSimulation(g3)
    }
  }, [onLayoutSettled, refresh3dScene, rebuildInstancedLayer, layoutLocked, effectiveViewMode, viewMode, graph2dData, graph3dData, use_coordinates, containerWidth, height, perf.freezeSimulation, showInstancedLayer, map_mode, ensureLights])

  const onEngineStop2d = useCallback(() => {
    if (mapCanvas3d) return
    if (map_mode && viewMode === "2d" && graph2dRef.current?.zoomToFit) {
      graph2dRef.current.zoomToFit(400, 24)
    }
    if (viewMode === "2d" && graph2dRef.current) {
      captureLayoutSnapshot(
        graph2dRef.current,
        "2d",
        layoutXYZRef.current,
        layoutScreenRef.current,
      )
    }
    if (!layoutLocked) onLayoutSettled()
    if (layoutLocked && use_coordinates && mounted3d) {
      restorePinned3dCoordinates(graph3dData.nodes, layoutXYZRef.current)
      stabilize3dSimulation(graph3dRef.current)
    }
    if (pendingLayoutSyncRef.current && layoutLocked && viewMode === "2d") {
      finalizeLayoutAfterToggle(
        graph2dData,
        graph3dData,
        "2d",
        toggleFromModeRef.current,
        graph2dRef.current,
        graph3dRef.current,
        layoutScreenRef.current,
        layoutXYZRef.current,
        viewTransform2dRef.current,
        viewTransform3dRef.current,
        { width: containerWidth, height },
        layoutCaptureSizeRef.current,
        v => { viewTransform2dRef.current = v },
      )
      pendingLayoutSyncRef.current = false
      needs2dZoomFitRef.current = false
    } else if (needs2dZoomFitRef.current && viewMode === "2d" && graph2dRef.current) {
      const fitted = fit2dViewToCapturedScreen(
        graph2dRef.current,
        graph2dData.nodes,
        layoutScreenRef.current,
        containerWidth,
        height,
        layoutCaptureSizeRef.current?.width,
        layoutCaptureSizeRef.current?.height,
      )
      if (fitted) viewTransform2dRef.current = fitted
      needs2dZoomFitRef.current = false
    }
  }, [onLayoutSettled, layoutLocked, viewMode, graph2dData, graph3dData, use_coordinates, mounted3d, containerWidth, height, map_mode, mapCanvas3d])

  const emitNodeClick = useCallback((node: NodeData) => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      if (k === "__threeObj" || k === "fx" || k === "fy" || k === "fz") continue
      if (typeof v !== "object" || v === null) clean[k] = v
    }
    if (streamlitMode) {
      Streamlit.setComponentValue({ type: "node_click", node: clean })
    }
  }, [streamlitMode])

  const onNodeClick = useCallback((node: NodeData) => {
    const now = Date.now()
    if (
      enable_focus
      && !map_mode
      && lastClickRef.current?.id === node.id
      && now - lastClickRef.current.t < 400
    ) {
      setFocusRootId(node.id)
      lastClickRef.current = null
      emitNodeClick(node)
      return
    }
    lastClickRef.current = { id: node.id, t: now }

    if (enable_multi_select) {
      setHighlightedNodes(prev => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
    } else if (viewMode === "2d" || map_mode) {
      setHighlightedNodes(prev => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
    }

    if (viewMode === "3d" && perf.useCustom3dNodes && !map_mode) {
      const threeObj = (node as any).__threeObj as THREE.Object3D | undefined
      if (threeObj) {
        const existing = threeObj.getObjectByName(GLOW_NAME)
        if (existing) {
          threeObj.remove(existing)
        } else {
          const color = getNodeColor(node, node_color)
          const radius = nodeRadius(getNodeSize(node, node_size))
          threeObj.add(createGlow(radius, color))
        }
      }
    }
    emitNodeClick(node)
  }, [viewMode, map_mode, node_color, node_size, emitNodeClick, perf.useCustom3dNodes, enable_focus, enable_multi_select])

  onNodeClickRef.current = onNodeClick

  const onLinkClick = useCallback((link: Record<string, unknown>) => {
    if (link.__synthetic) return

    if (viewMode === "3d") {
      const threeObj = (link as any).__threeObj as THREE.Object3D | undefined
      if (threeObj) {
        const existing = threeObj.getObjectByName(EDGE_GLOW_NAME)
        if (existing) {
          threeObj.remove(existing)
        } else {
          let geo: THREE.BufferGeometry | null = null
          if ((threeObj as any).isLine) geo = (threeObj as THREE.Line).geometry
          else threeObj.traverse(o => { if ((o as any).isLine && !geo) geo = (o as THREE.Line).geometry })

          if (geo) {
            const glowGroup = new THREE.Group(); glowGroup.name = EDGE_GLOW_NAME
            const N = 6
            for (let i = 0; i < N; i++) {
              const t2 = i / (N - 1)
              const opacity = 0.55 * Math.exp(-t2 * 3)
              glowGroup.add(new THREE.Line(
                geo,
                new THREE.LineBasicMaterial({
                  color: new THREE.Color("#ffffff"),
                  transparent: true, opacity,
                  depthWrite: false,
                  blending: THREE.AdditiveBlending,
                })
              ))
            }
            threeObj.add(glowGroup)
          }
        }
      }
    }

    const s = link.source, t = link.target
    if (streamlitMode) {
      Streamlit.setComponentValue({ type: "edge_click", edge: {
        source: s && typeof s === "object" ? (s as NodeData).id : s,
        target: t && typeof t === "object" ? (t as NodeData).id : t,
      }})
    }
  }, [streamlitMode, viewMode])

  const onNodeHover = useCallback((node: NodeData | null) => {
    setHoveredNode(node)
  }, [])

  const pickInstancedNode = useCallback((clientX: number, clientY: number): NodeData | null => {
    const g = graph3dRef.current
    const layer = instancedLayerRef.current
    const rect = containerRef.current?.getBoundingClientRect()
    if (!g || !layer || !rect?.width || !rect.height) return null
    const camera = g.camera?.() as THREE.Camera | undefined
    if (!camera) return null
    pointerNdcRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointerNdcRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
    return layer.pick(
      raycasterRef.current,
      pointerNdcRef.current,
      camera,
      rect.width,
      rect.height,
    )
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    if (mapCanvas3d) {
      setHoveredNode(pickMapOverlayNode(e.clientX, e.clientY))
    } else if (showInstancedLayer) {
      setHoveredNode(pickInstancedNode(e.clientX, e.clientY))
    }
  }, [mapCanvas3d, showInstancedLayer, pickInstancedNode, pickMapOverlayNode])

  const onContainerClick = useCallback((e: React.MouseEvent) => {
    if (mapCanvas3d) return
    if (!showInstancedLayer) return
    const node = pickInstancedNode(e.clientX, e.clientY)
    if (node) onNodeClick(node)
  }, [mapCanvas3d, showInstancedLayer, pickInstancedNode, onNodeClick])

  const nodeCanvasObject2d = useCallback((node: NodeData, ctx: CanvasRenderingContext2D) => {
    if (mapCanvas3d) return
    const sizeVal = getNodeSize(node, node_size)
    const radius = nodeRadius(sizeVal) * (map_mode ? 1.15 : 1)
    const color = getNodeColor(node, node_color)
    const x = node.x ?? 0
    const y = node.y ?? 0
    const isSearch = searchMatchIds.has(String(node.id))
    const isSelected = highlightedNodes.has(node.id)
    const isHovered = hoveredNode?.id === node.id
    const interactionState = { isSearch, isSelected, isHovered }
    paintMapNodeInteraction(ctx, x, y, radius, color, interactionState, perf.light2dEffects)
    const fillAlpha = isSelected ? 0.92 : isHovered ? 0.72 : NODE_OPACITY
    drawSphere2d(ctx, x, y, radius, color, hqMode && perf.allowHq, fillAlpha)

    if (effectiveLabelsOn) {
      drawNodeLabel2d(ctx, x, y, radius, String(node[node_label] ?? node.id), label_outline)
    }
  }, [node_color, node_size, node_label, effectiveLabelsOn, label_outline, searchMatchIds, highlightedNodes, hoveredNode, hqMode, perf.light2dEffects, perf.allowHq, map_mode, mapCanvas3d])

  const nodeVisibilityFor2d = useCallback(
    (node: NodeData) => (mapCanvas3d ? false : nodePassesFilters(node)),
    [mapCanvas3d, nodePassesFilters],
  )

  const nodeColor3d = useCallback(
    (node: NodeData) => getNodeColor(node, node_color),
    [node_color],
  )
  const nodeVal3d = useCallback(
    (node: NodeData) => {
      const r = nodeRadius(getNodeSize(node, node_size))
      const scale = map_mode ? 2.2 : 1
      return ((r * scale) / 4) ** 2
    },
    [node_size, map_mode],
  )

  const nodeVal2d = useCallback(
    (node: NodeData) => {
      const r = nodeRadius(getNodeSize(node, node_size)) * (map_mode ? 1.15 : 1)
      return (r / 4) ** 2
    },
    [node_size, map_mode],
  )
  const nodeLabel3d = useCallback(
    (node: NodeData) => {
      if (!labelsOn) return ""
      const label = String(node[node_label] ?? node.id)
      if (map_mode) return label
      if (effectiveLabelsOn) return label
      if (labelsOnHover3d) {
        if (hoveredNode?.id === node.id || searchMatchIds.has(String(node.id))) return label
      }
      return ""
    },
    [node_label, map_mode, labelsOn, effectiveLabelsOn, labelsOnHover3d, hoveredNode, searchMatchIds],
  )

  const nodeLabel2d = useCallback(
    (node: NodeData) => (effectiveLabelsOn ? String(node[node_label] ?? node.id) : ""),
    [effectiveLabelsOn, node_label],
  )

  const linkColorFn = useCallback(
    (link: Record<string, unknown>) => {
      if (!isColorString(edge_color)) {
        const perLink = link[edge_color] as string | undefined
        if (perLink) return perLink
      }
      return resolveLinkColor(link, edge_color)
    },
    [edge_color]
  )
  const linkWidthFn = useCallback(
    (link: Record<string, unknown>) =>
      typeof edge_width === "number" ? edge_width : (link[edge_width] as number) ?? 1.5,
    [edge_width],
  )

  const linkLabelFn = useCallback(
    (link: GraphLink) => {
      if (!show_edge_labels || graph_data.nodes.length > 800) return ""
      return getEdgeLabel(link, edge_label)
    },
    [show_edge_labels, edge_label, graph_data.nodes.length],
  )

  const nodeThreeObject = useCallback((node: NodeData) => {
    const color = getNodeColor(node, node_color)
    const size = getNodeSize(node, node_size)
    const radius = nodeRadius(size) * (map_mode ? 2.4 : 1)
    // In HQ mode, darken the base colour to compensate for scene lights and ACES exposure boost
    const hqColor = hqMode ? new THREE.Color(color).multiplyScalar(0.55) : null
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(radius, hqMode ? 32 : 16, hqMode ? 24 : 12),
      hqMode
        // HQ: physically-based material — darkened base so lit result matches the intended shade
        ? new THREE.MeshStandardMaterial({
            color: hqColor!,
            metalness: 0.15,
            roughness: 0.4,
            transparent: true,
            opacity: NODE_OPACITY,
          })
        // Standard: flat unlit colour — exact shade every time, cheapest shader for dense graphs
        : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: NODE_OPACITY })
    )
    if (!effectiveLabelsOn) return body
    const group = new THREE.Group(); group.add(body)
    const sprite = new SpriteText((node[node_label] as string) ?? String(node.id))
    sprite.color = "#ffffff"
    sprite.textHeight = radius * 0.8
    sprite.fontFace = LABEL_FONT_FACE
    sprite.fontWeight = LABEL_FONT_WEIGHT
    sprite.fontSize = LABEL_FONT_SIZE
    if (label_outline) { sprite.strokeColor = "#000000"; sprite.strokeWidth = LABEL_STROKE_WIDTH }
    sprite.material.depthTest = false
    sprite.renderOrder = 999
    sprite.position.y = radius + sprite.textHeight + LABEL_GAP
    group.add(sprite)
    return group
  }, [node_color, node_size, node_label, effectiveLabelsOn, hqMode, label_outline, perf.allowHq, map_mode])

  // Camera controls — RAF loop for smooth continuous movement on hold
  const stopHold = useCallback(() => {
    if (holdRafRef.current !== null) { cancelAnimationFrame(holdRafRef.current); holdRafRef.current = null }
  }, [])

  const startHold = useCallback((e: React.MouseEvent, action: () => void) => {
    e.stopPropagation(); stopHold()
    const loop = () => { action(); holdRafRef.current = requestAnimationFrame(loop) }
    holdRafRef.current = requestAnimationFrame(loop)
  }, [stopHold])

  // Instant moves (no easing duration) so RAF loop stays smooth
  const doZoomIn = useCallback(() => {
    const g = getGraph(); if (!g) return
    if (!map_mode && viewMode === "3d") {
      const { x, y, z } = g.cameraPosition()
      g.cameraPosition({ x: x * 0.982, y: y * 0.982, z: z * 0.982 })
    } else {
      g.zoom(g.zoom() * 1.12, 0)
    }
  }, [viewMode, map_mode, getGraph])
  const doZoomOut = useCallback(() => {
    const g = getGraph(); if (!g) return
    if (!map_mode && viewMode === "3d") {
      const { x, y, z } = g.cameraPosition()
      g.cameraPosition({ x: x * 1.018, y: y * 1.018, z: z * 1.018 })
    } else {
      g.zoom(g.zoom() / 1.12, 0)
    }
  }, [viewMode, map_mode, getGraph])
  const fitMapCanvas3d = useCallback(() => {
    const cam = defaultMapCamera()
    setMapCamera(cam)
    requestAnimationFrame(() => {
      const g2 = graph2dRef.current
      if (!g2?.centerAt || !g2?.zoom) return
      const projected = projectMapNodes(
        graph2dData.nodes as NodeData[],
        cam,
        getMapSourceCoord,
      )
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const node of projected) {
        const x = node.x ?? 0
        const y = node.y ?? 0
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      if (!Number.isFinite(minX)) return
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const span = Math.max(maxX - minX, maxY - minY, 1e-6)
      const pad = 80
      const zoom = Math.min(
        (containerWidth - pad * 2) / span,
        (height - pad * 2) / span,
      )
      g2.centerAt(cx, cy, 0)
      g2.zoom(Math.max(zoom, 0.01), 0)
    })
  }, [graph2dData.nodes, getMapSourceCoord, containerWidth, height])

  fitMapCanvas3dRef.current = fitMapCanvas3d

  const fitMapView = useCallback((mode: ViewMode) => {
    if (mode === "3d") {
      fitMapCanvas3d()
      return
    }
    restoreMapPinnedCoordinates(graph2dData.nodes as NodeData[])
    const g2 = graph2dRef.current
    g2?.graphData?.(graph2dData)
    requestAnimationFrame(() => {
      g2?.zoomToFit?.(400, 80)
      g2?.d3ReheatSimulation?.()
    })
  }, [graph2dData, fitMapCanvas3d])

  const fit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (map_mode && viewMode === "3d") {
      fitMapCanvas3d()
      return
    }
    if (map_mode && viewMode === "2d") {
      fitMapView("2d")
      return
    }
    getGraph()?.zoomToFit(400, 40)
  }, [getGraph, map_mode, viewMode, fitMapView, fitMapCanvas3d])
  const toggleLabels   = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setLabelsOn(v => !v) }, [])
  const toggleHQ = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!perf.allowHq) return
    setHqMode(v => !v)
  }, [perf.allowHq])
  const toggleSandyBg  = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setSandyBg(v => !v) }, [])

  const toggleViewMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const nextMode: ViewMode = viewMode === "3d" ? "2d" : "3d"

    if (map_mode && use_coordinates) {
      mapOrbitRef.current = null
      setViewMode(nextMode)
      setHighlightedNodes(new Set())
      if (nextMode === "3d") {
        setMapCamera(defaultMapCamera())
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fitMapView("3d")
            setGraphPlaybackForView("3d", graph2dRef.current, graph3dRef.current, true, true)
            clearForceGraph2dCanvas(graph2dRef.current, resolvedBgColor)
          })
        })
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fitMapView("2d")
            setGraphPlaybackForView("2d", graph2dRef.current, graph3dRef.current, true, true)
            graph2dRef.current?.refresh?.()
          })
        })
      }
      return
    }

    const active = getGraph(viewMode)

    if (viewMode === "3d" && graph3dRef.current?.cameraPosition) {
      viewTransform3dRef.current = { kind: "3d", camera: graph3dRef.current.cameraPosition() }
      viewTransform2dRef.current = null
    } else if (viewMode === "2d" && graph2dRef.current?.zoom && graph2dRef.current?.centerAt) {
      viewTransform2dRef.current = {
        kind: "2d",
        zoom: graph2dRef.current.zoom(),
        center: graph2dRef.current.centerAt(),
      }
    }

    toggleFromModeRef.current = viewMode
    pendingLayoutSyncRef.current = true
    needs2dZoomFitRef.current = nextMode === "2d" && viewMode === "3d"
    layoutCaptureSizeRef.current = { width: containerWidth, height }
    captureLayoutSnapshot(
      active as GraphCoordApi,
      viewMode,
      layoutXYZRef.current,
      layoutScreenRef.current,
    )
    setLayoutLocked(true)

    setViewMode(nextMode)
    setHighlightedNodes(new Set())

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        finalizeLayoutAfterToggle(
          graph2dData,
          graph3dData,
          nextMode,
          viewMode,
          graph2dRef.current,
          graph3dRef.current,
          layoutScreenRef.current,
          layoutXYZRef.current,
          viewTransform2dRef.current,
          viewTransform3dRef.current,
          { width: containerWidth, height },
          layoutCaptureSizeRef.current,
          v => { viewTransform2dRef.current = v },
        )
        pendingLayoutSyncRef.current = false
        if (nextMode === "2d" && viewMode === "3d") {
          needs2dZoomFitRef.current = true
        }
        if (nextMode === "3d") {
          stabilize3dSimulation(graph3dRef.current)
          syncOrbitControlsFromCamera(graph3dRef.current)
        }
      })
    })
  }, [viewMode, graph2dData, graph3dData, getGraph, containerWidth, height, map_mode, use_coordinates, fitMapView, resolvedBgColor])

  const exportPNG = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const downloadDataUrl = (url: string) => {
      const a = document.createElement("a")
      a.href = url
      a.download = "kgviz_export.png"
      a.click()
    }
    try {
      if (!map_mode && (showInstancedLayer || viewMode === "3d")) {
        const g = graph3dRef.current
        if (!g?.renderer || !g?.scene || !g?.camera) return
        const renderer = g.renderer() as THREE.WebGLRenderer
        renderer.render(g.scene(), g.camera())
        downloadDataUrl(renderer.domElement.toDataURL("image/png"))
        return
      }
      const canvas = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null
      if (!canvas) return
      const exportCanvas = document.createElement("canvas")
      exportCanvas.width = canvas.width
      exportCanvas.height = canvas.height
      const ctx = exportCanvas.getContext("2d")
      if (!ctx) return
      ctx.fillStyle = resolvedBgColor
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
      ctx.drawImage(canvas, 0, 0)
      downloadDataUrl(exportCanvas.toDataURL("image/png"))
    } catch (err) {
      console.warn("kgviz: PNG export failed", err)
    }
  }, [viewMode, showInstancedLayer, resolvedBgColor])

  const toggleSearch = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setSearchOpen(v => {
      if (v) setSearchQuery("")
      return !v
    })
  }, [])

  const focusSelection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const target = highlightedNodes.size > 0
      ? [...highlightedNodes][0]
      : focusRootId ?? hoveredNode?.id ?? null
    if (target != null) setFocusRootId(target)
  }, [highlightedNodes, focusRootId, hoveredNode])

  const clearFocus = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setFocusRootId(null)
  }, [])

  const clearSelection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHighlightedNodes(new Set())
  }, [])

  const toggleLegendNodeType = useCallback((label: string) => {
    setHiddenNodeTypes(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const toggleLegendEdgeType = useCallback((label: string) => {
    setHiddenEdgeTypes(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])
  const particleCount = perf.allowParticles && particle_flow && !showInstancedLayer ? 3 : 0
  const graph3dProps = showInstancedLayer
    ? {
        nodeLabel: "" as const,
      }
      : perf.useCustom3dNodes
        ? {
            nodeThreeObject: nodeThreeObject as never,
            nodeThreeObjectExtend: false as const,
            nodeLabel: "" as const,
          }
        : {
            nodeColor: nodeColor3d as never,
            nodeVal: nodeVal3d as never,
            nodeLabel: nodeLabel3d as never,
            nodeResolution: perf.nodeResolution3d,
            nodeRelSize: 4,
            nodeOpacity: NODE_OPACITY,
          }
  const graph2dProps = mapCanvas3d
    ? {
        nodeLabel: "" as const,
        nodeVal: () => 0,
        nodeRelSize: 0.001,
      }
    : (perf.useCustom2dCanvas || map_mode)
      ? {
          nodeCanvasObject: nodeCanvasObject2d as never,
          nodeCanvasObjectMode: () => "replace" as const,
          nodeLabel: "" as const,
          nodeVal: nodeVal2d as never,
          nodeRelSize: 4,
        }
      : {
          nodeColor: nodeColor3d as never,
          nodeVal: nodeVal3d as never,
          nodeLabel: nodeLabel2d as never,
          nodeOpacity: NODE_OPACITY as never,
        }


  // Build tooltip content
  const tooltipContent = useMemo(() => {
    if (!hoveredNode) return null
    const nodeLabel = (hoveredNode[node_label] as string) ?? String(hoveredNode.id)
    const rows: Array<{ key: string; value: string }> = []
    // Show id first if different from label
    if (String(hoveredNode.id) !== nodeLabel) {
      rows.push({ key: "id", value: String(hoveredNode.id) })
    }
    for (const [k, v] of Object.entries(hoveredNode)) {
      if (TOOLTIP_EXCLUDE.has(k) || k.startsWith("__")) continue
      if (k === "id") continue // already handled
      if (k === node_label) continue // already shown as title
      if (typeof v === "string" || typeof v === "number") {
        rows.push({ key: k, value: String(v) })
      }
    }
    return { nodeLabel, rows }
  }, [hoveredNode, node_label])

  // Compute search match count
  const searchMatchCount = searchMatchIds.size
  const warmup3d = layoutLocked || showInstancedLayer ? 0 : (baseInitialView === "3d" ? warmup_ticks : 0)
  const warmup2d = layoutLocked ? 0 : (baseInitialView === "2d" ? warmup_ticks : 0)
  const cooldownLocked = layoutLocked ? 0 : (warmup_ticks > 0 ? 0 : undefined)

  const mapOverlayStyle = useMemo((): React.CSSProperties => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 10,
    pointerEvents: mapCanvas3d ? "auto" : "none",
    cursor: mapCanvas3d ? "grab" : undefined,
  }), [mapCanvas3d])

  const grain2dOverlay = useMemo(() => {
    if (viewMode !== "2d" || !sandyBg) return null
    const strength = grain_density === "light" ? 0.06 : grain_density === "dense" ? 0.22 : 0.13
    const [rx, ry] = grainRepeat(grain_density)
    return {
      position: "absolute" as const,
      inset: 0,
      pointerEvents: "none" as const,
      zIndex: 2,
      backgroundImage: `url(${createGrainDataUrl(strength)})`,
      backgroundRepeat: "repeat" as const,
      backgroundSize: `${Math.round(2560 / rx)}px ${Math.round(2560 / ry)}px`,
    }
  }, [viewMode, sandyBg, grain_density])

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        position: "relative",
        cursor: mapCanvas3d ? "grab" : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); mapOrbitRef.current = null }}
      onMouseMove={onMouseMove}
      onClick={onContainerClick}
    >
      {mounted3d && (
        <div style={graphLayerStyle(effectiveViewMode === "3d")}>
          <ForceGraph3D
            ref={graph3dRef}
            graphData={graph3dData}
            numDimensions={3}
            controlType="orbit"
            width={containerWidth}
            height={height}
            {...graph3dProps}
            onNodeClick={showInstancedLayer ? () => {} : onNodeClick}
            onLinkClick={onLinkClick}
            onEngineStop={onEngineStop3d}
            onEngineTick={onEngineTick3d}
            onNodeHover={showInstancedLayer ? () => {} : (onNodeHover as never)}
            backgroundColor={resolvedBgColor}
            showNavInfo={false}
            linkDirectionalArrowLength={arrowLength}
            linkDirectionalArrowRelPos={1}
            dagMode={dag_mode as never}
            warmupTicks={warmup3d}
            cooldownTicks={cooldownLocked}
            d3VelocityDecay={perf.d3VelocityDecay}
            d3AlphaDecay={perf.d3AlphaDecay}
            linkColor={linkColorFn as never}
            linkWidth={linkWidthFn as never}
            linkLabel={linkLabelFn as never}
            linkVisibility={linkVisibilityFn as never}
            nodeVisibility={(showInstancedLayer ? () => false : nodeVisibilityFn) as never}
            linkDirectionalArrowColor={linkColorFn as never}
            linkDirectionalParticles={particleCount}
            linkDirectionalParticleSpeed={particle_speed}
            linkDirectionalParticleWidth={particleCount > 0 ? 2 : 0}
            linkDirectionalParticleColor={linkColorFn as never}
            nodeOpacity={NODE_OPACITY}
          />
        </div>
      )}
      {mounted2d && (
        <div
          data-kgviz-map-graph={map_mode ? "2d" : undefined}
          style={{
            ...graphLayerStyle(
              map_mode ? viewMode === "2d" : effectiveViewMode === "2d",
              mapCanvas3d,
            ),
            ...(mapCanvas3d ? { backgroundColor: resolvedBgColor, opacity: 0 } : {}),
          }}
        >
          <ForceGraph2D
            key={map_mode ? "map-graph2d" : "graph2d"}
            ref={graph2dRef}
            graphData={graph2dData}
            width={containerWidth}
            height={height}
            enablePanInteraction={!mapCanvas3d}
            enableZoomInteraction={!mapCanvas3d}
            onRenderFramePost={map_mode ? paintMapGraph2dFramePost : undefined}
            {...graph2dProps}
            onNodeClick={onNodeClick}
            onLinkClick={onLinkClick}
            onEngineStop={onEngineStop2d as never}
            onNodeHover={onNodeHover as never}
            backgroundColor={resolvedBgColor}
            linkDirectionalArrowLength={arrowLength}
            linkDirectionalArrowRelPos={1}
            dagMode={dag_mode as never}
            warmupTicks={warmup2d}
            cooldownTicks={cooldownLocked}
            d3VelocityDecay={perf.d3VelocityDecay}
            d3AlphaDecay={perf.d3AlphaDecay}
            linkColor={linkColorFn as never}
            linkWidth={linkWidthFn as never}
            linkLabel={linkLabelFn as never}
            linkVisibility={linkVisibilityFn as never}
            nodeVisibility={nodeVisibilityFor2d as never}
            linkDirectionalParticles={particleCount}
            linkDirectionalParticleSpeed={particle_speed}
            linkDirectionalParticleWidth={particleCount > 0 ? 2 : 0}
            linkDirectionalParticleColor={linkColorFn as never}
          />
        </div>
      )}

      {map_mode && mapCanvas3d && (
        <canvas ref={mapOverlayRef} aria-hidden style={mapOverlayStyle} />
      )}

      {grain2dOverlay && <div aria-hidden style={grain2dOverlay} />}

      {/* Hover tooltip */}
      {hoveredNode !== null && tooltipContent && (
        <div
          style={{
            position: "absolute",
            left: Math.min(mousePos.x + 15, containerWidth - 280),
            top: Math.max(mousePos.y - 10, 0),
            pointerEvents: "none",
            background: "rgba(10,10,18,0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "8px 10px",
            color: "#fff",
            fontSize: 12,
            minWidth: 140,
            maxWidth: 260,
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
            {tooltipContent.nodeLabel}
          </div>
          {tooltipContent.rows.length > 0 && (
            <>
              <div style={{ height: 1, background: "rgba(255,255,255,0.15)", marginBottom: 5 }} />
              {tooltipContent.rows.map(({ key, value }) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                  <span style={{ color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>{key}</span>
                  <span style={{ color: "#fff", wordBreak: "break-word", textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Search overlay */}
      {layout_method && map_mode && (
        <div
          data-kgviz-ui
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 25,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(10,10,18,0.82)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span style={{ pointerEvents: "none" }}>
            {layout_method} map · {graph_data.nodes.length.toLocaleString()} points
            {mapCanvas3d ? " · drag orbit · shift+drag pan" : ""}
          </span>
        </div>
      )}

      {searchOpen && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(10,10,18,0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 20,
            padding: "6px 14px",
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            placeholder="Search nodes (label, id, properties)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") {
                setSearchQuery("")
                setSearchOpen(false)
              }
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: 13,
              width: 240,
              outline: "none",
            }}
          />
          {searchQuery && (
            <span style={{
              fontSize: 11,
              color: searchMatchCount === 0 ? "#ff6b6b" : "rgba(255,255,255,0.6)",
              whiteSpace: "nowrap",
            }}>
              {searchMatchCount === 0 ? "no match" : `${searchMatchCount} found`}
            </span>
          )}
        </div>
      )}

      {/* Plotly-style control toolbar — fades in on hover */}
      <div
        data-kgviz-ui
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
          right: 10,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          padding: "5px 4px",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(10,10,18,0.55)",
          backdropFilter: "blur(8px)",
          zIndex: 10,
          opacity: map_mode ? 1 : (hovered ? 1 : 0.45),
          pointerEvents: "auto",
          transition: "opacity 0.2s ease",
        }}
      >
        <ToolBtn icon="zoomIn"     title="Zoom in"      onMouseDown={e => startHold(e, doZoomIn)}  onMouseUp={stopHold} />
        <ToolBtn icon="zoomOut"    title="Zoom out"     onMouseDown={e => startHold(e, doZoomOut)} onMouseUp={stopHold} />
        <ToolBtn icon="fit"        title="Reset view"   onClick={fit} />
        <Divider />
        <ToolBtn
          icon={viewMode === "3d" ? "view2d" : "view3d"}
          title={
            map_mode
              ? (viewMode === "3d"
                ? "Switch to 2D map view"
                : "Switch to 3D orbit view (drag to rotate)")
              : (viewMode === "3d" ? "Switch to 2D view" : "Switch to 3D view")
          }
          active={viewMode === "3d"}
          onClick={toggleViewMode}
        />
        <Divider />
        <ToolBtn icon="label"     title={labelsOn    ? "Hide labels"          : "Show labels"}          active={labelsOn}    onClick={toggleLabels} />
        <ToolBtn icon="grain"     title={sandyBg     ? "Smooth background"    : "Sandy background"}     active={sandyBg}     onClick={toggleSandyBg} />
        {enable_multi_select && (
          <ToolBtn icon="clearSel" title="Clear selection" onClick={clearSelection} />
        )}
        <Divider />
        <ToolBtn icon="camera"    title="Export PNG"   onClick={exportPNG} />
        <ToolBtn icon="search"    title={searchOpen   ? "Close search"        : "Search nodes"}         active={searchOpen}  onClick={toggleSearch} />
      </div>

      {show_legend && (legendNodeEntries.length > 0 || legendEdgeEntries.length > 0) && (
        <GraphLegend
          nodeEntries={legendNodeEntries}
          edgeEntries={legendEdgeEntries}
          hiddenNodeTypes={hiddenNodeTypes}
          hiddenEdgeTypes={hiddenEdgeTypes}
          onToggleNodeType={toggleLegendNodeType}
          onToggleEdgeType={toggleLegendEdgeType}
        />
      )}
    </div>
  )
}

function KGVizStreamlit(props: ComponentProps) {
  return <KGVizView {...props} streamlitMode />
}

export default withStreamlitConnection(KGVizStreamlit)
