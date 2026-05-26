import type { NodeData } from "./types"

export const NODE_OPACITY = 0.35

export type GraphLink = Record<string, unknown> & {
  source: string | number | NodeData
  target: string | number | NodeData
}

export function nodeIdOf(ref: string | number | NodeData): string | number {
  return typeof ref === "object" && ref !== null ? ref.id : ref
}

export function linkEndpoints(link: GraphLink): { source: string | number; target: string | number } {
  return { source: nodeIdOf(link.source), target: nodeIdOf(link.target) }
}

export function linkKey(link: GraphLink): string {
  const { source, target } = linkEndpoints(link)
  const a = String(source)
  const b = String(target)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function computeNeighborhood(
  rootId: string | number,
  hops: number,
  links: GraphLink[],
): { nodeIds: Set<string | number>; linkKeys: Set<string> } {
  const adj = new Map<string | number, Set<string | number>>()
  for (const link of links) {
    if (link.__synthetic) continue
    const { source, target } = linkEndpoints(link)
    if (!adj.has(source)) adj.set(source, new Set())
    if (!adj.has(target)) adj.set(target, new Set())
    adj.get(source)!.add(target)
    adj.get(target)!.add(source)
  }

  const nodeIds = new Set<string | number>([rootId])
  let frontier = [rootId]
  for (let h = 0; h < hops; h++) {
    const next: (string | number)[] = []
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!nodeIds.has(nb)) {
          nodeIds.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
  }

  const linkKeys = new Set<string>()
  for (const link of links) {
    if (link.__synthetic) continue
    const { source, target } = linkEndpoints(link)
    if (nodeIds.has(source) && nodeIds.has(target)) linkKeys.add(linkKey(link))
  }

  return { nodeIds, linkKeys }
}

export type LegendEntry = { label: string; color: string }

export type ClusterCentroid = {
  label: string
  color: string
  x: number
  y: number
  z: number
}

export function computeClusterCentroids(
  nodes: NodeData[],
  groupField: string,
  getCoord: (node: NodeData) => { x: number; y: number; z: number },
  colorField = "color",
  isVisible?: (node: NodeData) => boolean,
): ClusterCentroid[] {
  const groups = new Map<string, { sx: number; sy: number; sz: number; n: number; color: string }>()
  for (const node of nodes) {
    if (isVisible && !isVisible(node)) continue
    const label = String(node[groupField] ?? "")
    if (!label) continue
    const { x, y, z } = getCoord(node)
    const color = typeof node[colorField] === "string" ? (node[colorField] as string) : "#cccccc"
    const group = groups.get(label)
    if (group) {
      group.sx += x
      group.sy += y
      group.sz += z
      group.n += 1
    } else {
      groups.set(label, { sx: x, sy: y, sz: z, n: 1, color })
    }
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    color: group.color,
    x: group.sx / group.n,
    y: group.sy / group.n,
    z: group.sz / group.n,
  }))
}

export function buildLegendFromField(
  items: Array<Record<string, unknown>>,
  field: string | undefined,
  colorField = "color",
): LegendEntry[] {
  if (!field) return []
  const seen = new Map<string, string>()
  for (const item of items) {
    const raw = item[field]
    if (raw == null) continue
    const label = String(raw)
    if (seen.has(label)) continue
    const color = item[colorField]
    seen.set(label, typeof color === "string" ? color : "#cccccc")
  }
  return [...seen.entries()].map(([label, color]) => ({ label, color }))
}

export function nodeMatchesSearch(
  node: NodeData,
  query: string,
  keys: string[],
  labelKey: string,
): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return false
  const fields = new Set([...keys, labelKey, "id"])
  for (const key of fields) {
    const v = node[key]
    if (v == null) continue
    if (String(v).toLowerCase().includes(q)) return true
  }
  return false
}

export function getEdgeLabel(
  link: Record<string, unknown>,
  edgeLabelKey: string,
): string {
  const v = link[edgeLabelKey]
  if (v == null || v === "") return ""
  return String(v)
}
