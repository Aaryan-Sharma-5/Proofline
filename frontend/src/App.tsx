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
    <div className="mx-auto max-w-[1200px] px-6 pb-16 pt-14 sm:px-8">
      {isHistory ? <History /> : <Home />}

      <footer className="mt-10 text-[0.8rem] text-faint">
        Deterministic evidence-backed decisions.
        {isHistory ? null : (
          <>
            {" "}
            <a href="/history" className="text-muted underline underline-offset-2 hover:text-ink">
              Verification history
            </a>{" "}
            ·{" "}
            <a href="/docs" className="text-muted underline underline-offset-2 hover:text-ink">
              API documentation
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
