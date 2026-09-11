import { useEffect, useState } from "react";

import { History } from "./pages/History";
import { Home } from "./pages/Home";

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function App() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const isHistory = path === "/history" || path === "/history.html";

  return (
    <div className="mx-auto max-w-4xl px-6 pb-16 pt-11">
      {isHistory ? <History /> : <Home />}

      <footer className="mt-10 text-[0.8rem] text-muted">
        Deterministic evidence-backed decisions.
        {isHistory ? null : (
          <>
            {" "}
            <a href="/history" className="underline underline-offset-2">
              Verification history
            </a>{" "}
            ·{" "}
            <a href="/docs" className="underline underline-offset-2">
              API documentation
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
