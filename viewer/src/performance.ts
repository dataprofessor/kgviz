export type PerfTier = "quality" | "balanced" | "performance"
export type PerformanceMode = "auto" | PerfTier

export const PERF_THRESHOLDS = {
  rich3dNodes: 400,
  rich2dCanvas: 1200,
  labelsAlways: 350,
  labelsHoverOnly: 2000,
  freezeSimulation: 60,
  particlesMax: 500,
  /** Reserved threshold for disabled instanced WebGL path */
  instancedMap: 1500,
} as const

export type PerfProfile = {
  tier: PerfTier
  nodeCount: number
  edgeCount: number
  useCustom3dNodes: boolean
  useCustom2dCanvas: boolean
  show3dLabelsAlways: boolean
  show3dLabelsOnHover: boolean
  show2dLabels: boolean
  nodeResolution3d: number
  freezeSimulation: boolean
  allowParticles: boolean
  allowHq: boolean
  light2dEffects: boolean
  d3VelocityDecay: number
  d3AlphaDecay: number
  useInstancedMap: boolean
}

export function shouldUseInstancedMap(
  mapMode: boolean,
  nodeCount: number,
  threshold?: number,
): boolean {
  const minNodes = threshold ?? PERF_THRESHOLDS.instancedMap
  return mapMode && nodeCount >= minNodes
}

export function resolvePerfTier(
  mode: PerformanceMode,
  nodeCount: number,
  edgeCount: number,
): PerfTier {
  if (mode !== "auto") return mode
  const density = edgeCount / Math.max(nodeCount, 1)
  if (nodeCount <= PERF_THRESHOLDS.rich3dNodes && edgeCount <= 2500) return "quality"
  if (nodeCount <= 2500 && density < 25) return "balanced"
  return "performance"
}

export function buildPerfProfile(
  mode: PerformanceMode,
  nodeCount: number,
  edgeCount: number,
  labelsRequested: boolean,
  particlesRequested: boolean,
  mapMode = false,
  instancedThreshold: number = PERF_THRESHOLDS.instancedMap,
): PerfProfile {
  const tier = resolvePerfTier(mode, nodeCount, edgeCount)
  const useInstancedMap = shouldUseInstancedMap(mapMode, nodeCount, instancedThreshold)
  const useCustom3dNodes = !useInstancedMap
    && tier === "quality"
    && nodeCount <= PERF_THRESHOLDS.rich3dNodes
  const useCustom2dCanvas = tier === "quality"
    || (tier === "balanced" && nodeCount <= PERF_THRESHOLDS.rich2dCanvas)
  const show3dLabelsAlways = labelsRequested
    && useCustom3dNodes
    && nodeCount <= PERF_THRESHOLDS.labelsAlways
  const show3dLabelsOnHover = labelsRequested
    && !show3dLabelsAlways
    && nodeCount <= PERF_THRESHOLDS.labelsHoverOnly
  const show2dLabels = labelsRequested
    && (tier === "quality" || (tier === "balanced" && nodeCount <= PERF_THRESHOLDS.labelsAlways))

  return {
    tier,
    nodeCount,
    edgeCount,
    useCustom3dNodes,
    useCustom2dCanvas,
    show3dLabelsAlways,
    show3dLabelsOnHover,
    show2dLabels,
    nodeResolution3d: tier === "performance" ? 6 : tier === "balanced" ? 10 : 16,
    freezeSimulation: nodeCount >= PERF_THRESHOLDS.freezeSimulation || tier !== "quality",
    allowParticles: particlesRequested && nodeCount <= PERF_THRESHOLDS.particlesMax,
    allowHq: useCustom3dNodes,
    light2dEffects: tier === "quality" || (tier === "balanced" && nodeCount <= 800),
    d3VelocityDecay: tier === "performance" ? 0.55 : tier === "balanced" ? 0.4 : 0.3,
    d3AlphaDecay: tier === "performance" ? 0.05 : tier === "balanced" ? 0.022 : 0.01,
    useInstancedMap,
  }
}
