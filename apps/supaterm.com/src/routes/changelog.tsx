import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  categoryConfig,
  changelogData,
  type ChangeCategory,
  type ChangeSection,
} from "@/lib/changelog-data";

function CategoryAccordion({ section }: { section: ChangeSection }) {
  const [open, setOpen] = useState(section.category === "new");
  const config = categoryConfig[section.category];

  return (
    <div className="border-t border-white/8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-4"
      >
        <span
          className={`inline-block rounded-md border px-2.5 py-1 text-xs font-medium ${config.className}`}
        >
          {config.label}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-white/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="list-disc space-y-1.5 pb-5 pl-5 text-base leading-7 text-white/62">
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const categoryOrder: ChangeCategory[] = ["new", "improvements", "fixes"];

function ChangelogPage() {
  return (
    <section className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-[84px] md:px-10 md:pb-32 md:pt-[92px]">
      <div className="max-w-2xl pt-6 md:pt-10 lg:pt-12">
        <h1 className="text-[clamp(1rem,4vw,2rem)] leading-[1] font-medium tracking-[-0.04em]">
          Changelog
        </h1>
      </div>
      <div className="mt-12 max-w-2xl">
        {changelogData.map((entry) => {
          const sorted = [...entry.sections].sort(
            (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category),
          );

          return (
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
              {entry.description ? (
                <p className="mt-3 text-base leading-7 text-white/62">{entry.description}</p>
              ) : null}
              {entry.image ? (
                <div className="mt-6 overflow-hidden rounded-[12px] border border-white/8">
                  <img src={entry.image} alt={entry.title} className="block w-full" />
                </div>
              ) : null}
              <div className="mt-6">
                {sorted.map((section) => (
                  <CategoryAccordion key={section.category} section={section} />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export { ChangelogPage };
