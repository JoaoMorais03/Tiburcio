// scripts/index-standards.ts — CLI entrypoint for standards indexing.

import { join } from "node:path";
import { indexStandards } from "../src/indexer/index-standards.js";

const standardsDir = join(process.cwd(), "..", "standards");

console.log("=== Standards Indexer ===\n");
indexStandards(standardsDir)
  .then((r) => console.log(`Done! Indexed ${r.chunks} chunks from ${r.files} files.`))
  .catch((e) => {
    console.error("Indexing failed:", e);
    process.exit(1);
  });
