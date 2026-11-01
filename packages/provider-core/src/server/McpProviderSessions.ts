// @effect-diagnostics nodeBuiltinImport:off -- Pure synchronous hashing keeps page matching bounded without a runtime dependency.
import * as NodeCrypto from "node:crypto";
import type { ThreadId } from "@supaterm/contracts";
import type { HtmlRenderReference } from "@supaterm/shared/htmlRender";
import { stableStringify } from "@supaterm/shared/stableStringify";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";

import type { McpProviderSessionConfig } from "./mcpSession.ts";

// Other providers may never consume these references.
const MAX_KEPT_HTML_RENDERS = 64;

// Antigravity truncates long HTML arguments to a marked tail of at most 8,000 characters.
const BOUNDED_TEXT_MARKER = "[Earlier output truncated]\n\n";
const KEPT_HTML_END_LENGTH = 8_000;
const BOUNDED_SPEC_PREFIX = "[Spec sha256 ";
// A published spec nests about seven levels; deeper input cannot match one.
const MAX_SPEC_DEPTH = 16;

interface HtmlRenderInput {
  readonly html?: unknown;
  readonly spec?: unknown;
  readonly title?: unknown;
  readonly height?: unknown;
}

interface KeptHtmlRender {
  readonly title: string;
  readonly height: number;
  readonly htmlLength: number;
  readonly htmlHash: string | undefined;
  readonly htmlEnd: string;
  readonly specHash: string | undefined;
  readonly reference: HtmlRenderReference;
}

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

