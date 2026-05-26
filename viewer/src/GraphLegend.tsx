import type { LegendEntry } from "./graphUtils"

type GraphLegendProps = {
  nodeEntries: LegendEntry[]
  edgeEntries: LegendEntry[]
  hiddenNodeTypes: Set<string>
  hiddenEdgeTypes: Set<string>
  onToggleNodeType: (label: string) => void
  onToggleEdgeType: (label: string) => void
}

function LegendSection({
  title,
  entries,
  hidden,
  onToggle,
}: {
  title: string
  entries: LegendEntry[]
  hidden: Set<string>
  onToggle: (label: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {title}
      </div>
      {entries.map(({ label, color }) => {
        const off = hidden.has(label)
        return (
          <button
            key={label}
            type="button"
            onClick={() => onToggle(label)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              marginBottom: 3,
              padding: "3px 4px",
              border: "none",
              borderRadius: 4,
              background: off ? "transparent" : "rgba(255,255,255,0.06)",
              color: off ? "rgba(255,255,255,0.35)" : "#eee",
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{
              width: 10,
              height: 10,
              borderRadius: title.startsWith("Node") ? "50%" : 2,
              background: off ? "rgba(255,255,255,0.2)" : color,
              flexShrink: 0,
            }} />
            <span style={{ textDecoration: off ? "line-through" : "none" }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function GraphLegend({
  nodeEntries,
  edgeEntries,
  hiddenNodeTypes,
  hiddenEdgeTypes,
  onToggleNodeType,
  onToggleEdgeType,
}: GraphLegendProps) {
  if (nodeEntries.length === 0 && edgeEntries.length === 0) return null
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        zIndex: 25,
        maxWidth: 200,
        maxHeight: "40%",
        overflowY: "auto",
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(10,10,18,0.82)",
        backdropFilter: "blur(8px)",
        pointerEvents: "auto",
      }}
    >
      <LegendSection title="Nodes" entries={nodeEntries} hidden={hiddenNodeTypes} onToggle={onToggleNodeType} />
      <LegendSection title="Edges" entries={edgeEntries} hidden={hiddenEdgeTypes} onToggle={onToggleEdgeType} />
    </div>
  )
}
