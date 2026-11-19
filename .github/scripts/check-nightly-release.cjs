function repositoryDefaultBranch(context) {
  const branch = context.payload.repository?.default_branch;
  if (!branch) {
    throw new Error("GitHub did not provide the repository default branch.");
  }
  return branch;
}

async function assertCommitOnDefaultBranch({ github, context, sha }) {
  const defaultBranch = repositoryDefaultBranch(context);
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    ...context.repo,
    basehead: `${sha}...${defaultBranch}`,
    per_page: 1,
  });
  if (comparison.status !== "ahead" && comparison.status !== "identical") {
    throw new Error(
      `Release commit ${sha} is not contained in ${defaultBranch} (${comparison.status}).`,
    );
  }
}

async function assertReleaseSource({ github, context, releaseChannel }) {
  if (releaseChannel === "preview") return;
  if (releaseChannel !== "stable" && releaseChannel !== "nightly") {
    throw new Error(`Unsupported release channel: ${releaseChannel}`);
  }

  const defaultBranch = repositoryDefaultBranch(context);
  if (context.eventName === "workflow_dispatch" && context.ref !== `refs/heads/${defaultBranch}`) {
    throw new Error(
      `${releaseChannel} releases must be dispatched from ${defaultBranch}; selected ${context.ref}. Use the preview channel for branch builds.`,
    );
  }

  await assertCommitOnDefaultBranch({ github, context, sha: context.sha });
}

const isNightlyTag = (tag) => /^v.*-nightly\./.test(tag);

const RELEASES_QUERY = `
  query ($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      releases(first: 100, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { tagName isDraft publishedAt }
      }
    }
  }
`;

async function findLatestNightly({ github, context, isDone = () => false }) {
  let latest;
  let cursor = null;
  do {
    const { repository } = await github.graphql(RELEASES_QUERY, { ...context.repo, cursor });
    const { nodes, pageInfo } = repository.releases;
    for (const release of nodes) {
      if (release.isDraft || !release.publishedAt || !isNightlyTag(release.tagName)) continue;
      if (!latest || Date.parse(release.publishedAt) > Date.parse(latest.publishedAt)) {
        latest = release;
      }
    }
    if (latest && isDone(latest)) return latest;
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);
  return latest;
}

async function shouldReleaseNightly({ github, context, core }) {
  const lastNightly = await findLatestNightly({ github, context });

  if (!lastNightly) {
    core.info("No published nightly found. Proceeding with release.");
    return true;
  }

  const tag = lastNightly.tagName;
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    ...context.repo,
    basehead: `${tag}...${context.sha}`,
    per_page: 1,
  });
  if (comparison.status !== "ahead") {
    core.info(`Candidate commit is ${comparison.status} relative to ${tag}. Skipping.`);
    return false;
  }

  core.info(`New commits since ${tag}. Proceeding with release.`);
  return true;
}

async function resolveLatestNightlyCommit({ github, context, core }) {
  const lastNightly = await findLatestNightly({ github, context });
  if (!lastNightly) {
    throw new Error("No published nightly found. Stable releases build the latest nightly commit.");
  }

  const tag = lastNightly.tagName;
  const { data: commit } = await github.rest.repos.getCommit({ ...context.repo, ref: tag });
  const version = /^(?:nightly-)?v(\d+\.\d+\.\d+)-nightly\./.exec(tag)?.[1];
  if (!version) {
    throw new Error(`Cannot derive a stable version from nightly tag ${tag}.`);
  }

  core.info(`Latest nightly ${tag} shipped ${commit.sha} as a preview of ${version}.`);
  return { tag, sha: commit.sha, version };
}

async function readNightlyUpdateFeed({ github, context, fetch = globalThis.fetch }) {
  const latest = await findLatestNightly({ github, context });
  if (!latest) return {};

  const base = `https://github.com/${context.repo.owner}/${context.repo.repo}`;
  const signal = () => AbortSignal.timeout(30_000);
  const pointer = await fetch(`${base}/releases/download/update-feed/nightly.json`, {
    signal: signal(),
  });
  if (!pointer.ok && pointer.status !== 404) {
    throw new Error(`The update-feed pointer answered HTTP ${pointer.status}.`);
  }
  let pointerTag;
  if (pointer.ok) {
    const body = await pointer.text();
    try {
      pointerTag = JSON.parse(body)?.tag_name;
    } catch {}
  }

  let feedTags;
  try {
    const feed = await fetch(`${base}/releases.atom`, { signal: signal() });
    const body = feed.ok ? await feed.text() : "";
    if (/<feed[\s>]/.test(body)) {
      feedTags = Array.from(body.matchAll(/href="[^"]*\/releases\/tag\/([^"]+)"/g), (match) =>
        decodeURIComponent(match[1]),
      );
    }
  } catch {}
  const feedNightly = feedTags?.find((tag) => /^v?\d+\.\d+\.\d+-nightly\./.test(tag));

  return { tag: latest.tagName, pointerTag, feedNightly, feedTags };
}

module.exports = {
  assertCommitOnDefaultBranch,
  assertReleaseSource,
  shouldReleaseNightly,
  resolveLatestNightlyCommit,
  readNightlyUpdateFeed,
};
