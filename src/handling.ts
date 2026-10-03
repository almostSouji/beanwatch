import * as z from "zod";
import {
  Config,
  ConfigEntry,
  ProductFilters,
  ProductMap,
  ProductRecords,
  ProductVariantWithIdMap,
  ProductVariantRecordWithMessageId,
  ShopProductMap,
} from "./model.js";
import {
  fetchProducts,
  filterRelevantVariants,
  loadRecords,
  postJournal,
  postOrEditItem,
  processVariantVersions,
  saveRecords,
} from "./functions.js";
import { REST } from "@discordjs/rest";
import { APIMessage, APIMessageTopLevelComponent } from "discord-api-types/v10";

const PAGE_SIZE = 250 as const;

async function fetchAllProducts(config: z.output<typeof Config>): Promise<ShopProductMap> {
  const allProducts = new Map<string, ProductMap>();
  const shopUrls = new Set(config.flatMap((entry) => entry.catalogues));
  for (const link of shopUrls) {
    const shopProducts = await fetchProducts(link, PAGE_SIZE);
    allProducts.set(link, shopProducts);
  }

  return allProducts;
}

async function cleanupRemovedProducts(
  discordRest: REST,
  hookBase: `/${string}`,
  discordThreadId: string,
  knownRecords: ProductRecords,
  observedVariantKeys: Set<string>,
) {
  const removedKeys = new Set<string>();
  for (const [key, value] of knownRecords.entries()) {
    if (observedVariantKeys.has(key)) {
      continue;
    }

    await discordRest.delete(`${hookBase}/messages/${value.messageId}`, {
      auth: false,
    });
    removedKeys.add(key);

    await postJournal(discordRest, hookBase, discordThreadId, `No longer tracking: ${value.name}`);
  }

  return removedKeys;
}

async function ensureMessage(
  discordRest: REST,
  hookBase: `/${string}`,
  messageId: string,
  component: APIMessageTopLevelComponent[],
) {
  const existingMessage = (await discordRest.get(`${hookBase}/messages/${messageId}`, {
    auth: false,
  })) as APIMessage;

  if (!existingMessage) {
    return await postOrEditItem(discordRest, hookBase, component);
  }

  return existingMessage;
}

async function processJournal(
  discordRest: REST,
  hookBase: `/${string}`,
  threadId: string,
  comparisonState: ReturnType<typeof processVariantVersions>,
  knownRecord?: z.output<typeof ProductVariantRecordWithMessageId>,
) {
  if (!knownRecord) {
    return await postJournal(
      discordRest,
      hookBase,
      threadId,
      `New Item: ${comparisonState.productVariantLink}`,
    );
  }

  if (comparisonState.availableChange) {
    if (comparisonState.availableChange.after) {
      await postJournal(
        discordRest,
        hookBase,
        threadId,
        `Item became available: ${comparisonState.productVariantLink}`,
      );
    } else if (comparisonState.availableChange.before) {
      await postJournal(
        discordRest,
        hookBase,
        threadId,
        `Item became unavailable: ${comparisonState.productVariantLink}`,
      );
    }
  }

  if (comparisonState.priceChange) {
    await postJournal(
      discordRest,
      hookBase,
      threadId,
      `Price change: ${comparisonState.productVariantLink} ~~€${comparisonState.priceChange.before}~~ **€${comparisonState.priceChange.after}**`,
    );
  }
}

async function processCatalogue(
  discordRest: REST,
  allProducts: ShopProductMap,
  knownRecords: Map<string, z.output<typeof ProductVariantRecordWithMessageId>>,
  configEntry: z.output<typeof ConfigEntry>,
  shopBase: string,
  webhookId: string,
  hookBase: `/${string}`,
  productFilters: ProductFilters,
) {
  const recordedVariants: ProductVariantWithIdMap = new Map();
  const catalogueProducts: ProductMap = allProducts.get(shopBase) ?? new Map();
  const filtered = filterRelevantVariants(catalogueProducts, webhookId, shopBase, productFilters);

  for (const [key, value] of filtered.entries()) {
    const knownRecord = knownRecords.get(key);
    const comparisonState = processVariantVersions(shopBase, knownRecord, value);
    const noChange = !comparisonState.availableChange && !comparisonState.priceChange;

    if (knownRecord && noChange) {
      const message = await ensureMessage(
        discordRest,
        hookBase,
        knownRecord.messageId,
        comparisonState.component,
      );

      recordedVariants.set(key, {
        ...value,
        messageId: message.id,
      });

      continue;
    }

    const message = await postOrEditItem(
      discordRest,
      hookBase,
      comparisonState.component,
      knownRecord?.messageId,
    );

    recordedVariants.set(key, {
      ...value,
      messageId: message.id,
    });

    await processJournal(
      discordRest,
      hookBase,
      configEntry.discord_thread_id,
      comparisonState,
      knownRecord,
    );
  }

  return recordedVariants;
}

async function processConfigEntry(
  discordRest: REST,
  allProducts: ShopProductMap,
  entry: z.output<typeof ConfigEntry>,
) {
  const hookBase =
    `/webhooks/${entry.discord_webhook_id}/${entry.discord_webhook_token}` as `/${string}`;

  const knownRecords = await loadRecords(entry.discord_webhook_id);
  const observedVariantKeys = new Set<string>();

  for (const link of entry.catalogues) {
    const processedVariants = await processCatalogue(
      discordRest,
      allProducts,
      knownRecords,
      entry,
      link,
      entry.discord_webhook_id,
      hookBase,
      entry,
    );

    processedVariants.forEach((variant) => {
      observedVariantKeys.add(variant.key);
      knownRecords.set(variant.key, variant);
    });
  }

  const removedKeys = await cleanupRemovedProducts(
    discordRest,
    hookBase,
    entry.discord_thread_id,
    knownRecords,
    observedVariantKeys,
  );

  removedKeys.forEach((key) => knownRecords.delete(key));
  await saveRecords(knownRecords, entry.discord_webhook_id);
}

export async function tick(discordRest: REST, config: z.output<typeof Config>) {
  const products = await fetchAllProducts(config);

  for (const entry of config) {
    await processConfigEntry(discordRest, products, entry);
  }
}
