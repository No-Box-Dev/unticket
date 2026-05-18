import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface PageShellProps {
  // Fallback destination used only when this page was loaded directly
  // (deep link, new tab, refresh) and there is no in-app history to
  // step back through. Normal back-clicks use the browser history so
  // users return to the exact list/filter view they came from.
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export function PageShell({ backTo, backLabel = "Back", children }: PageShellProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // react-router stamps location.key === "default" only on the first
  // entry of a session — that's our signal that there's nothing useful
  // in history (deep link, refresh, new tab). Anything else means the
  // user navigated here from another in-app page, so go back to it.
  const onBack = (e: React.MouseEvent) => {
    e.preventDefault();
    if (location.key !== "default") {
      navigate(-1);
    } else if (backTo) {
      navigate(backTo);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 sm:px-8 py-3 sticky top-0 z-10">
        <a
          href={backTo ?? "#"}
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {backLabel}
        </a>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-6">{children}</main>
    </div>
  );
}
