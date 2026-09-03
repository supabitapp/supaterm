import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { posthog } from "posthog-js";
import { type ReactNode, useEffect, useRef, useState } from "react";
import heroUrl from "../assets/hero.png";
import agentsUrl from "../assets/agents.mp4";
import splitUrl from "../assets/split.mp4";
import pinUrl from "../assets/pin.mp4";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CtaLink, downloadHref } from "@/components/layout";

type FeatureSection = {
  eyebrow: string;
  title: string;
  body: ReactNode;
  align: "left" | "right";
  video: string;
};

type Highlight = {
  title: string;
  body: string;
};

const homebrewInstallCommand = "brew install supaterm";
const skillsCommand = "npx skills add supabitapp/supaterm-skills";
const purchaseAction = "https://license.supaterm.com/checkout/purchase";
const cliExample = [
  "sp tab new --cwd ~/code/api -- npm run dev",
  "sp pane split right -- npm test",
  'sp pane send --submit "fix the failing test"',
  "sp pane capture --scope scrollback --lines 100",
].join("\n");
const trialFeatures = [
  "Up to five open tabs",
  "Panes do not count toward the limit",
  "No account required",
];
const personalFeatures = [
  "Unlimited open tabs",
  "365 days of updates",
  "Move your license to another Mac",
];
const licenseQuestions = [
  {
    question: "What happens after a year?",
    answer: "Keep using every release published during your update period.",
  },
  {
    question: "Do I need to renew?",
    answer: "No. Pay $59 USD only when you want another year of updates.",
  },
  {
    question: "Can I change Macs?",
    answer: "Yes. Deactivate the old Mac, then activate the new one.",
  },
];

function PurchaseButton({
  children = "Buy license for $99",
  className,
  appearance = "primary",
}: {
  children?: ReactNode;
  className?: string;
  appearance?: "primary" | "outline";
}) {
  return (
    <form action={purchaseAction} method="post" className={className}>
      <Button
        type="submit"
        size="lg"
        variant={appearance === "outline" ? "outline" : "default"}
        onClick={() => posthog.capture("purchase_clicked")}
        className={cn(
          "w-full rounded-full text-base",
          appearance === "outline"
            ? "h-11 border-white/12 bg-white/6 px-6 text-white/88 hover:border-white/18 hover:bg-white/10"
            : "h-14 bg-[#f1ede4] px-8 text-[#12100b] hover:bg-white",
        )}
      >
        {children}
      </Button>
    </form>
  );
}

