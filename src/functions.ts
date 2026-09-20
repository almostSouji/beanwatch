import type { REST } from "@discordjs/rest";
import {
  APIComponentInContainer,
  APISectionComponent,
  ComponentType,
  MessageFlags,
} from "discord-api-types/v10";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  Config,
  ProductVairantRecords,
  ProductVariantRecord,
  ShopifyProduct,
  ShopifyResult,
} from "./model.js";
import * as z from "zod";
import { writeFileSync } from "node:fs";
import { logger } from "./logger.js";

export async function executeDiscordWebhook(
  components: APIComponentInContainer[],
  {
    username,
    avatarUrl,
    discordRest,
    hookBase,
    mentionRoleId,
    containerColor,
  }: {
    username: string;
    avatarUrl?: string;
    discordRest: REST;
    hookBase: string;
    mentionRoleId?: string;
    containerColor?: number;
  },
) {
  await discordRest.post(`/${hookBase}?wait=true&with_components=true`, {
    auth: false,
    body: {
      username,
      avatar_url: avatarUrl,
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: mentionRoleId ? { roles: [mentionRoleId] } : { parse: [] },
      components: [
        {
          type: ComponentType.Container,
          components,
          accent_color: containerColor,
        },
      ],
    },
  });
}

export async function executeDiscordWebhooks(
  config: z.output<typeof Config>,
  components: APIComponentInContainer[],
  rest: REST,
  color?: number,
) {
  for (const entry of config) {
    await executeDiscordWebhook(components, {
      username: "Beanwatch",
      hookBase: `webhooks/${entry.discord_webhook_id}/${entry.discord_webhook_token}`,
      mentionRoleId: entry.discord_notification_role_id ?? undefined,
      discordRest: rest,
      containerColor: color,
    });
  }
}

export async function loadConfig(path: string) {
  const configYaml = await readFile(fileURLToPath(new URL(path, import.meta.url)));
  const configObject = parse(configYaml.toString());

  return Config.parse(configObject);
}

export async function fetchProducts() {
  const res = await fetch("https://bossmonsta.com/products.json?limit=250").then((r) => r.json());
  return ShopifyResult.parse(res)?.products;
}

export function filterRelevantVariants(products: z.output<typeof ShopifyProduct>[]) {
  const relevant: z.output<typeof ProductVairantRecords> = [];
  for (const product of products) {
    const lowerTitle = product.title.toLowerCase();
    if (
      ["protogen", "protobean", "proto bean"].some(
        (phrase) => lowerTitle.includes(phrase) && lowerTitle.includes("plushie"),
      )
    ) {
      for (const variant of product.variants) {
        const key = `${product.id}:${variant.id}`;
        const name =
          variant.title === "Default Title" ? product.title : `${product.title} - ${variant.title}`;
        const image = variant.featured_image?.src ?? product.images[0].src;

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
        });
      }
    }
  }

  return relevant;
}

export function buildVariantMap(variants: z.output<typeof ProductVairantRecords>) {
  const map = new Map<string, z.output<typeof ProductVariantRecord>>();

  for (const variant of variants) {
    map.set(variant.key, variant);
  }

  return map;
}

const PRODUCT_PATH = "../products.json";

export async function saveRecords(variants: z.output<typeof ProductVariantRecord>[]) {
  const path = fileURLToPath(new URL(PRODUCT_PATH, import.meta.url));
  const stringVariants = JSON.stringify(variants);

  writeFileSync(path, stringVariants);
}

export async function loadRecords() {
  const map = new Map<string, z.output<typeof ProductVariantRecord>>();
  try {
    const res = await readFile(new URL(PRODUCT_PATH, import.meta.url));
    const records = ProductVairantRecords.parse(JSON.parse(res.toString()));

    for (const record of records) {
      map.set(record.key, record);
    }

    return map;
  } catch (_error) {
    const error = _error as Error;
    logger.info(error, `Error while trying to load records, assuming empty.`);
    return map;
  }
}

export function productChanges(
  productBefore: z.output<typeof ProductVariantRecord>,
  productAfter: z.output<typeof ProductVariantRecord>,
) {
  const lines = [];

  if (productBefore.price !== productAfter.price) {
    lines.push(`Price before: \`${productBefore.price}\` after: \`${productAfter.price}\``);
  }

  if (productBefore.available !== productAfter.available) {
    lines.push(
      `Available before: \`${productBefore.available}\` after: \`${productAfter.available}\``,
    );
  }

  return {
    lines,
    color:
      productBefore.available === productAfter.available
        ? undefined
        : productAfter.available
          ? Colors.Available
          : Colors.Deleted,
  };
}

function formatDiscordTimestamp(ms: number) {
  return `<t:${Math.floor(ms / 1_000)}:F>`;
}

export function formatProductbase(record: z.output<typeof ProductVariantRecord>, prefix?: string) {
  const detailLines: string[] = [
    `Price: ${record.available ? `€${record.price}` : `~~€${record.price}~~ **[SOLD OUT]**`}`,
    `Created: ${formatDiscordTimestamp(record.createdTimestamp)}`,
  ];

  if (record.updatedTimestamp) {
    detailLines.push(`Updated: ${formatDiscordTimestamp(record.updatedTimestamp)}`);
  }

  return {
    type: ComponentType.Section,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `### ${prefix ? [prefix, record.name].join(" ") : record.name}`,
      },
      {
        type: ComponentType.TextDisplay,
        content: detailLines.join("\n"),
      },
    ],
    accessory: {
      type: ComponentType.Thumbnail,
      media: {
        url: record.image,
      },
    },
  } as APISectionComponent;
}

export enum Colors {
  Available = 0x3ba55d,
  Changed = 0x5865f2,
  Deleted = 0xed4245,
}
