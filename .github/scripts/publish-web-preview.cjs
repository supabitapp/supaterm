const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

async function reconcilePreview({ headSha, readPull, deploy, remove }) {
  const pull = readPull();
  if (pull.state !== "OPEN") {
    await remove();
    return "removed";
  }
  if (!headSha || pull.headRefOid !== headSha) return;
  await deploy();
  const current = readPull();
  if (current.state !== "OPEN") {
    await remove();
    return "removed";
  }
  if (current.headRefOid === headSha) return "deployed";
}

async function removePreview({ accountId, name, token, request = fetch }) {
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${name}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Preview removal failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error("Cloudflare rejected preview removal");
}

async function main() {
  const prNumber = process.env.PR_NUMBER;
  if (!/^[1-9]\d*$/.test(prNumber ?? "")) throw new Error("Invalid PR number");
  const origin = `https://preview-${prNumber}.supaterm.com`;
  const name = `supaterm-web-preview-${prNumber}`;
  const config = JSON.parse(fs.readFileSync("apps/web/cloudflare/latest.json", "utf8"));
  const previewConfig = {
    account_id: config.account_id,
    compatibility_date: config.compatibility_date,
    name,
    workers_dev: false,
    preview_urls: false,
    assets: {
      directory: path.join(process.env.RUNNER_TEMP, "web-assets"),
      not_found_handling: "single-page-application",
    },
    routes: [{ pattern: new URL(origin).hostname, custom_domain: true }],
  };
  const configPath = path.join(process.env.RUNNER_TEMP, "web-preview.json");
  fs.writeFileSync(configPath, JSON.stringify(previewConfig));
  const result = await reconcilePreview({
    headSha: process.env.HEAD_SHA,
    readPull: () =>
      JSON.parse(
        execFileSync(
          "gh",
          [
            "pr",
            "view",
            prNumber,
            "--repo",
            process.env.GITHUB_REPOSITORY,
            "--json",
            "state,headRefOid",
          ],
          { encoding: "utf8" },
        ),
      ),
    deploy: () =>
      execFileSync("vp", ["dlx", "wrangler@4.147.0", "deploy", "--config", configPath], {
        stdio: "inherit",
      }),
    remove: () =>
      removePreview({
        accountId: config.account_id,
        name,
        token: process.env.CLOUDFLARE_API_TOKEN,
      }),
  });
  if (result) fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
  if (result === "deployed")
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `deployment_url=${origin}\n`);
}

module.exports = { reconcilePreview, removePreview };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