function PricingFeatures({ features }: { features: string[] }) {
  return (
    <ul className="mt-8 space-y-3 text-sm leading-6 text-white/72">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-2.5">
          <HugeiconsIcon
            icon={Tick01Icon}
            size={16}
            strokeWidth={1.8}
            className="mt-1 shrink-0 text-[#f5bf6d]"
          />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

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

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 max-w-[30rem] list-disc space-y-2 pl-5 text-base leading-7 text-white/62 md:text-lg">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

const featureSections: FeatureSection[] = [
  {
    eyebrow: "Coding agents",
    title: "Run every agent in plain sight.",
    body: (
      <>
        <FeatureList
          items={[
            "Each tab shows its agent and whether it is working, waiting on you, or done",
            "The agents popover lists every live agent in the window and jumps to its pane",
            "Press Command-I for the branch, changed lines, pull request checks, and local servers",
            "A pane glows when an agent needs you, and Command-U takes you to the next unread one",
            "Fork a Claude Code or Codex session into a pane beside it",
          ]}
        />
        <div className="mt-6 flex items-center gap-5">
          <img src="/claude-code-mark.svg" alt="Claude Code" className="h-6" />
          <img src="/codex-mark.svg" alt="Codex" className="h-6" />
          <img src="/pi-mark.svg" alt="Pi" className="h-6" />
          <span className="text-sm text-white/30">plus marks for twelve more</span>
        </div>
      </>
    ),
    align: "left",
    video: agentsUrl,
  },
  {
    eyebrow: "CLI and agent skills",
    title: "Script it, or let your agents drive.",
    body: (
      <>
        <p className="mt-5 max-w-[30rem] text-base leading-7 text-white/62 md:text-lg">
          Every pane has <code className="text-white/72">sp</code> on its path. Open tabs, split
          panes, type into a prompt, read scrollback, and screenshot a pane from any script. Install
          the skill and your agents learn the same commands.
        </p>
        <pre className="mt-5 w-fit max-w-full overflow-x-auto rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm leading-6 text-white/80">
          {cliExample}
        </pre>
        <CommandCopyBox command={skillsCommand} className="mt-4 w-fit" />
      </>
    ),
    align: "right",
    video: splitUrl,
  },
  {
    eyebrow: "Spaces, groups, tabs, panes",
    title: "Give every project its own place.",
    body: (
      <FeatureList
        items={[
          "One space per project, each with a color that tints the window",
          "Switch spaces inside a window with Control-1 through Control-0",
          "Group tabs by name and color, then collapse, pin, or close the group as one",
          "Split a tab into panes, zoom one, or drag a pane into another tab or its own window",
          "Quit and relaunch: layouts, shells, and agents pick up where they were",
        ]}
      />
    ),
    align: "left",
    video: pinUrl,
  },
];

const highlights: Highlight[] = [
  {
    title: "Built on libghostty",
    body: "Ghostty 1.4 rendering with its themes and fonts. Pick separate themes for light and dark, or drop your own into ~/.config/ghostty/themes.",
  },
  {
    title: "Sessions outlive the app",
    body: "Shells and agents keep running through a relaunch or an update. Panes reattach on the way back. Closing a pane still ends it.",
  },
  {
    title: "SSH keeps up",
    body: "Run ssh from any pane and the integration follows you to the host. New tabs and splits from that pane reconnect to the same machine.",
  },
  {
    title: "One palette for everything",
    body: "Command-Shift-P finds Supaterm actions, Ghostty actions, spaces, tabs, and panes. It reads your terminal config, so it lists your bindings.",
  },
  {
    title: "Your shortcuts",
    body: "Rebind any command in Settings. Buttons and menus show their shortcut in a pill, so you learn them as you go.",
  },
  {
    title: "Attention, your way",
    body: "System notifications, or a local sound that Focus cannot silence. Unread badges stay until you look. Send your own with sp pane notify.",
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
            A native macOS terminal built on libghostty for days spent with coding agents. Sort work
            into spaces, groups, tabs, and panes. Drive it from the{" "}
            <code className="text-white/72">sp</code> CLI, or hand the skill to your agents.
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
            <PurchaseButton appearance="outline">Buy now</PurchaseButton>
          </div>
          <div className="mt-7 flex w-full max-w-[32rem] flex-col items-center gap-4">
            <div className="text-sm font-medium text-white/42">or</div>
            <CommandCopyBox
              command={homebrewInstallCommand}
              className="w-full max-w-[22rem] rounded-2xl px-5 py-2.5 md:max-w-[24rem] md:px-6"
              codeClassName="text-base md:text-lg"
            />
          </div>
          <p className="mt-4 text-xs text-white/32">Requires macOS Tahoe. Free for five tabs.</p>

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
                {section.body}
              </div>

              <div>
                <div className="group relative overflow-hidden rounded-[12px] border border-white/8 shadow-[0_28px_100px_-48px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <LazyVideo src={section.video} className="block h-auto w-full" />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="px-6 pb-24 md:px-10 md:pb-32">
        <div className="mx-auto max-w-[1440px] border-t border-white/8 pt-12 md:pt-16">
          <div className="supaterm-reveal max-w-[34rem]">
            <div className="text-sm font-medium tracking-[0.08em] text-white/45">
              And the rest of the day
            </div>
            <h2 className="mt-4 text-[clamp(1.6rem,3.2vw,2.4rem)] leading-[1.08] font-medium tracking-[-0.04em] text-balance text-[#f4f0e8]">
              A terminal first. The agent parts stay out of the way.
            </h2>
          </div>
          <div className="supaterm-reveal mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {highlights.map((highlight) => (
              <article
                key={highlight.title}
                className="rounded-[18px] border border-white/10 bg-white/[0.025] p-6 md:p-7"
              >
                <h3 className="text-base font-medium text-[#f4f0e8]">{highlight.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/58">{highlight.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-16 px-6 pb-24 md:px-10 md:pb-32">
        <div className="mx-auto max-w-[1440px] border-t border-white/8 pt-18 md:pt-24">
          <div className="supaterm-reveal mx-auto max-w-[48rem] text-center">
            <div className="text-sm font-medium tracking-[0.08em] text-white/45">Pricing</div>
            <h2 className="mt-4 text-[clamp(2rem,4.5vw,3.8rem)] leading-[1] font-medium tracking-[-0.05em] text-balance text-[#f4f0e8]">
              Pay once, use Supaterm forever.
            </h2>
            <p className="mx-auto mt-6 max-w-[38rem] text-base leading-7 text-white/62 md:text-lg">
              Start with the trial. Buy a personal license when you need more than five open tabs.
            </p>
          </div>

          <div className="supaterm-reveal mx-auto mt-12 grid max-w-[900px] gap-5 md:grid-cols-2">
            <article className="flex flex-col rounded-[18px] border border-white/10 bg-white/[0.025] p-7 md:p-9">
              <div className="text-sm font-medium text-white/48">Trial</div>
              <div className="mt-4 text-5xl font-medium tracking-[-0.05em] text-[#f4f0e8]">$0</div>
              <p className="mt-4 min-h-14 text-base leading-7 text-white/58">
                Every feature, no account, no license. Supaterm never closes your tabs to enforce
                the limit.
              </p>
              <PricingFeatures features={trialFeatures} />
              <CtaLink
                href={downloadHref}
                icon="download"
                showIcon={false}
                download
                onClick={() => posthog.capture("pricing_download_clicked")}
                className="mt-10 h-14 w-full rounded-full border-white/12 bg-white/6 px-8 text-base text-white/88 hover:border-white/18 hover:bg-white/10"
                variant="outline"
              >
                Download trial
              </CtaLink>
            </article>

            <article className="flex flex-col rounded-[18px] border border-[#f5bf6d]/30 bg-[radial-gradient(circle_at_top_right,rgba(245,191,109,0.14),transparent_42%),rgba(255,255,255,0.04)] p-7 shadow-[0_32px_100px_-54px_rgba(245,191,109,0.45)] md:p-9">
              <div className="text-sm font-medium text-[#f5bf6d]">Personal</div>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-5xl font-medium tracking-[-0.05em] text-[#f4f0e8]">
                  $99 USD
                </span>
                <span className="pb-1 text-sm text-white/45">one-time purchase</span>
              </div>
              <p className="mt-4 min-h-14 text-base leading-7 text-white/62">
                A perpetual license for one Mac at a time. Activate from the app, a link, or{" "}
                <code className="text-white/72">sp license</code>.
              </p>
              <PricingFeatures features={personalFeatures} />
              <PurchaseButton className="mt-10" />
              <p className="mt-4 text-center text-xs leading-5 text-white/42">
                No recurring charge. Tax may apply. Seven-day refund period.
              </p>
            </article>
          </div>

          <dl className="supaterm-reveal mx-auto mt-12 grid max-w-[900px] gap-8 border-t border-white/8 pt-10 md:grid-cols-3">
            {licenseQuestions.map(({ question, answer }) => (
              <div key={question}>
                <dt className="font-medium text-[#f4f0e8]">{question}</dt>
                <dd className="mt-3 text-sm leading-6 text-white/52">{answer}</dd>
              </div>
            ))}
          </dl>
        </div>
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
              className="h-14 min-w-0 rounded-full bg-[#f1ede4] px-8 text-base text-[#12100b] hover:bg-white md:min-w-[21rem]"
            >
              Download for macOS
            </CtaLink>
            <PurchaseButton className="min-w-0 md:min-w-[19rem]" />
          </div>
        </div>
      </section>
    </>
  );
}

export { HomePage, homebrewInstallCommand, purchaseAction };
