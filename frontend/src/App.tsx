import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { Landing } from "./pages/Landing";
import { normalizePath } from "./lib/routes";

function currentPath(): string {
  return normalizePath(window.location.pathname);
}

export function App() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const isHistory = path === "/history" || path === "/history.html";
  const isLanding = !isHistory && path !== "/app";

  // The landing page owns its own header, footer and full-bleed sections.
  if (isLanding) return <Landing />;

  return (
    <AppShell path={path}>{isHistory ? <History /> : <Home />}</AppShell>
  );
}
