import { REST } from "@discordjs/rest";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { logger } from "./logger.js";
import { loadConfig } from "./functions.js";
import { tick } from "./handling.js";
import { fileURLToPath } from "node:url";

const rest = new REST({ version: "10" });
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const config = await loadConfig(fileURLToPath(new URL("../config.yml", import.meta.url)));

logger.info(`Loaded configuration for ${config.length} webhook.`);

const INTERVAL_SECONDS = 600 as const;

function noiseBetween(minMs: number, maxMs: number) {
  return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

await tick(rest, config);

const DEBUG_EXIT_AFTER_FIRST_TICK = false;
if (DEBUG_EXIT_AFTER_FIRST_TICK) {
  process.exit(0);
}

while (true) {
  await setTimeout(INTERVAL_SECONDS * 1000 + noiseBetween(1_000, 10_000));
  await tick(rest, config);
}
