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

function App() {
  return (
    <main className="overflow-x-hidden">
      <section className="relative isolate min-h-svh">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col px-6 pb-18 pt-6 md:px-10 md:pb-24 md:pt-8">
          <header
            className="supaterm-reveal flex items-center justify-between gap-6"
            style={{ animationDelay: "40ms" }}
          >
            <a href="/" className="flex items-center gap-3">
              <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-10 rounded-[12px]" />
              <span className="text-sm font-medium tracking-[0.2em] text-white/80 uppercase">
                Supaterm
              </span>
            </a>
            <div className="flex items-center gap-3">
              <a
                href={githubHref}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "rounded-full border-white/12 bg-white/6 px-5 text-white/88 hover:border-white/18 hover:bg-white/10",
                )}
              >
                GitHub
              </a>
              <a
                href={downloadHref}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "rounded-full bg-[#f1ede4] px-6 text-[#12100b] hover:bg-white",
                )}
              >
                Download for macOS
              </a>
            </div>
          </header>

          <div className="grid flex-1 items-end gap-14 pt-16 md:pt-20 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] xl:gap-10 xl:pt-24">
            <div className="max-w-[560px]">
              <div
                className="supaterm-reveal text-sm font-medium tracking-[0.22em] text-white/52 uppercase"
                style={{ animationDelay: "120ms" }}
              >
                Native macOS terminal
              </div>
              <h1
                className="supaterm-reveal mt-5 text-[clamp(2.9rem,6.6vw,5.9rem)] leading-[0.92] font-medium tracking-[-0.06em] text-balance text-[#f4f0e8]"
                style={{ animationDelay: "180ms" }}
              >
                The terminal built for parallel agent work.
              </h1>
              <p
                className="supaterm-reveal mt-6 max-w-[29rem] text-base leading-7 text-white/62 md:text-[1.04rem]"
                style={{ animationDelay: "240ms" }}
              >
                Supaterm keeps spaces, tabs, panes, and agent activity in one calm macOS surface so
                you can stay in control while the work fans out.
              </p>
              <div
                className="supaterm-reveal mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
                style={{ animationDelay: "300ms" }}
              >
                <a
                  href={downloadHref}
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "rounded-full bg-[#f1ede4] px-7 text-base text-[#12100b] hover:bg-white",
                  )}
                >
                  Download for macOS
                </a>
                <a
                  href={githubHref}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "rounded-full border-white/12 bg-white/6 px-6 text-base text-white/88 hover:border-white/18 hover:bg-white/10",
                  )}
                >
                  GitHub
                </a>
              </div>
            </div>

            <div className="supaterm-reveal relative" style={{ animationDelay: "360ms" }}>
              <div className="supaterm-stage">
                <div className="supaterm-stage-bar">
                  <div className="supaterm-stage-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="supaterm-stage-title">supaterm.app</div>
                </div>
                <div className="supaterm-stage-video-wrap">
                  <video
                    src={demoUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="supaterm-stage-video"
                  />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3 text-[0.7rem] font-medium tracking-[0.18em] text-white/42 uppercase">
                <span>Spaces</span>
                <span>Tabs</span>
                <span>Panes</span>
                <span>Agent hooks</span>
                <span>Socket control</span>
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

              <div className="supaterm-shot">
                <div className="supaterm-shot-bar">
                  <div className="supaterm-shot-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="supaterm-shot-label">{section.placeholder}</div>
                  <div className="supaterm-shot-accent">{section.accent}</div>
                </div>
                <div className="supaterm-shot-body">
                  <div className="supaterm-shot-sidebar">
                    <div className="supaterm-shot-tag" />
                    <div className="supaterm-shot-stack">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="supaterm-shot-stack supaterm-shot-stack-muted">
                      <span />
                      <span />
                    </div>
                  </div>
                  <div className="supaterm-shot-canvas">
                    <div className="supaterm-shot-row supaterm-shot-row-wide" />
                    <div className="supaterm-shot-grid">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="supaterm-shot-terminal">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="supaterm-shot-footer">
                      <span />
                      <span />
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
          <div className="supaterm-reveal text-[clamp(3.8rem,10vw,9rem)] leading-[0.9] font-medium tracking-[-0.08em] text-balance text-[#f4f0e8]">
            Try Supaterm now.
          </div>
          <div className="supaterm-reveal mt-8 flex flex-col gap-4 sm:flex-row">
            <a
              href={downloadHref}
              className={cn(
                buttonVariants({ size: "lg" }),
                "min-w-0 rounded-full bg-[#f1ede4] px-8 py-7 text-[1.15rem] text-[#12100b] hover:bg-white md:min-w-[21rem]",
              )}
            >
              Download for macOS
            </a>
            <a
              href={githubHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "min-w-0 rounded-full border-white/10 bg-white/6 px-8 py-7 text-[1.15rem] text-white/88 hover:border-white/18 hover:bg-white/10 md:min-w-[19rem]",
              )}
            >
              View on GitHub
            </a>
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
              @khoiracle
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default App;
