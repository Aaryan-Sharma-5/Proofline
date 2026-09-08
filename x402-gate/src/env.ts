import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "..", "..", ".env") });
