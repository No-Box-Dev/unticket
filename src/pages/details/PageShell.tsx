import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface PageShellProps {
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export function PageShell({ backTo, backLabel = "Back", children }: PageShellProps) {
  const navigate = useNavigate();

  const onBack = (e: React.MouseEvent) => {
    if (backTo) return; // Link handles it
    e.preventDefault();
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 sm:px-8 py-3 sticky top-0 z-10">
        {backTo ? (
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLabel}
          </Link>
        ) : (
          <a
            href="#"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLabel}
          </a>
        )}
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-6">{children}</main>
    </div>
  );
}
