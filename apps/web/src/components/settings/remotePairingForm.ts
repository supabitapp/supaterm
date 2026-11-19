import { getPairingTokenFromUrl, readHostedPairingRequest } from "@supaterm/shared/remote";

export interface RemotePairingForm {
  readonly host: string;
  readonly pairingCode: string;
  readonly pairingUrl: string;
}

export const emptyRemotePairingForm: RemotePairingForm = {
  host: "",
  pairingCode: "",
  pairingUrl: "",
};

function parsePairingUrlFields(input: string, baseUrl: string): RemotePairingForm | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const urlLikeInput =
      /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u.test(trimmed) || trimmed.startsWith("//")
        ? trimmed
        : `https://${trimmed}`;
    const url = new URL(urlLikeInput, baseUrl);
    const hosted = readHostedPairingRequest(url);
    const pairingCode = hosted?.token ?? getPairingTokenFromUrl(url);
    return pairingCode
      ? {
          host: hosted?.host ?? url.origin,
          pairingCode,
          pairingUrl: url.toString(),
        }
      : null;
  } catch {
    return null;
  }
}

export function updateRemotePairingHost(
  form: RemotePairingForm,
  host: string,
  baseUrl: string,
): RemotePairingForm {
  return parsePairingUrlFields(host, baseUrl) ?? { ...form, host, pairingUrl: "" };
}

export function updateRemotePairingCode(
  form: RemotePairingForm,
  pairingCode: string,
): RemotePairingForm {
  return { ...form, pairingCode, pairingUrl: "" };
}

export function resolveRemotePairingForm(form: RemotePairingForm) {
  const host = form.host.trim();
  const pairingCode = form.pairingCode.trim();
  if (!host) throw new Error("Enter a backend host.");
  if (!pairingCode) throw new Error("Enter a pairing code.");
  return { host, pairingCode, ...(form.pairingUrl ? { pairingUrl: form.pairingUrl } : {}) };
}
