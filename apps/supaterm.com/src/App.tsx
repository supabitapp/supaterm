import heroUrl from "./assets/hero.png";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const downloadHref = "https://supaterm.com/download/latest/supaterm.dmg";
const githubHref = "https://github.com/supabitapp/supaterm";
const releasesHref = "https://github.com/supabitapp/supaterm/releases";

const features = [
  {
    title: "Native macOS runtime",
    description:
      "Built for macOS with window chrome, terminal rendering, and keyboard flow that stay fast under parallel work.",
    badge: "macOS",
  },
  {
    title: "Spaces, tabs, panes",
    description:
      "Split work across spaces, pin important tabs, and keep multiple panes visible without losing the thread.",
    badge: "Layout",
  },
  {
    title: "Agent hooks",
    description:
      "Install Claude and Codex hooks once, then let Supaterm surface running, idle, and needs-input state at the tab level.",
    badge: "Hooks",
  },
  {
    title: "Socket-driven CLI",
    description:
      "Use the sp CLI to create panes and tabs, focus targets, capture output, and automate the app from the shell.",
    badge: "CLI",
  },
  {
    title: "Parallel agent workflows",
    description:
      "Run multiple coding sessions side by side and keep each one isolated inside its own pane, tab, or space.",
    badge: "Agents",
  },
  {
    title: "Open source",
    description:
      "Inspect the code, script the app, and shape the workflow around your own tooling instead of a closed box.",
    badge: "OSS",
  },
];

function App() {
  return (
    <main>
      <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10 md:px-8">
        <nav
          className="supaterm-reveal mb-20 flex items-center justify-between gap-6 md:mb-28"
          style={{ animationDelay: "40ms" }}
        >
          <div className="flex items-center gap-3">
            <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-9 rounded-[10px]" />
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href={githubHref} className="transition-colors hover:text-foreground">
              GitHub
            </a>
            <a href={releasesHref} className="transition-colors hover:text-foreground">
              Releases
            </a>
          </div>
        </nav>

        <section className="mb-16 flex flex-col items-center text-center md:mb-24">
          <h1
            className="supaterm-reveal max-w-4xl text-4xl font-semibold tracking-tight text-balance md:text-6xl lg:text-7xl"
            style={{ animationDelay: "120ms" }}
          >
            Meet Supaterm
          </h1>
          <p
            className="supaterm-reveal mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
            style={{ animationDelay: "200ms" }}
          >
            Supaterm is a native macOS terminal for agent-driven work, with spaces, tabs, panes, and
            a socket-driven CLI that can steer the UI from inside the shell.
          </p>
          <div
            className="supaterm-reveal mt-10 flex flex-col items-center"
            style={{ animationDelay: "280ms" }}
          >
            <a href={downloadHref} className={buttonVariants({ size: "lg" })}>
              Download for macOS
            </a>
          </div>
        </section>

        <section className="supaterm-reveal mb-24 md:mb-32" style={{ animationDelay: "360ms" }}>
          <div className="supaterm-glow relative overflow-hidden rounded-2xl border border-border/60 bg-card/80">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <div className="relative flex justify-center px-8 py-14 md:px-16 md:py-16">
              <img
                src={heroUrl}
                alt="Supaterm workspace"
                className="w-full max-w-[343px] grayscale md:max-w-[420px]"
              />
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Spaces, tabs, and panes built for parallel terminal work
          </p>
        </section>

        <Separator className="supaterm-reveal mb-24 md:mb-32" style={{ animationDelay: "420ms" }} />

        <section className="mb-24 md:mb-32">
          <h2
            className="supaterm-reveal mb-12 text-center text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground md:mb-16"
            style={{ animationDelay: "480ms" }}
          >
            Built for flow
          </h2>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border/50 bg-border/50 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="supaterm-reveal flex flex-col gap-4 bg-background/95 p-8"
                style={{ animationDelay: `${540 + index * 60}ms` }}
              >
                <Badge>{feature.badge}</Badge>
                <h3 className="text-lg font-semibold tracking-tight">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="supaterm-reveal mb-24 flex flex-col items-center gap-6 text-center md:mb-32">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            Ready to run agents without leaving the terminal?
          </h2>
          <a href={downloadHref} className={buttonVariants({ size: "lg" })}>
            Download Supaterm
          </a>
        </section>

        <Separator className="supaterm-reveal" />

        <footer className="supaterm-reveal flex flex-col items-center gap-4 py-10 text-sm text-muted-foreground md:flex-row md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/supaterm-app-icon.png" alt="Supaterm" className="size-5 rounded-[6px]" />
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href={githubHref} className="transition-colors hover:text-foreground">
              GitHub
            </a>
            <a href={releasesHref} className="transition-colors hover:text-foreground">
              Releases
            </a>
            <a href={downloadHref} className="transition-colors hover:text-foreground">
              Download
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}

export default App;
