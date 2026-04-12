import { AppleIcon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import demoUrl from "./assets/demo.mp4";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const downloadHref = "https://supaterm.com/download/latest/supaterm.dmg";
const githubHref = "https://github.com/supabitapp/supaterm";
const releasesHref = "https://github.com/supabitapp/supaterm/releases";

type FeatureSection = {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  placeholder: string;
  accent: string;
  align: "left" | "right";
};

const featureSections: FeatureSection[] = [
  {
    eyebrow: "Agent-aware workflows",
    title: "Keep every coding agent visible without losing the terminal.",
    body: "Supaterm tracks agent activity inside the pane you already work in, so parallel runs stay legible instead of disappearing into detached tabs and hidden windows.",
    points: ["Live pane context", "Focused activity states", "Built for parallel sessions"],
    placeholder: "Agent session timeline",
    accent: "Codex running",
    align: "right",
  },
  {
    eyebrow: "Spaces, tabs, panes",
    title: "Organize messy terminal work into something you can actually steer.",
    body: "Group work by space, pin the tabs that matter, and split panes without sacrificing the macOS feel. The structure stays clear as the session gets deeper.",
    points: ["Named spaces", "Pinned tabs", "Fast pane splits"],
    placeholder: "Workspace layout preview",
    accent: "3 spaces · 8 tabs · 12 panes",
    align: "left",
  },
  {
    eyebrow: "CLI and socket control",
    title: "Drive the app from scripts, hooks, and your own tooling.",
    body: "The bundled `sp` CLI and socket boundary let Supaterm respond to automation as a first-class surface, not as a screen scrape or fragile window script.",
    points: ["Socket transport", "Structured commands", "Automation-ready surfaces"],
    placeholder: "sp command surface",
    accent: "sp ls --json",
    align: "right",
  },
];

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
              <h1 className="text-[clamp(2.4rem,5.4vw,4.9rem)] leading-[0.94] font-medium tracking-[-0.06em] text-nowrap text-[#f4f0e8]">
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

      <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-24 px-6 pb-24 md:px-10 md:pb-32 md:pt-8">
        {featureSections.map((section, index) => {
          const mediaFirst = section.align === "left";

          return (
            <article
              key={section.title}
              className={cn(
                "supaterm-reveal grid items-center gap-12 border-t border-white/8 pt-12 md:gap-16 md:pt-16 xl:grid-cols-2",
                mediaFirst && "xl:[&>div:first-child]:order-1 xl:[&>div:last-child]:order-2",
                !mediaFirst && "xl:[&>div:first-child]:order-2 xl:[&>div:last-child]:order-1",
              )}
              style={{ animationDelay: `${140 + index * 80}ms` }}
            >
              <div className="max-w-[34rem]">
                <div className="text-sm font-medium tracking-[0.2em] text-white/45 uppercase">
                  {section.eyebrow}
                </div>
                <h2 className="mt-4 text-[clamp(2.4rem,4.8vw,4.5rem)] leading-[0.98] font-medium tracking-[-0.05em] text-balance text-[#f4f0e8]">
                  {section.title}
                </h2>
                <p className="mt-5 max-w-[30rem] text-base leading-7 text-white/62 md:text-lg">
                  {section.body}
                </p>
                <ul className="mt-8 flex flex-wrap gap-3">
                  {section.points.map((point) => (
                    <li
                      key={point}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/74"
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[0.76rem] tracking-[0.14em] text-white/62 uppercase">
                    {section.placeholder}
                  </div>
                  <div className="text-[0.76rem] tracking-[0.14em] text-[#f1ede4]/68 uppercase">
                    {section.accent}
                  </div>
                </div>
                <div className="group overflow-hidden border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(245,191,109,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))] bg-[rgb(17,15,11)] shadow-[0_28px_100px_-48px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] transition-transform duration-300 ease-out hover:-translate-y-1 hover:border-white/14 motion-reduce:transform-none motion-reduce:transition-none">
                  <div className="grid min-h-[27rem] [grid-template-columns:0.36fr_0.64fr] max-[900px]:grid-cols-1">
                    <div className="flex flex-col gap-6 border-r border-white/7 bg-white/[0.02] px-4 py-[1.35rem] pl-[1.2rem] max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-white/7">
                      <div className="h-4 w-[74%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))]" />
                      <div className="grid gap-3">
                        <span className="block h-[0.78rem] w-full rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[0.78rem] w-[84%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[0.78rem] w-[68%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                      </div>
                      <div className="grid gap-3">
                        <span className="block h-[0.78rem] w-full rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.1),rgba(255,255,255,0.03))]" />
                        <span className="block h-[0.78rem] w-[84%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.1),rgba(255,255,255,0.03))]" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-5 p-[1.4rem]">
                      <div className="h-4 w-[72%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                      <div className="grid grid-cols-3 gap-4">
                        <span className="block h-[5.4rem] rounded-[1.15rem] bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[5.4rem] rounded-[1.15rem] bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[5.4rem] rounded-[1.15rem] bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                      </div>
                      <div className="grid gap-3.5 rounded-[1.35rem] border border-white/8 bg-black/22 p-5">
                        <span className="block h-[0.9rem] w-[86%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[0.9rem] w-[70%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[0.9rem] w-[90%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[0.9rem] w-[52%] rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                      </div>
                      <div className="mt-auto grid grid-cols-[1.2fr_0.8fr] gap-4">
                        <span className="block h-[3.8rem] rounded-[1.15rem] bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                        <span className="block h-[3.8rem] rounded-[1.15rem] bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="px-6 pb-16 md:px-10 md:pb-24">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center border-t border-white/8 px-0 pt-18 text-center md:pt-24">
          <div className="supaterm-reveal text-[clamp(1.7rem,3.5vw,2.8rem)] leading-[1] font-medium tracking-[-0.04em] text-balance text-[#f4f0e8]">
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
