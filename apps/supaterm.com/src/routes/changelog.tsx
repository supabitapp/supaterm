import { Badge } from "@/components/ui/badge";
import { changelogData } from "@/lib/changelog-data";

function ChangelogPage() {
  return (
    <section className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-[84px] md:px-10 md:pb-32 md:pt-[92px]">
      <div className="max-w-2xl pt-6 md:pt-10 lg:pt-12">
        <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1] font-medium tracking-[-0.04em] text-[#f4f0e8]">
          Changelog
        </h1>
      </div>
      <div className="mt-12 max-w-2xl">
        {changelogData.map((entry) => (
          <article
            key={entry.version}
            className="border-t border-white/8 py-10 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center gap-3">
              <Badge variant="outline">{entry.version}</Badge>
              <span className="text-sm text-white/42">{entry.date}</span>
            </div>
            <h2 className="mt-4 text-xl font-medium tracking-[-0.02em] text-[#f4f0e8]">
              {entry.title}
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-7 text-white/62">
              {entry.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export { ChangelogPage };
