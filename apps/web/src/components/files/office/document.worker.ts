import { openWordDocument, pageSize } from "./word-document";
import type { WordMethods } from "./word-protocol";
import { serveWorker, Transfer } from "./worker-rpc";

const opened: { value: Awaited<ReturnType<typeof openWordDocument>> | undefined } = {
  value: undefined,
};

serveWorker<WordMethods>({
  open: async (input) => {
    if (opened.value) throw new Error("The worker already holds a document");

    const fonts = "fonts" in self ? (self.fonts as FontFaceSet) : undefined;
    const loaded = await openWordDocument(new Uint8Array(input.bytes), fonts);

    opened.value = loaded;

    return { pages: loaded.pages().map(pageSize), loading: loaded.loading() };
  },
  layout: () => required().step(),
  paint: async (input, signal) => {
    const painted = await required().paint(input.index, input.scale, input.ratio, signal);

    return painted ? new Transfer(painted, [painted.bitmap]) : undefined;
  },
  vectors: (input) => {
    required().vectors(input);

    return undefined;
  },
  build: (input) => {
    required().built(input.index);

    return undefined;
  },
  text: (input) => required().text(input.index),
  bookmark: (input) => required().target(input.name),
});

function required() {
  if (!opened.value) throw new Error("The worker holds no document");

  return opened.value;
}
