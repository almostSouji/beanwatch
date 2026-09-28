import type { REST } from "@discordjs/rest";
import {
  APIActionRowComponent,
  APIButtonComponent,
  APIContainerComponent,
  APIMessage,
  APIMessageTopLevelComponent,
  APISectionComponent,
  APITextDisplayComponent,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord-api-types/v10";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  Config,
  PreparedProductVairantRecords,
  PreparedProductVariantRecord,
  ProductVariantRecordsWithMessageId,
  ProductVariantRecordWithMessageId,
  ShopifyProduct,
  ShopifyResult,
} from "./model.js";
import * as z from "zod";
import { writeFileSync } from "node:fs";
import { logger } from "./logger.js";

export async function postOrEditItem(
  rest: REST,
  hookBase: string,
  components: APIMessageTopLevelComponent[],
  messageId?: string,
) {
  const body = {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] },
    components,
  };
  try {
    if (messageId) {
      const url = `/${hookBase}/messages/${messageId}?with_components=true` as `/${string}`;
      return (await rest.patch(url, { body, auth: false })) as APIMessage;
    }
  } catch {}

  const url = `/${hookBase}?wait=true&with_components=true` as `/${string}`;
  return (await rest.post(url, { body, auth: false })) as APIMessage;
}

export async function postJournal(
  rest: REST,
  hookBase: string,
  journalThreadId: string,
  content: string,
) {
  const body = {
    content,
    allowed_mentions: { parse: [] },
  };

  await rest.post(`/${hookBase}?wait=true&thread_id=${journalThreadId}`, {
    auth: false,
    body,
  });
}

export async function loadConfig(path: string) {
  const configYaml = await readFile(fileURLToPath(new URL(path, import.meta.url)));
  const configObject = parse(configYaml.toString());

  return Config.parse(configObject);
}

export async function fetchProducts(link: string) {
  const res = await fetch(link).then((r) => r.json());
  return ShopifyResult.parse(res)?.products;
}

export function filterRelevantVariants(
  products: z.output<typeof ShopifyProduct>[],
  webhookId: string,
  shopBase: string,
  {
    titleAny,
    vendorAny,
  }: {
    titleAny?: string[];
    vendorAny?: string[];
  },
) {
  const relevant: z.output<typeof PreparedProductVairantRecords> = [];
  logger.debug({ titleAny, vendorAny }, `Filtering ${shopBase} for ${webhookId}`);

  for (const product of products) {
    const lowerTitle = product.title.toLowerCase();
    const lowerVendor = product.vendor.toLowerCase();

    const titleAnyConditionMet = titleAny?.some((phrase) =>
      lowerTitle.includes(phrase.toLowerCase()),
    );
    const vendorAnyConditionMet = vendorAny?.some((phrase) =>
      lowerVendor.includes(phrase.toLowerCase()),
    );

    if (titleAnyConditionMet || vendorAnyConditionMet) {
      for (const variant of product.variants) {
        const key = `${product.id}:${variant.id}`;
        const name =
          variant.title === "Default Title" ? product.title : `${product.title} - ${variant.title}`;
        const image = variant.featured_image?.src ?? product.images?.[0]?.src;

        const variantCreatedAt = new Date(variant.created_at);
        const variantUpdatedAt = variant.updated_at ? new Date(variant.updated_at) : undefined;

        relevant.push({
          key,
          price: Number(variant.price),
          available: variant.available,
          name,
          image,
          productId: product.id,
          variantId: variant.id,
          handle: product.handle,
          createdTimestamp: variantCreatedAt.getTime(),
          updatedTimestamp: variantUpdatedAt?.getTime(),
          hookId: webhookId,
          shopBase,
          vendor: product.vendor,
        });
      }
    }
  }

  return relevant;
}

export function buildVariantMap(variants: z.output<typeof PreparedProductVairantRecords>) {
  const map = new Map<string, z.output<typeof PreparedProductVariantRecord>>();

  for (const variant of variants) {
    map.set(variant.key, variant);
  }

  return map;
}

export async function saveRecords(
  recordPath: string,
  variants: z.output<typeof ProductVariantRecordsWithMessageId>,
  hookId: string,
) {
  const path = fileURLToPath(new URL(recordPath, import.meta.url));
  const stringVariants = JSON.stringify(variants.map((variant) => ({ ...variant, hookId })));

  writeFileSync(path, stringVariants);
}

export async function loadRecords(recordPath: string) {
  const map = new Map<string, z.output<typeof ProductVariantRecordWithMessageId>>();
  try {
    const res = await readFile(new URL(recordPath, import.meta.url));
    const records = ProductVariantRecordsWithMessageId.parse(JSON.parse(res.toString()));

    for (const record of records) {
      map.set(record.key, record);
    }

    return map;
  } catch (_error) {
    const error = _error as Error;
    logger.debug(error, `Error while trying to load records, assuming empty.`);
    return map;
  }
}

function formatDiscordTimestamp(ms: number) {
  return `<t:${Math.floor(ms / 1_000)}:F>`;
}

export function processVariantVersions(
  linkBaseUrl: string,
  productBefore?: z.output<typeof PreparedProductVariantRecord>,
  productAfter?: z.output<typeof PreparedProductVariantRecord>,
) {
  const newestVersion = productAfter ?? productBefore;
  if (!newestVersion) {
    throw new Error(
      `Expected to find either productBefore (${Boolean(productBefore)}) or productAfter (${Boolean(productAfter)}) but found none.`,
    );
  }

  const detailLines = [
    `Vendor: ${newestVersion.vendor}`,
    `Price: €${newestVersion.price}`,
    `Created: ${formatDiscordTimestamp(newestVersion.createdTimestamp)}`,
  ];

  if (newestVersion.updatedTimestamp) {
    detailLines.push(`Updated: ${formatDiscordTimestamp(newestVersion.updatedTimestamp)}`);
  }

  const display = newestVersion.image
    ? ({
        type: ComponentType.Section,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `### ${newestVersion.name}`,
          },
          {
            type: ComponentType.TextDisplay,
            content: detailLines.join("\n"),
          },
        ],
        accessory: {
          type: ComponentType.Thumbnail,
          media: {
            url: newestVersion.image,
          },
        },
      } satisfies APISectionComponent)
    : ({
        type: ComponentType.TextDisplay,
        content: [`### ${newestVersion.name}`, ...detailLines].join("\n"),
      } satisfies APITextDisplayComponent);

  return {
    component: [
      {
        type: ComponentType.Container,
        components: [
          display,
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                url: `${linkBaseUrl}/products/${newestVersion.handle}?variant=${newestVersion.variantId}`,
                label: "Shop",
              } satisfies APIButtonComponent,
            ],
          } satisfies APIActionRowComponent<APIButtonComponent>,
        ],
        accent_color: newestVersion.available ? 0x3ba55d : undefined,
      } satisfies APIContainerComponent,
    ],
    priceChange:
      productBefore && productAfter && productBefore.price !== productAfter.price
        ? {
            before: productBefore.price,
            after: productAfter.price,
          }
        : null,
    availableChange:
      productBefore && productAfter && productBefore.available !== productAfter.available
        ? {
            before: Boolean(productBefore.available),
            after: Boolean(productAfter.available),
          }
        : null,
  };
}
