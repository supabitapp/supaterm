import { AppleIcon, Copy01Icon, GithubIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { posthog } from "posthog-js";
import { type ReactNode, useEffect, useState } from "react";
import demoUrl from "./assets/demo.mp4";
import splitUrl from "./assets/split.mp4";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const downloadHref = "https://supaterm.com/download/latest/supaterm.dmg";
const githubHref = "https://github.com/supabitapp/supaterm";
const releasesHref = "https://github.com/supabitapp/supaterm/releases";

type FeatureSection = {
  eyebrow: string;
  title: string;
  body: ReactNode;
  align: "left" | "right";
  video?: string;
};

const featureSections: FeatureSection[] = [
  {
    eyebrow: "CLI and Agent Skills",
    title: "Control the app from scripts, or tell your agents to do it.",
    body: <NpxSkillsBox />,
    align: "right",
    video: splitUrl,
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
  onClick?: () => void;
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
}: CtaLinkProps) {
  return (
    <a
      href={href}
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

const skillsCommand = "npx skills add supabitapp/supaterm-skills";

function NpxSkillsBox() {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(skillsCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 flex items-center gap-3">
      <code className="flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-sm text-white/80">
        $ {skillsCommand}
      </code>
      <button
        type="button"
        onClick={copy}
        className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
      >
        <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

const nouns = ["speed", "skills", "a CLI", "focus", "flow", "craft"];

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

function App() {
  const { word, visible } = useRotatingWord(nouns);

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
              onClick={() => posthog.capture("nav_github_clicked")}
              className="h-[1.55rem] rounded-full border-white/12 bg-white/4 px-3.5 text-[0.7rem] leading-none font-normal text-white/82 hover:border-white/18 hover:bg-white/8"
            >
              GitHub
            </CtaLink>
            <CtaLink
              href={downloadHref}
              icon="download"
              showIcon={false}
              onClick={() => posthog.capture("nav_download_clicked")}
              className="h-[1.55rem] rounded-full bg-[#f1ede4] px-3.5 text-[0.7rem] leading-none font-normal text-[#12100b] hover:bg-white"
            >
              Download
            </CtaLink>
          </div>
        </div>
      </header>

      <section className="relative isolate">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col px-6 pb-14 pt-[84px] md:px-10 md:pb-18 md:pt-[92px]">
          <div className="grid flex-1 items-center gap-10 pt-6 md:pt-10 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:gap-10 xl:pt-12">
            <div className="max-w-[560px]">
              <h1 className="text-[clamp(2.4rem,5.4vw,4.9rem)] leading-[0.94] font-medium tracking-[-0.06em] text-balance text-[#f4f0e8]">
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
              <ul className="mt-6 max-w-[29rem] list-disc space-y-2 pl-5 text-base leading-7 text-white/62 md:text-[1.04rem]">
                <li>Fast - native macOS built with libghostty</li>
                <li>Agent first - Glowing pane, notifications...</li>
                <li>Tidy - Organize using tabs, spaces, pin tabs with your splits setup</li>
                <li>
                  Extensible - Automate via the <code className="text-white/72">sp</code> CLI and
                  agent skill.
                </li>
                <li>and many more...</li>
              </ul>
              <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <CtaLink
                  href={downloadHref}
                  icon="download"
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
                Claude Code using Supaterm skills to spawn Codex agents working in tabs
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
                    <video
                      src={section.video}
                      controls
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="block h-auto w-full"
                    />
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

      <footer className="px-6 pb-10 md:px-10 md:pb-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 border-t border-white/8 pt-6 text-sm text-white/42 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-5 rounded-[6px]" />
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

export default App;
