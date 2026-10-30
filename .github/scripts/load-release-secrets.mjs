import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

const profiles = {
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
  mobile: ["EXPO_TOKEN"],
  apple: ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
  "app-store": ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
  "release-app": ["RELEASE_APP_ID", "RELEASE_APP_PRIVATE_KEY"],
  "release-notes": ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"],
};
const profile = process.env.RELEASE_SECRET_PROFILE;
const names = Object.hasOwn(profiles, profile ?? "") ? profiles[profile] : undefined;
if (!names || !process.env.GITHUB_ENV || !process.env.OP_SERVICE_ACCOUNT_TOKEN) {
  throw new Error("A release profile, GITHUB_ENV, and OP_SERVICE_ACCOUNT_TOKEN are required.");
}

let secrets;
try {
  secrets = JSON.parse(
    NodeChildProcess.execFileSync(
      "fnox",
      [
        "--config",
        ".github/fnox.toml",
        "--profile",
        profile,
        "--no-defaults",
        "--non-interactive",
        "--no-daemon",
        "--if-missing",
        "error",
        "export",
        "--format",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  ).secrets;
} catch {
  throw new Error("Could not resolve release credentials through fnox.");
}

for (const name of names) {
  if (typeof secrets?.[name] !== "string" || secrets[name].length === 0) {
    throw new Error(`Missing release credential: ${name}`);
  }
}

const mask = (value) =>
  process.stdout.write(
    `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`,
  );

for (const name of names) {
  const value = secrets[name];
  mask(value);
  // Network errors name a URL's bare host, which the whole-value mask does not cover.
  const url = URL.parse(value);
  if (url?.protocol === "https:" || url?.protocol === "http:") mask(url.host);
  const delimiter = `fnox_${NodeCrypto.randomUUID()}`;
  NodeFS.appendFileSync(process.env.GITHUB_ENV, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
