import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "blume";
import { makeCliReferenceSource } from "./cli-reference-source";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const skillsRef = execFileSync(
  "git",
  ["-C", repositoryRoot, "rev-parse", "HEAD:integrations/supaterm-skills"],
  { encoding: "utf8" },
).trim();

export default defineConfig({
  title: "Supaterm",
  description:
    "Learn how to use Supaterm, work with coding agents, and automate terminal workflows with sp.",
  logo: {
    image: "/icon.svg",
    text: "Supaterm",
  },
  content: {
    sources: [
      { type: "filesystem", root: "docs" },
      {
        type: "custom",
        source: makeCliReferenceSource(repositoryRoot, skillsRef),
      },
    ],
  },
  deployment: {
    output: "static",
    site: "https://docs.supaterm.com",
  },
  github: {
    owner: "supabitapp",
    repo: "supaterm",
    branch: "main",
    dir: "apps/docs.supaterm.com",
  },
  feedback: false,
  lastModified: true,
  navigation: {
    tabs: [{ label: "Guides", path: "/guides", icon: "book-open" }],
    featured: [
      {
        label: "Download Supaterm",
        href: "https://supaterm.com/download/latest/supaterm.dmg",
        icon: "download",
      },
      {
        label: "Changelog",
        href: "https://supaterm.com/changelog",
        icon: "history",
      },
    ],
    repo: true,
    sidebar: { display: "group" },
  },
  search: { provider: "orama" },
  ai: {
    ask: { enabled: false },
    llmsTxt: true,
    mcp: { enabled: false },
  },
  seo: {
    agentReadability: true,
    og: { enabled: true },
    robots: true,
    rss: { enabled: false },
    sitemap: true,
    structuredData: true,
  },
  theme: {
    accent: { light: "#b45309", dark: "#ffa82d" },
    action: "#ffa82d",
    fonts: {
      body: "inter",
      display: "space-grotesk",
      mono: "jetbrains-mono",
    },
    mode: "system",
    radius: "md",
  },
});
