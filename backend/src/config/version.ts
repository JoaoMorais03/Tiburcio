// config/version.ts — Single source of truth for the application version.
// Reads from package.json so version only needs updating in one place.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const VERSION = pkg.version;
