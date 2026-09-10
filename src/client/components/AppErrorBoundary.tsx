import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="page-state error" role="alert">
          <h1>Stackfolio could not display this page.</h1>
          <p>Reload to try again. Unsaved form changes will be lost.</p>
          <button className="button secondary" onClick={() => window.location.reload()}>Reload Stackfolio</button>
        </div>
      );
    }
    return this.props.children;
  }
}
