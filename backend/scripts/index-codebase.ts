// scripts/index-codebase.ts — CLI entrypoint for codebase indexing.

import { indexCodebase } from "../src/indexer/index-codebase.js";

const CODEBASE_PATH = process.env.CODEBASE_PATH;
if (!CODEBASE_PATH) {
  console.error("Error: CODEBASE_PATH env var is required");
  process.exit(1);
}

console.log("=== Code Indexer ===\n");
indexCodebase(CODEBASE_PATH)
  .then((r) => console.log(`Done! Indexed ${r.chunks} chunks from ${r.files} files.`))
  .catch((e) => {
    console.error("Code indexing failed:", e);
    process.exit(1);
  });
