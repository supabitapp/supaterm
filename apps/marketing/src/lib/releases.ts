const REPO = "supabitapp/supaterm";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const NIGHTLY_RELEASES_URL = `${RELEASES_URL}?q=nightly&expanded=true`;

const LATEST_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LIST_API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;

export type ReleaseChannel = "stable" | "nightly";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

function cacheKey(channel: ReleaseChannel) {
  return `supaterm-${channel}-release`;
}

function fetchJson<T>(url: string): Promise<T>;
async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
  return response.json();
}

function fetchStable(): Promise<Release>;
async function fetchStable() {
  return fetchJson<Release>(LATEST_API_URL);
}

function fetchNightly(): Promise<Release>;
async function fetchNightly() {
  const list = await fetchJson<Release[]>(LIST_API_URL);
  const nightly = Array.isArray(list)
    ? list.find((release) => release.tag_name?.includes("-nightly."))
    : undefined;
  if (!nightly) throw new Error("No nightly release in the latest page");
  return nightly satisfies Release;
}

export function fetchLatestRelease(channel?: ReleaseChannel): Promise<Release>;
export async function fetchLatestRelease(channel: ReleaseChannel = "stable") {
  const key = cacheKey(channel);
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached) satisfies Release;

  const data = channel === "nightly" ? await fetchNightly() : await fetchStable();

  if (data?.assets) {
    sessionStorage.setItem(key, JSON.stringify(data));
  }

  return data satisfies Release;
}
