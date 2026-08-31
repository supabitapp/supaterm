import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { posthog } from "posthog-js";
import { docsHref, githubHref } from "@/components/layout";

function HomePage() {
  return (
    <section className="coming-soon-grid relative isolate flex min-h-[calc(100svh-128px)] items-center overflow-hidden px-6 py-20 md:px-10">
      <div className="coming-soon-glow pointer-events-none absolute inset-0 -z-10" />

      <div className="supaterm-reveal mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <div className="mb-9 flex items-center gap-2.5 rounded-full border border-[#ffa82d]/20 bg-[#ffa82d]/6 px-3.5 py-2 text-[0.68rem] font-medium tracking-[0.16em] text-[#ffc36d] uppercase">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ffa82d] opacity-40 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-[#ffa82d]" />
          </span>
          Site refresh in progress
        </div>

        <h1 className="max-w-[11ch] text-[clamp(3.4rem,10vw,8.75rem)] leading-[0.86] font-medium tracking-[-0.075em] text-balance text-[#f4f0e8]">
          Coming soon<span className="text-[#ffa82d]">.</span>
        </h1>

        <p className="mt-9 max-w-xl text-base leading-7 text-white/56 md:text-lg md:leading-8">
          We’re rebuilding supaterm.com. Check back soon for the new site.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-4 text-sm">
          <a
            href={githubHref}
            onClick={() => posthog.capture("coming_soon_github_clicked")}
            className="group inline-flex items-center gap-2 text-white/72 transition-colors hover:text-white"
          >
            GitHub
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={15}
              strokeWidth={1.8}
              className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </a>
          <span className="size-1 rounded-full bg-white/18" aria-hidden="true" />
          <a
            href={docsHref}
            onClick={() => posthog.capture("coming_soon_docs_clicked")}
            className="group inline-flex items-center gap-2 text-white/72 transition-colors hover:text-white"
          >
            Docs
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={15}
              strokeWidth={1.8}
              className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </a>
        </div>

        <div className="mt-16 flex w-full max-w-lg items-center gap-4 text-[0.62rem] tracking-[0.18em] text-white/22 uppercase">
          <span className="h-px flex-1 bg-white/8" />
          Native macOS terminal
          <span className="h-px flex-1 bg-white/8" />
        </div>
      </div>
    </section>
  );
}

export { HomePage };
