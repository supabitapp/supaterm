import type { SourceControlMediaRequest } from "@supaterm/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import { GITHUB_CREDENTIALED_MEDIA_HOSTS } from "../shared/gitHubMedia.ts";

import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubAppAccess from "./GitHubAppAccess.ts";

const isCredentialedHost = (url: string) => {
  try {
    return GITHUB_CREDENTIALED_MEDIA_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const mediaRepository = (url: string) => {
  const parsed = URL.parse(url);
  if (parsed === null) return null;
  const [, owner, repository, kind] = parsed.pathname.split("/");
  const repositoryFile =
    parsed.hostname === "raw.githubusercontent.com" ||
    parsed.hostname === "media.githubusercontent.com";
  const repositoryAsset =
    (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") && kind === "assets";
  return (repositoryFile || repositoryAsset) && owner && repository
    ? `${owner}/${repository}`
    : null;
};

const MAX_REDIRECTS = 3;
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };

export const make = Effect.gen(function* () {
  const policy = yield* GitHubRequestPolicy.GitHubRequestPolicy;
  const appAccess = yield* GitHubAppAccess.GitHubAppAccess;
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);

  return Effect.fn("GitHubMediaFetch.fetchMedia")(function* (request: SourceControlMediaRequest) {
    const repository = mediaRepository(request.url);
    const bearer = yield* (
      repository === null
        ? policy.credential("github.com")
        : appAccess.credentialFor("github.com", repository)
    ).pipe(
      Effect.map((credential) => credential.token),
      Effect.orElseSucceed(() => null),
    );
    let target = request.url;
    for (let hop = 0; ; hop += 1) {
      const authorization =
        bearer !== null && isCredentialedHost(target) ? `Bearer ${Redacted.value(bearer)}` : null;
      const response: HttpClientResponse.HttpClientResponse = yield* httpClient
        .execute(
          HttpClientRequest.get(target).pipe(
            HttpClientRequest.setHeaders({
              ...request.headers,

              "accept-encoding": "identity",
              ...(authorization === null ? {} : { authorization }),
            }),
          ),
        )
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400) return response;
      if (!location || hop >= MAX_REDIRECTS) return null;
      const next = new URL(location, target);
      if (next.protocol !== "https:") return null;
      target = next.toString();
    }
  });
});