// Iterative, so provider input of any depth cannot overflow the stack before it is hashed.
const nestsDeeperThan = (value: unknown, limit: number) => {
  const pending: Array<readonly [unknown, number]> = [[value, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [current, depth] = next;
    if (depth > limit) return true;
    if (Predicate.isObject(current)) {
      for (const child of Object.values(current)) pending.push([child, depth + 1]);
    }
  }
  return false;
};

/** Key order is ignored: a provider may report the spec it sent with its keys reordered. */
export const htmlRenderSpecDigest = (spec: unknown) =>
  nestsDeeperThan(spec, MAX_SPEC_DEPTH) ? undefined : sha256(stableStringify(spec));

/** Stands in for a spec a provider's payload bounds would cut, keeping only what matching needs. */
export const htmlRenderSpecMarker = (digest: string) => `${BOUNDED_SPEC_PREFIX}${digest}]`;

const specHashOf = (spec: unknown) => {
  if (Predicate.isObject(spec)) return htmlRenderSpecDigest(spec);
  if (typeof spec === "string" && spec.startsWith(BOUNDED_SPEC_PREFIX) && spec.endsWith("]")) {
    return spec.slice(BOUNDED_SPEC_PREFIX.length, -1);
  }
  return undefined;
};

export class McpProviderSessions extends Context.Service<
  McpProviderSessions,
  {
    readonly set: (config: McpProviderSessionConfig) => Effect.Effect<void>;
    readonly read: (threadId: ThreadId) => Effect.Effect<McpProviderSessionConfig | undefined>;
    readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
    readonly recordHtmlRender: (
      threadId: ThreadId,
      input: {
        readonly html?: string | undefined;
        readonly spec?: unknown;
        readonly title: string;
        readonly height: number;
      },
      reference: HtmlRenderReference,
    ) => Effect.Effect<void>;
    // A reported attachment consumes that exact page; otherwise only unique input matches count.
    readonly takeHtmlRender: (
      threadId: ThreadId,
      input: HtmlRenderInput,
      reported?: HtmlRenderReference,
    ) => Effect.Effect<HtmlRenderReference | undefined>;
  }
>()("@supaterm/provider-core/server/McpProviderSessions") {}

const matchesHtml = (html: string) => {
  const htmlHash = sha256(html);
  const tail = html.startsWith(BOUNDED_TEXT_MARKER)
    ? html.slice(BOUNDED_TEXT_MARKER.length)
    : undefined;
  return (page: KeptHtmlRender) =>
    page.htmlHash === htmlHash ||
    (tail !== undefined &&
      tail.length > 0 &&
      tail.length < page.htmlLength &&
      page.htmlEnd.endsWith(tail));
};

const matchesSpec = (spec: unknown) => {
  const specHash = specHashOf(spec);
  return specHash === undefined ? undefined : (page: KeptHtmlRender) => page.specHash === specHash;
};

// A call with both sources was rejected, so it must not take a page published by another call.
const matchesSource = (input: HtmlRenderInput) => {
  if (input.html == null) return matchesSpec(input.spec);
  if (input.spec != null || typeof input.html !== "string" || input.html.length === 0) {
    return undefined;
  }
  return matchesHtml(input.html);
};

const matchingPageIndex = (kept: ReadonlyArray<KeptHtmlRender>, input: HtmlRenderInput): number => {
  const matches = matchesSource(input);
  if (matches === undefined) {
    return -1;
  }
  const height =
    typeof input.height === "string" && input.height.trim() !== ""
      ? Number(input.height)
      : input.height;
  const found = kept.flatMap((page, index) =>
    page.title === input.title && page.height === height && matches(page) ? [index] : [],
  );
  return found.length === 1 ? found[0]! : -1;
};

const make = Effect.gen(function* () {
  const sessions = yield* Ref.make(new Map<ThreadId, McpProviderSessionConfig>());
  const htmlRenders = yield* Ref.make(new Map<ThreadId, ReadonlyArray<KeptHtmlRender>>());
  return McpProviderSessions.of({
    set: Effect.fn("McpProviderSessions.set")(function* (config) {
      const current = yield* Ref.get(sessions);
      if (current.get(config.threadId)?.providerSessionId !== config.providerSessionId) {
        yield* Ref.update(htmlRenders, (kept) => {
          const next = new Map(kept);
          next.delete(config.threadId);
          return next;
        });
      }
      yield* Ref.update(sessions, (current) => new Map(current).set(config.threadId, config));
    }),
    read: Effect.fn("McpProviderSessions.read")(function (threadId) {
      return Ref.get(sessions).pipe(Effect.map((current) => current.get(threadId)));
    }),
    clear: Effect.fn("McpProviderSessions.clear")(function (threadId) {
      return Ref.update(sessions, (current) => {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      }).pipe(
        Effect.andThen(
          Ref.update(htmlRenders, (current) => {
            const next = new Map(current);
            next.delete(threadId);
            return next;
          }),
        ),
      );
    }),
    recordHtmlRender: Effect.fn("McpProviderSessions.recordHtmlRender")(
      function (threadId, input, reference) {
        return Ref.update(htmlRenders, (current) =>
          new Map(current).set(
            threadId,
            [
              ...(current.get(threadId) ?? []),
              {
                title: input.title,
                height: input.height,
                htmlLength: input.html?.length ?? 0,
                htmlHash: input.html === undefined ? undefined : sha256(input.html),
                // Copy the tail so its backing storage cannot retain the entire HTML string.
                htmlEnd: Buffer.from(
                  input.html?.slice(-KEPT_HTML_END_LENGTH) ?? "",
                  "utf16le",
                ).toString("utf16le"),
                specHash: input.html === undefined ? specHashOf(input.spec) : undefined,
                reference,
              },
            ].slice(-MAX_KEPT_HTML_RENDERS),
          ),
        );
      },
    ),
    takeHtmlRender: Effect.fn("McpProviderSessions.takeHtmlRender")(
      function (threadId, input, reported) {
        return Ref.modify(htmlRenders, (current) => {
          const kept = current.get(threadId) ?? [];
          const index =
            reported === undefined
              ? matchingPageIndex(kept, input)
              : kept.findIndex((page) => page.reference.attachmentId === reported.attachmentId);
          if (index === -1) {
            return [undefined, current];
          }
          const rest = kept.filter((_, keptIndex) => keptIndex !== index);
          const next = new Map(current);
          if (rest.length === 0) {
            next.delete(threadId);
          } else {
            next.set(threadId, rest);
          }
          return [kept[index]!.reference, next];
        });
      },
    ),
  });
});

export const layer = Layer.effect(McpProviderSessions, make);
