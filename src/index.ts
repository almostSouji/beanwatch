import * as z from "zod";
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
  processVariantVersions,
  postOrEditItem,
  postJournal,
} from "./functions.js";
import { ProductVariantRecordWithMessageId, ShopifyProduct } from "./model.js";

const rest = new REST({ version: "10" });
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const config = await loadConfig("../config.yml");

logger.info(`Loaded configuration for ${config.length} webhook.`);

const hooksPerCatalogue = new Map<string, string[]>();

for (const entry of config) {
  for (const catalogue of entry.catalogues) {
    const currentHooks = hooksPerCatalogue.get(catalogue) ?? [];
    currentHooks.push(entry.discord_webhook_id);
    hooksPerCatalogue.set(catalogue, currentHooks);
  }
}

const PAGE_SIZE = 250;

async function tick() {
  logger.info("Heartbeat");

  const productStore = new Map<string, z.output<typeof ShopifyProduct>[]>();

  for (const link of hooksPerCatalogue.keys()) {
    const shopProducts = new Map<number, z.output<typeof ShopifyProduct>>();

    let page = 1;

    while (page > 0) {
      const url = `${link}/products.json?limit=${PAGE_SIZE}&page=${page}`;

      logger.debug({ url, link, page }, "Shop fetching");

      const result = await fetchProducts(url);
      for (const resultEntry of result) {
        shopProducts.set(resultEntry.id, resultEntry);
      }

      if (result.length <= PAGE_SIZE) {
        page = 0;
      }
    }

    productStore.set(link, Array.from(shopProducts.values()));
  }

  for (const entry of config) {
    const knownRecords = await loadRecords(
      `../records/${entry.discord_webhook_id}.json`,
    );
    const entryVariants = new Map<
      string,
      z.output<typeof ProductVariantRecordWithMessageId>
    >();
    const hookBase =
      `/webhooks/${entry.discord_webhook_id}/${entry.discord_webhook_token}` as `/${string}`;

    logger.debug(
      `Known records loaded for ${entry.discord_webhook_id} (${knownRecords.size})`,
    );

    const variantKeys = new Set<string>();
    for (const link of entry.catalogues) {
      logger.info(`Getting catalogue for ${link}`);
      const catalogue = productStore.get(link);

      if (!catalogue) {
        logger.error({ link }, "Expected to find product catalogue");
        continue;
      }

      const filtered = filterRelevantVariants(
        catalogue,
        entry.discord_webhook_id,
        link,
        {
          titleAny: entry.title_any,
          vendorAny: entry.vendor_any,
        },
      );

      logger.debug(
        { total: catalogue.length, filtered: filtered.length },
        `Filtered shop ${link} for ${entry.discord_webhook_id}`,
      );

      for (const variant of filtered) {
        variantKeys.add(variant.key);

        const variantKnownRecord = knownRecords.get(variant.key);
        if (variantKnownRecord) {
          entryVariants.set(variant.key, {
            ...variant,
            messageId: variantKnownRecord?.messageId,
          });
        }

        const currentVariantState = processVariantVersions(
          link,
          variantKnownRecord,
          variant,
        );
        const noChange =
          !currentVariantState.availableChange &&
          !currentVariantState.priceChange;

        if (variantKnownRecord && noChange) {
          if (variantKnownRecord?.messageId) {
            const existingMessage = await rest
              .get(`${hookBase}/messages/${variantKnownRecord?.messageId}`, {
                auth: false,
              })
              .catch((err) => {
                logger.debug(err);
                return undefined;
              });

            if (!existingMessage) {
              const message = await postOrEditItem(
                rest,
                hookBase,
                currentVariantState.component,
              );
              entryVariants.set(variant.key, {
                ...variant,
                messageId: message.id,
              });
            }
          }

          continue;
        }

        if (variantKnownRecord && !variantKnownRecord.messageId) {
          throw new Error("Known variant without message association");
        }

        const message = await postOrEditItem(
          rest,
          hookBase,
          currentVariantState.component,
          variantKnownRecord?.messageId,
        );

        entryVariants.set(variant.key, { ...variant, messageId: message.id });

        const itemLink = `[${variant.name}](<${link}/products/${variant.handle}?variant=${variant.variantId}>)`;

        if (!variantKnownRecord) {
          await postJournal(
            rest,
            hookBase,
            entry.discord_thread_id,
            `New Item: ${itemLink}`,
          );
          continue;
        }

        if (currentVariantState.availableChange) {
          logger.debug(
            { change: currentVariantState.availableChange },
            `Availability change ${variant.handle}`,
          );

          if (currentVariantState.availableChange.after) {
            await postJournal(
              rest,
              hookBase,
              entry.discord_thread_id,
              `Item became available: ${itemLink}`,
            );
          } else if (currentVariantState.availableChange.before) {
            await postJournal(
              rest,
              hookBase,
              entry.discord_thread_id,
              `Item no longer available: ${itemLink}`,
            );
          }
        }

        if (currentVariantState.priceChange) {
          logger.debug(
            { change: currentVariantState.priceChange },
            `Price change ${variant.handle}`,
          );

          await postJournal(
            rest,
            hookBase,
            entry.discord_thread_id,
            `Price change: ${itemLink} ~~€${currentVariantState.priceChange.before}~~ **€${currentVariantState.priceChange.after}**`,
          );
        }
      }
    }

    for (const [key, value] of knownRecords.entries()) {
      if (!variantKeys.has(key)) {
        await rest
          .delete(`${hookBase}/messages/${value.messageId}`, { auth: false })
          .catch(() => {
            logger.info(
              `Hook message ${hookBase}/messages/${value.messageId} for record ${value.key} already deleted`,
            );
          });

        logger.debug(`Record ${value.key} no longer available in the shop.`);

        entryVariants.delete(value.key);
        await postJournal(
          rest,
          hookBase,
          entry.discord_thread_id,
          `Removed from shop: ${value.name}`,
        );
      }
    }

    logger.debug(
      `Writing store records ${entry.discord_webhook_id} (${entryVariants.size})`,
    );
    await saveRecords(
      `../records/${entry.discord_webhook_id}.json`,
      Array.from(entryVariants.values()),
      entry.discord_webhook_id,
    );
  }
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
