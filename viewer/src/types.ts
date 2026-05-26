export interface NodeData {
  id: string | number
  label?: string
  color?: string
  size?: number
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
  [key: string]: unknown
}

export interface EdgeData {
  source: string | number
  target: string | number
  color?: string
  width?: number
  label?: string
  [key: string]: unknown
}

export interface GraphData {
  nodes: NodeData[]
  edges: EdgeData[]
}

export interface ComponentArgs {
  graph_data: GraphData
  node_color: string
  node_size: string | number
  node_label: string
  edge_color: string
  edge_width: string | number
  edge_label?: string
  show_edge_labels?: boolean
  legend_node_by?: string | null
  legend_edge_by?: string | null
  show_legend?: boolean
  focus_hops?: number
  enable_focus?: boolean
  search_keys?: string[]
  enable_multi_select?: boolean
  /** Cosmograph-style scatter map: 2D coords, minimal edges, auto fit */
  map_mode?: boolean
  layout_method?: string | null
  /** Reserved; instanced WebGL path is disabled — large maps use the canvas overlay */
  instanced_map_threshold?: number
  use_coordinates: boolean
  height: number | null
  width: number | null
  dag_mode: string | null
  bg_color: string
  show_nav_info: boolean
  link_directional_arrow: boolean
  arrow_size: "small" | "medium" | "large"
  warmup_ticks: number
  show_labels: boolean
  bidirectional: boolean
  label_outline: boolean
  grain_density: "light" | "medium" | "dense"
  particle_flow: boolean
  particle_speed: number
  default_view?: "2d" | "3d"
  performance_mode?: "auto" | "quality" | "balanced" | "performance"
}
