// scripts/index-codebase.ts — CLI entrypoint for codebase indexing.

import { getRepoConfigs } from "../src/config/env.js";
import { indexCodebase } from "../src/indexer/index-codebase.js";

const repos = getRepoConfigs();
if (repos.length === 0) {
  console.error(
    "Error: CODEBASE_REPOS env var is required. Format: name:path:branch",
  );
  process.exit(1);
}

console.log(
  `=== Code Indexer (${repos.length} repo${repos.length > 1 ? "s" : ""}) ===\n`,
);

for (const repo of repos) {
  console.log(
    `Indexing ${repo.name} (${repo.path}, branch: ${repo.branch})...`,
  );
  const r = await indexCodebase(repo.path, repo.name);
  console.log(`  Done: ${r.chunks} chunks from ${r.files} files.\n`);
}
