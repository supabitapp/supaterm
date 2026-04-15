import { Badge } from "@/components/ui/badge";
import { changelogData, type ChangeCategory } from "@/lib/changelog-data";

const categoryOrder: ChangeCategory[] = ["new", "improvements", "fixes"];

function ChangelogPage() {
  return (
    <section className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-[84px] md:px-10 md:pb-32 md:pt-[92px]">
      <div className="mx-auto grid max-w-3xl gap-x-12 pt-6 md:grid-cols-[180px_1fr] md:pt-10 lg:pt-12">
        <div className="hidden md:block" />
        <div>
          <h1 className="text-[clamp(1rem,4vw,2rem)] leading-[1] font-medium tracking-[-0.04em]">
            Changelog
          </h1>
          <p className="mt-3 text-base leading-7 text-white/50">
            See what's new added, changed, fixed, improved or updated.
          </p>
          <p className="mt-1 text-base leading-7 text-white/50">
            Follow{" "}
            <a
              href="https://x.com/khoiracle"
              className="text-white/70 underline underline-offset-2 transition-colors hover:text-white/90"
            >
              @khoiracle
            </a>{" "}
            for personalized tips for each release.
          </p>
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-3xl">
        {changelogData.map((entry) => {
          const sorted = [...entry.sections].sort(
            (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category),
          );

          return (
            <article
              key={entry.version}
              className="relative grid gap-x-12 pb-14 md:grid-cols-[180px_1fr]"
            >
              <div className="relative md:pt-0.5">
                <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-2 md:pr-6">
                  <Badge variant="outline">{entry.version}</Badge>
                  <span className="text-sm text-white/42">{entry.date}</span>
                </div>
                <div className="absolute top-[22px] right-0 bottom-0 hidden w-px bg-white/10 md:block" />
                <div className="absolute top-[3px] -right-[7px] hidden size-[14px] rounded-full border-[3px] border-white/30 bg-[#12100b] md:block" />
              </div>
              <div>
                <h2 className="mt-4 text-xl font-medium tracking-[-0.02em] text-[#f4f0e8] md:mt-0">
                  {entry.title}
                </h2>
                {entry.description ? (
                  <p className="mt-3 text-base leading-7 text-white/62">{entry.description}</p>
                ) : null}
                {entry.image ? (
                  <div className="mt-6 overflow-hidden rounded-[12px] border border-white/8">
                    <img src={entry.image} alt={entry.title} className="block w-full" />
                  </div>
                ) : null}
                <div className="mt-6 space-y-5">
                  {sorted.map((section) => (
                    <div key={section.category} className="pt-4">
                      <h3 className="text-sm font-semibold text-[#f4f0e8]">
                        {section.category === "new"
                          ? "✨ New"
                          : section.category === "improvements"
                            ? "🔧 Improvements"
                            : "🐛 Bug Fixes"}
                      </h3>
                      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base leading-7 text-white/62">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export { ChangelogPage };
