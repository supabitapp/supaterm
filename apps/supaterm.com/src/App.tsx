import { AppleIcon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import demoUrl from "./assets/demo.mp4";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const downloadHref = "https://supaterm.com/download/latest/supaterm.dmg";
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
};

function CtaLink({
  href,
  icon,
  children,
  className,
  variant = "default",
  size = "lg",
  showIcon = true,
}: CtaLinkProps) {
  return (
    <a
      href={href}
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

function App() {
  return (
    <main className="overflow-x-hidden">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#12100b]/86 backdrop-blur-md">
        <div className="mx-auto flex h-[52px] w-full max-w-[1440px] items-center justify-between px-6 md:px-10">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-8 rounded-[10px]" />
            <span className="text-xs font-medium tracking-[0.18em] text-white/80 uppercase">
              Supaterm
            </span>
          </a>
          <div className="flex items-center gap-2">
            <CtaLink
              href={githubHref}
              icon="github"
              variant="outline"
              showIcon={false}
              className="h-[1.55rem] rounded-full border-white/12 bg-white/4 px-3.5 text-[0.7rem] leading-none font-normal text-white/82 hover:border-white/18 hover:bg-white/8"
            >
              GitHub
            </CtaLink>
            <CtaLink
              href={downloadHref}
              icon="download"
              showIcon={false}
              className="h-[1.55rem] rounded-full bg-[#f1ede4] px-3.5 text-[0.7rem] leading-none font-normal text-[#12100b] hover:bg-white"
            >
              Download
            </CtaLink>
          </div>
        </div>
      </header>

      <section className="relative isolate min-h-svh">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col px-6 pb-14 pt-[84px] md:px-10 md:pb-18 md:pt-[92px]">
          <div className="grid flex-1 items-center gap-10 pt-6 md:pt-10 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:gap-10 xl:pt-12">
            <div className="max-w-[560px]">
              <h1 className="text-[clamp(2.4rem,5.4vw,4.9rem)] leading-[0.94] font-medium tracking-[-0.06em] text-balance text-[#f4f0e8]">
                The terminal with skills.
              </h1>
              <p className="mt-6 max-w-[29rem] text-base leading-7 text-white/62 md:text-[1.04rem]">
                Supaterm keeps spaces, tabs, panes, and agent activity in one calm macOS surface so
                you can stay in control while the work fans out.
              </p>
              <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <CtaLink
                  href={downloadHref}
                  icon="download"
                  className="rounded-full bg-[#f1ede4] px-7 text-base text-[#12100b] hover:bg-white"
                >
                  Download for macOS
                </CtaLink>
                <CtaLink
                  href={githubHref}
                  icon="github"
                  variant="outline"
                  className="rounded-full border-white/12 bg-white/6 px-6 text-base text-white/88 hover:border-white/18 hover:bg-white/10"
                >
                  GitHub
                </CtaLink>
              </div>
            </div>

            <div className="relative">
              <div className="group relative overflow-hidden rounded-[12px] border border-white/8 shadow-[0_40px_140px_-44px_rgba(0,0,0,0.9),0_8px_30px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="pointer-events-none absolute inset-px border border-white/[0.03]" />
                <div className="relative overflow-hidden">
                  <video
                    src={demoUrl}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="block h-auto w-full saturate-[1.02] contrast-[1.02]"
                  />
                </div>
              </div>
              <div className="mt-5 text-[0.7rem] font-medium tracking-[0.12em] text-white/42 uppercase">
                Claude Code spawning multiple Codex agents working in tabs
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-16 md:px-10 md:pb-24">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center border-t border-white/8 px-0 pt-18 text-center md:pt-24">
          <div className="supaterm-reveal text-[clamp(2.6rem,6.8vw,5.6rem)] leading-[0.92] font-medium tracking-[-0.07em] text-balance text-[#f4f0e8]">
            Ready to meet your new terminal?
          </div>
          <div className="supaterm-reveal mt-8 flex flex-col gap-4 sm:flex-row">
            <CtaLink
              href={downloadHref}
              icon="download"
              className="min-w-0 rounded-full bg-[#f1ede4] px-8 py-7 text-[1.15rem] text-[#12100b] hover:bg-white md:min-w-[21rem]"
            >
              Download for macOS
            </CtaLink>
            <CtaLink
              href={githubHref}
              icon="github"
              variant="outline"
              className="min-w-0 rounded-full border-white/10 bg-white/6 px-8 py-7 text-[1.15rem] text-white/88 hover:border-white/18 hover:bg-white/10 md:min-w-[19rem]"
            >
              View on GitHub
            </CtaLink>
          </div>
        </div>
      </section>

      <footer className="px-6 pb-10 md:px-10 md:pb-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 border-t border-white/8 pt-6 text-sm text-white/42 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-5 rounded-[6px]" />
            <span>Supaterm</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={githubHref} className="transition-colors hover:text-white/78">
              GitHub
            </a>
            <a href={releasesHref} className="transition-colors hover:text-white/78">
              Releases
            </a>
            <a href="https://x.com/khoiracle" className="transition-colors hover:text-white/78">
              Made by @khoiracle
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default App;
