import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { posthog } from "posthog-js";
import { type ReactNode, useEffect, useRef, useState } from "react";
import heroUrl from "../assets/hero.png";
import agentsUrl from "../assets/agents.mp4";
import splitUrl from "../assets/split.mp4";
import pinUrl from "../assets/pin.mp4";
import { cn } from "@/lib/utils";
import { CtaLink, downloadHref, githubHref } from "@/components/layout";

type FeatureSection = {
  eyebrow: string;
  title: string;
  body: ReactNode;
  align: "left" | "right";
  video?: string;
};

const homebrewInstallCommand = "brew install supaterm";
const skillsCommand = "npx skills add supabitapp/supaterm-skills";

function CommandCopyBox({
  command,
  className,
  codeClassName,
}: {
  command: string;
  className?: string;
  codeClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5",
        className,
      )}
    >
      <code
        className={cn(
          "flex min-w-0 flex-1 items-center font-mono text-sm text-white/80",
          codeClassName,
        )}
      >
        <span className="break-all">$ {command}</span>
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${command}`}
        className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
      >
        <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

const featureSections: FeatureSection[] = [
  {
    eyebrow: "CLI and Agent Skills",
    title: "Control Supaterm from scripts, or tell your agents to do it.",
    body: (
      <>
        <p className="mt-5 max-w-[30rem] text-base leading-7 text-white/62 md:text-lg">
          Want to spawn new worktrees in new panes or tabs? Just tell your agents to do it in
          Supaterm.
        </p>
        <CommandCopyBox command={skillsCommand} className="mt-5 w-fit" />
      </>
    ),
    align: "right",
    video: splitUrl,
  },
  {
    eyebrow: "Coding Agents Integrations",
    title: "Keep every coding agent visible without losing the terminal.",
    body: (
      <>
        <ul className="mt-5 max-w-[30rem] list-disc space-y-2 pl-5 text-base leading-7 text-white/62 md:text-lg">
          <li>Agent statues are shown on the sidebar</li>
          <li>Quickly hover to see what it's up to</li>
          <li>Pane glows if an agent needs your attention</li>
        </ul>
        <div className="mt-6 flex items-center gap-5">
          <img src="/claude-code-mark.svg" alt="Claude Code" className="h-6" />
          <img src="/codex-mark.svg" alt="Codex" className="h-6" />
          <img src="/pi-mark.svg" alt="Pi" className="h-6" />
          <span className="text-sm text-white/30">and everything else</span>
        </div>
      </>
    ),
    align: "left",
    video: agentsUrl,
  },
  {
    eyebrow: "Spaces, tabs, panes",
    title: "Organize messy terminal work into something you can actually steer.",
    body: (
      <ul className="mt-5 max-w-[30rem] list-disc space-y-2 pl-5 text-base leading-7 text-white/62 md:text-lg">
        <li>Organize tabs in to spaces</li>
        <li>Within tabs split into multiple panes</li>
        <li>Pin tabs with your favorite pane layout</li>
        <li>Resume coding agents after app relaunch (Coming soon...)</li>
      </ul>
    ),
    align: "right",
    video: pinUrl,
  },
];

function LazyVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void video.play();
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={ref} src={src} controls loop muted playsInline className={className} />;
}

const nouns = ["speed", "taste", "skills", "a CLI", "focus", "flow", "craft"];

function useRotatingWord(words: string[], intervalMs = 2400) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setVisible(true);
      }, 300);
    }, intervalMs);
    return () => clearInterval(id);
  }, [words.length, intervalMs]);

  return { word: words[index], visible };
}

function HomePage() {
  const { word, visible } = useRotatingWord(nouns);

  return (
    <>
      <section className="relative isolate">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center px-6 pb-14 pt-[120px] text-center md:px-10 md:pb-18 md:pt-[148px]">
          <h1 className="max-w-[62rem] text-[clamp(2.6rem,6.2vw,5.6rem)] leading-[0.98] font-medium tracking-[-0.06em] text-balance text-[#f4f0e8]">
            The terminal with{" "}
            <span
              className={cn(
                "rainbow-text inline-block transition-all duration-300",
                visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
              )}
            >
              {word}
            </span>
          </h1>
          <p className="mt-7 max-w-[44rem] text-base leading-7 text-white/62 md:text-lg">
            Agent-first, blazing fast, native macOS terminal built with libghostty. Organize with
            spaces, tabs, and panes. Automate via the <code className="text-white/72">sp</code> CLI
            and agent skills.
          </p>
          <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
            <CtaLink
              href={downloadHref}
              icon="download"
              download
              onClick={() => posthog.capture("download_clicked")}
              className="rounded-full bg-[#f1ede4] px-7 text-base text-[#12100b] hover:bg-white"
            >
              Download for macOS
            </CtaLink>
            <CtaLink
              href={githubHref}
              icon="github"
              variant="outline"
              onClick={() => posthog.capture("hero_github_clicked")}
              className="rounded-full border-white/12 bg-white/6 px-6 text-base text-white/88 hover:border-white/18 hover:bg-white/10"
            >
              GitHub
            </CtaLink>
          </div>
          <div className="mt-7 flex w-full max-w-[32rem] flex-col items-center gap-4">
            <div className="text-sm font-medium text-white/42">or</div>
            <CommandCopyBox
              command={homebrewInstallCommand}
              className="w-full max-w-[22rem] rounded-2xl px-5 py-2.5 md:max-w-[24rem] md:px-6"
              codeClassName="text-base md:text-lg"
            />
          </div>
          <p className="mt-4 text-xs text-white/32">Requires macOS Tahoe.</p>

          <div className="group relative mt-14 w-full max-w-[1160px] overflow-hidden rounded-[12px] border border-white/8 shadow-[0_40px_140px_-44px_rgba(0,0,0,0.9),0_8px_30px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] md:mt-18">
            <div className="pointer-events-none absolute inset-px z-10 border border-white/[0.03]" />
            <img
              src={heroUrl}
              alt="Supaterm running coding agents across tabs and panes"
              className="block h-auto w-full"
            />
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
                "supaterm-reveal grid items-center gap-12 border-t border-white/8 pt-12 md:gap-16 md:pt-16 lg:grid-cols-2",
                mediaFirst && "lg:[&>div:first-child]:order-1 lg:[&>div:last-child]:order-2",
                !mediaFirst && "lg:[&>div:first-child]:order-2 lg:[&>div:last-child]:order-1",
              )}
              style={{ animationDelay: `${140 + index * 80}ms` }}
            >
              <div className="max-w-[34rem]">
                <div className="text-sm font-medium tracking-[0.08em] text-white/45">
                  {section.eyebrow}
                </div>
                <h2 className="mt-4 text-[clamp(1.6rem,3.2vw,2.4rem)] leading-[1.08] font-medium tracking-[-0.04em] text-balance text-[#f4f0e8]">
                  {section.title}
                </h2>
                {typeof section.body === "string" ? (
                  <p className="mt-5 max-w-[30rem] text-base leading-7 text-white/62 md:text-lg">
                    {section.body}
                  </p>
                ) : (
                  section.body
                )}
              </div>

              <div>
                {section.video ? (
                  <div className="group relative overflow-hidden rounded-[12px] border border-white/8 shadow-[0_28px_100px_-48px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <LazyVideo src={section.video} className="block h-auto w-full" />
                  </div>
                ) : (
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
                )}
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
              download
              onClick={() => posthog.capture("cta_download_clicked")}
              className="min-w-0 rounded-full bg-[#f1ede4] px-8 py-7 text-[1.15rem] text-[#12100b] hover:bg-white md:min-w-[21rem]"
            >
              Download for macOS
            </CtaLink>
            <CtaLink
              href={githubHref}
              icon="github"
              variant="outline"
              onClick={() => posthog.capture("cta_github_clicked")}
              className="min-w-0 rounded-full border-white/10 bg-white/6 px-8 py-7 text-[1.15rem] text-white/88 hover:border-white/18 hover:bg-white/10 md:min-w-[19rem]"
            >
              View on GitHub
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}

export { HomePage, homebrewInstallCommand };
