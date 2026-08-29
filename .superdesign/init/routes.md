# Routes And View Map

Stackfolio is a single-route React/Vite SPA. There is no URL router; `src/client/App.tsx` switches views with local state.

| URL | View state | Component | Shared layout |
| --- | --- | --- | --- |
| `/` | `overview` | `src/client/components/Dashboard.tsx` | `src/client/App.tsx` |
| `/` | `costs` | `src/client/components/CostsPage.tsx` | `src/client/App.tsx` |
| `/` | `table` | `src/client/components/TableViewPage.tsx` | `src/client/App.tsx` |

The global `Add cost` action opens `src/client/components/AddCostModal.tsx`. Selecting a cost opens `src/client/components/ItemDrawer.tsx` over the current view.

The application entry is `src/client/main.tsx`, which mounts `<App />` and imports `src/client/styles.css`.
