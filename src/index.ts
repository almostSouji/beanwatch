import { REST } from "@discordjs/rest";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { logger } from "./logger.js";
import {
  fetchProducts,
  loadConfig,
  loadRecords,
  filterRelevantVariants,
  saveRecords,
  formatProductbase,
  executeDiscordWebhooks,
  Colors,
  productChanges,
} from "./functions.js";
import { ComponentType } from "discord-api-types/v10";

const rest = new REST({ version: "10" });
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const config = await loadConfig("../config.yml");

logger.info(`Loaded configuration for ${config.length} webhook.`);

async function tick() {
  logger.info("Heartbeat");
  const knownRecord = await loadRecords();
  const products = await fetchProducts();
  logger.info(`Fetched ${products.length} products.`);

  if (products.length == 250) {
    logger.warn("Observed maximum page size, may be missing products!");
  }

  const relevantVariants = filterRelevantVariants(products);
  const variantKeys = new Set<string>();

  for (const variant of relevantVariants) {
    variantKeys.add(variant.key);

    const knownProduct = knownRecord.get(variant.key);

    const base = formatProductbase(variant, knownProduct ? undefined : "🆕");

    if (!knownProduct) {
      logger.debug(variant, `Unknown product ${variant.key}`);
      await executeDiscordWebhooks(
        config,
        [base],
        rest,
        variant.available ? Colors.Available : Colors.Deleted,
      );

      continue;
    }

    const change = productChanges(knownProduct, variant);

    if (!change.lines.length) {
      continue;
    }

    await executeDiscordWebhooks(
      config,
      [
        base,
        {
          type: ComponentType.TextDisplay,
          content: change.lines.join("\n"),
        },
      ],
      rest,
      change.color,
    );

    continue;
  }

  for (const record of knownRecord.values()) {
    if (!variantKeys.has(record.key)) {
      await executeDiscordWebhooks(config, [formatProductbase(record)], rest, Colors.Deleted);
      continue;
    }
  }

  await saveRecords(relevantVariants);
}

const INTERVAL_SECONDS = 600 as const;

function noiseBetween(minMs: number, maxMs: number) {
  return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

await tick();

const DEBUG_EXIT_AFTER_FIRST_TICK = false;
if (DEBUG_EXIT_AFTER_FIRST_TICK) {
  process.exit(0);
}

while (true) {
  await setTimeout(INTERVAL_SECONDS * 1000 + noiseBetween(1_000, 10_000));
  await tick();
}
