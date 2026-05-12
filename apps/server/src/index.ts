import * as path from "node:path";
import * as url from "node:url";
import dotenv from "dotenv";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { app } from "./app.js";
import { logger } from "./logger.js";
import { PORTS } from "@roguelike/shared";

app.listen(PORTS.server, "0.0.0.0", () => {
  logger.info(`Server running at http://0.0.0.0:${PORTS.server}`);
});
