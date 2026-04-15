import { Badge } from "@/components/ui/badge";
import { changelogData, type ChangeCategory } from "@/lib/changelog-data";

const categoryOrder: ChangeCategory[] = ["new", "improvements", "fixes"];

function ChangelogPage() {
  return (
    <section className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-[84px] md:px-10 md:pb-32 md:pt-[92px]">
      <div className="mx-auto max-w-3xl pt-6 md:pt-10 lg:pt-12">
        <h1 className="text-[clamp(1rem,4vw,2rem)] leading-[1] font-medium tracking-[-0.04em]">
          Changelog
        </h1>
      </div>
      <div className="mx-auto mt-12 max-w-3xl">
        {changelogData.map((entry) => {
          const sorted = [...entry.sections].sort(
            (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category),
          );

          return (
            <article
              key={entry.version}
              className="relative grid gap-x-10 pb-14 md:grid-cols-[160px_1fr]"
            >
              <div className="relative md:pt-0.5">
                <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-1.5">
                  <Badge variant="outline">{entry.version}</Badge>
                  <span className="text-sm text-white/42">{entry.date}</span>
                </div>
                <div className="absolute top-0 right-0 bottom-0 hidden w-px bg-white/8 md:block" />
                <div className="absolute top-1.5 -right-[4.5px] hidden size-2 rounded-full border border-white/20 bg-[#12100b] md:block" />
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
                    <div key={section.category} className="border-t border-white/8 pt-4">
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
