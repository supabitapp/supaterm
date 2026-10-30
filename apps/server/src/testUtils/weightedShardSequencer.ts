// @effect-diagnostics nodeBuiltinImport:off - vitest loads this sequencer from the config,
// outside any Effect runtime, and only needs path.relative.
import * as NodePath from "node:path";

import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

import shardWeights from "./shardWeights.json" with { type: "json" };

const FILE_OVERHEAD_SECONDS = 0.5;

const recordedSeconds: Readonly<Record<string, number>> = shardWeights;

// Every shard must derive the same assignment from the same file list.
// Put the longest files on the lightest shard; equal file counts skew runtimes.
export class WeightedShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
    const weighted = files
      .map((spec) => {
        const key = NodePath.relative(this.ctx.config.root, spec.moduleId).replaceAll("\\", "/");
        return { spec, key, seconds: (recordedSeconds[key] ?? 0) + FILE_OVERHEAD_SECONDS };
      })
      .toSorted((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const loads = Array.from({ length: count }, () => 0);
    const picked: TestSpecification[] = [];
    for (const file of weighted) {
      const least = Math.min(...loads);
      const lightest = loads.indexOf(least);
      loads[lightest] = least + file.seconds;
      if (lightest === index - 1) picked.push(file.spec);
    }
    return picked;
  }
}
