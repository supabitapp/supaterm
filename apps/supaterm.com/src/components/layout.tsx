import { AppleIcon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, Outlet } from "@tanstack/react-router";
import { posthog } from "posthog-js";
import { type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { downloadHref } from "@/lib/downloads";
import { cn } from "@/lib/utils";

const githubHref = "https://github.com/supabitapp/supaterm";
const releasesHref = "https://github.com/supabitapp/supaterm/releases";

const ctaIcons = {
  download: AppleIcon,
  github: GithubIcon,
} as const;

type CtaLinkProps = {
  href: string;
  icon: keyof typeof ctaIcons;
  children: ReactNode;
  className?: string;
  variant?: "default" | "outline";
  size?: "lg";
  showIcon?: boolean;
  onClick?: () => void;
  download?: boolean;
};

function CtaLink({
  href,
  icon,
  children,
  className,
  variant = "default",
  size = "lg",
  showIcon = true,
  onClick,
  download,
}: CtaLinkProps) {
  return (
    <a
      href={href}
      download={download}
      onClick={onClick}
      className={cn(buttonVariants({ variant, size }), showIcon ? "gap-3" : "gap-0", className)}
    >
      {showIcon ? (
        <HugeiconsIcon
          icon={ctaIcons[icon]}
          size={22}
          strokeWidth={1.8}
          className="shrink-0"
          color="currentColor"
        />
      ) : null}
      <span>{children}</span>
    </a>
  );
}

function Layout() {
  return (
    <main className="overflow-x-hidden">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#12100b]/86 backdrop-blur-md">
        <div className="mx-auto flex h-[52px] w-full max-w-[1440px] items-center justify-between px-6 md:px-10">
          <Link
            to="/"
            className="flex items-center gap-2 font-mono text-base font-bold tracking-[0.22em] text-white uppercase"
          >
            <img src="/logo-mark.svg" alt="" className="h-5 w-auto" />
            <span>Supaterm</span>
          </Link>
          <nav className="absolute left-1/2 flex -translate-x-1/2 gap-6">
            <span className="flex items-center gap-1.5 text-sm text-white/50">
              Docs
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[0.6rem] leading-none text-white/40">
                WIP
              </span>
            </span>
            <Link
              to="/changelog"
              className="text-sm text-white/50 transition-colors hover:text-white/80"
              activeProps={{ className: "text-sm text-white/80" }}
            >
              Changelog
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <CtaLink
              href={downloadHref}
              icon="download"
              showIcon={false}
              download
              onClick={() => posthog.capture("nav_download_clicked")}
              className="h-[1.55rem] rounded-full bg-[#f1ede4] px-3.5 text-[0.7rem] leading-none font-normal text-[#12100b] hover:bg-white"
            >
              Download
            </CtaLink>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="px-6 pb-10 md:px-10 md:pb-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 border-t border-white/8 pt-6 text-sm text-white/42 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.svg" alt="Supaterm" className="h-5 w-auto" />
            <span>Supaterm</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a
              href={githubHref}
              onClick={() => posthog.capture("footer_github_clicked")}
              className="transition-colors hover:text-white/78"
            >
              GitHub
            </a>
            <Link to="/changelog" className="transition-colors hover:text-white/78">
              Changelog
            </Link>
            <a
              href={releasesHref}
              onClick={() => posthog.capture("footer_releases_clicked")}
              className="transition-colors hover:text-white/78"
            >
              Releases
            </a>
            <a
              href="https://x.com/khoiracle"
              onClick={() => posthog.capture("footer_twitter_clicked")}
              className="transition-colors hover:text-white/78"
            >
              Made by @khoiracle
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

export { CtaLink, Layout, downloadHref, githubHref };
export type { CtaLinkProps };
