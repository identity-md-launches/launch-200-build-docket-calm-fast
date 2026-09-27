import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadConfig } from "./config";
import "./style.css";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="startup">
        <h1>The docket could not open.</h1>
        <p>Reload to retry. Your wallet has not been asked to send anything.</p>
        <button onClick={() => location.reload()}>reload the docket</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = createRoot(document.getElementById("root")!);
async function start() {
  try {
    const config = await loadConfig();
    root.render(
      <Boundary>
        <App config={config} />
      </Boundary>,
    );
  } catch (e) {
    root.render(
      <div className="startup">
        <h1>THE DOCKET</h1>
        <h2>Check the site configuration.</h2>
        <p role="alert">
          {e instanceof Error ? e.message : "config.json is invalid."}
        </p>
        <button onClick={() => void start()}>retry configuration</button>
      </div>,
    );
  }
}
void start();
