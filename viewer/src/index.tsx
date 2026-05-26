import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { KGVizView } from "./KGVizView"
import KGVizStreamlit from "./KGVizView"
import { ComponentArgs } from "./types"

declare global {
  interface Window {
    __KGVIZ_CONFIG__?: ComponentArgs & {
      theme?: { backgroundColor?: string }
    }
  }
}

const root = createRoot(document.getElementById("root")!)
const embedConfig = window.__KGVIZ_CONFIG__

if (embedConfig) {
  const { theme, ...args } = embedConfig
  root.render(
    <StrictMode>
      <KGVizView args={args as ComponentArgs} theme={theme ?? { backgroundColor: "#0e1117" }} />
    </StrictMode>
  )
} else {
  root.render(
    <StrictMode>
      <KGVizStreamlit />
    </StrictMode>
  )
}
