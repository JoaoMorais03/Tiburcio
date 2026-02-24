// scripts/index-architecture.ts — CLI entrypoint for architecture + schema indexing.

import { join } from "node:path";
import { indexArchitecture } from "../src/indexer/index-architecture.js";

const standardsDir = join(process.cwd(), "..", "standards");

console.log("=== Architecture + Schema Indexer ===");
indexArchitecture(standardsDir)
  .then((r) => console.log(`Done! Architecture: ${r.archChunks} chunks, Schemas: ${r.schemaChunks} chunks.`))
  .catch((e) => {
    console.error("Indexing failed:", e);
    process.exit(1);
  });
