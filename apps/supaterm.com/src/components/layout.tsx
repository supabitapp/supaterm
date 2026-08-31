import { Link, Outlet } from "@tanstack/react-router";

const githubHref = "https://github.com/supabitapp/supaterm";
const docsHref = "https://docs.supaterm.com";

function Layout() {
  return (
    <main className="flex min-h-svh flex-col overflow-x-hidden">
      <header className="relative z-50 border-b border-white/7">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6 md:px-10">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-mono text-sm font-bold tracking-[0.2em] text-white uppercase"
          >
            <img src="/logo-mark.svg" alt="" className="h-5 w-auto" />
            <span>Supaterm</span>
          </Link>
          <span className="hidden text-[0.62rem] tracking-[0.14em] text-white/28 uppercase sm:block">
            The terminal with skills
          </span>
        </div>
      </header>

      <div className="flex-1">
        <Outlet />
      </div>

      <footer className="relative z-10 border-t border-white/7 px-6 md:px-10">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-col justify-center gap-3 py-4 text-xs text-white/32 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <span>© {new Date().getFullYear()} Supaterm Limited</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/terms" className="transition-colors hover:text-white/68">
              Terms
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-white/68">
              Privacy
            </Link>
            <Link to="/refunds" className="transition-colors hover:text-white/68">
              Refunds
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

export { Layout, docsHref, githubHref };
