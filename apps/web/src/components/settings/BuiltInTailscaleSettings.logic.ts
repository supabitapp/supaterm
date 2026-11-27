import { TailnetControlUrl, TailnetHostname } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

const decodeHostname = Schema.decodeUnknownOption(TailnetHostname);
const decodeControlUrl = Schema.decodeUnknownOption(TailnetControlUrl);

export function normalizeTailnetHostnameDraft(value: string): string {
  return value.toLowerCase().replace(/[\s_.]+/g, "-");
}

export function tailnetHostnameDraftError(
  draft: string,
  resolve: MessageResolver = m,
): string | null {
  if (draft.trim() === "") return resolve(msg("Enter a machine name."));
  return Option.isSome(decodeHostname(draft))
    ? null
    : resolve(
        msg(
          "Use up to 63 lowercase letters, numbers, and hyphens, starting and ending with a letter or number.",
        ),
      );
}

export function tailnetControlUrlDraftError(
  draft: string,
  resolve: MessageResolver = m,
): string | null {
  return Option.isSome(decodeControlUrl(draft))
    ? null
    : resolve(msg("Enter an http or https address without a user name or password."));
}

/** Null when the draft adds nothing: blank, or already allowed in any letter case. */
export function addAllowedTailnetLogin(
  allowed: ReadonlyArray<string>,
  draft: string,
): ReadonlyArray<string> | null {
  const login = draft.trim();
  if (login === "") return null;
  const key = login.toLowerCase();
  return allowed.some((existing) => existing.toLowerCase() === key) ? null : [...allowed, login];
}
