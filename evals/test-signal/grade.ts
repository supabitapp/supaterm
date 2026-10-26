export type Comment = { readonly path: string; readonly line: number; readonly body: string };

const testStart = /^\s*(it|test|describe)(\.\w+)*\(/;

                                                                                              
export const testRange = (source: string, title: string) => {
  const lines = source.split("\n");
  const start = lines.findIndex(
    (line) => line.includes(`"${title}"`) || line.includes(`'${title}'`),
  );
  if (start < 0) return undefined;
  const next = lines.findIndex((line, index) => index > start && testStart.test(line));
  return { start: start + 1, end: next < 0 ? lines.length : next };
};

                                                                                
const slack = 2;

   
                                                                                            
                                                                                 
   
export const grade = (input: {
  readonly kind: "bad" | "guard";
  readonly targets: ReadonlyArray<{
    readonly path: string;
    readonly start: number;
    readonly end: number;
  }>;
  readonly comments: ReadonlyArray<Comment>;
  readonly final: string;
}) => {
  if (input.kind === "guard") {
    if (input.comments.length > 0)
      return { pass: false, reason: `${input.comments.length} comment(s)` };
    if (input.final.trim() !== "All clear")
      return { pass: false, reason: "final reply is not `All clear`" };
    return { pass: true, reason: "all clear" };
  }
  const hit = input.comments.some((comment) =>
    input.targets.some(
      (target) =>
        comment.path === target.path &&
        comment.line >= target.start - slack &&
        comment.line <= target.end,
    ),
  );
  return hit
    ? { pass: true, reason: "flagged a target" }
    : { pass: false, reason: `missed (${input.comments.length} comment(s) elsewhere)` };
};
