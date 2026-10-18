const MINIMUM_ARTIFACT_LIFETIME_MS = 24 * 60 * 60 * 1000;

async function artifactIsReusable({ github, context, artifactId }) {
  try {
    const { data: artifact } = await github.rest.actions.getArtifact({
      ...context.repo,
      artifact_id: artifactId,
    });
    const remainingLifetimeMs = Date.parse(artifact.expires_at) - Date.now();
    return !artifact.expired && remainingLifetimeMs >= MINIMUM_ARTIFACT_LIFETIME_MS;
  } catch (error) {
    if (error.status === 404 || error.status === 410) return false;
    throw error;
  }
}

function environmentName(profile, platform) {
  if (!["production", "preview:dev"].includes(profile)) {
    throw new Error(`Unsupported mobile profile: ${profile}`);
  }
  if (!["ios", "android"].includes(platform)) {
    throw new Error(`Unsupported mobile platform: ${platform}`);
  }
  return `mobile-${profile.replace(":", "-")}-${platform}`;
}

async function findBuilds({ github, context, profile, platform, version, fingerprint }) {
  let versionBuild;
  let compatibleBuild;
  for await (const { data: deployments } of github.paginate.iterator(
    github.rest.repos.listDeployments,
    {
      ...context.repo,
      task: "mobile-build",
      environment: environmentName(profile, platform),
      per_page: 100,
    },
  )) {
    for (const deployment of deployments) {
      const payload = deployment.payload;
      if (
        !payload ||
        payload.schema !== 1 ||
        payload.profile !== profile ||
        payload.platform !== platform
      ) {
        continue;
      }
      const matchesVersion = payload.version === version;
      const matchesFingerprint = payload.fingerprint === fingerprint;
      const alreadyFoundVersion = !matchesVersion || versionBuild;
      const alreadyFoundCompatible = !matchesFingerprint || compatibleBuild;
      if (alreadyFoundVersion && alreadyFoundCompatible) continue;
      const { data: statuses } = await github.rest.repos.listDeploymentStatuses({
        ...context.repo,
        deployment_id: deployment.id,
        per_page: 1,
      });
      if (statuses[0]?.state !== "success") continue;
      if (
        payload.artifactId !== undefined &&
        !(await artifactIsReusable({ github, context, artifactId: payload.artifactId }))
      ) {
        continue;
      }
      if (matchesVersion && !versionBuild) versionBuild = payload;
      if (matchesFingerprint && !compatibleBuild) compatibleBuild = payload;
      if (versionBuild && compatibleBuild) return { versionBuild, compatibleBuild };
    }
  }
  return { versionBuild, compatibleBuild };
}

async function recordBuild({
  github,
  context,
  profile,
  platform,
  version,
  fingerprint,
  sha,
  url,
  artifactId,
}) {
  if (!/^[a-f0-9]{40,64}$/.test(fingerprint) || !version) {
    throw new Error("A completed mobile build requires its version and embedded fingerprint");
  }
  if (artifactId !== undefined && (!Number.isSafeInteger(artifactId) || artifactId < 1)) {
    throw new Error("A preview artifact requires a valid GitHub artifact ID");
  }
  const environment = environmentName(profile, platform);
  const { data: deployment } = await github.rest.repos.createDeployment({
    ...context.repo,
    ref: sha,
    task: "mobile-build",
    environment,
    auto_merge: false,
    required_contexts: [],
    transient_environment: profile === "preview:dev",
    production_environment: profile === "production",
    payload: {
      schema: 1,
      profile,
      platform,
      version,
      fingerprint,
      url,
      artifactId,
    },
    description: `Signed ${platform} build ${version}`,
  });
  if (!deployment.id) throw new Error("GitHub did not create a mobile build deployment");
  await github.rest.repos.createDeploymentStatus({
    ...context.repo,
    deployment_id: deployment.id,
    state: "success",
    auto_inactive: false,
    environment_url: url,
    log_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
  });
}

module.exports = { findBuilds, recordBuild };
