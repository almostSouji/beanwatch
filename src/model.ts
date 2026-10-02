import * as z from "zod";

export const ConfigEntry = z.object({
  discord_webhook_token: z.string(),
  discord_webhook_id: z.string(),
  discord_thread_id: z.string(),
  description: z.string().optional(),
  catalogues: z.string().array(),
  title_any: z.string().array().optional(),
  vendor_any: z.string().array().optional(),
  allowed_sizes: z.string().array().optional(),
});

export const Config = z.array(ConfigEntry);

export const ShopifyImage = z.object({
  product_id: z.number(),
  src: z.string(),
});

export const ShopifyVariant = z.object({
  id: z.number(),
  title: z.string(),
  featured_image: ShopifyImage.nullish(),
  price: z.string(),
  available: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
  option1: z.string().nullish(),
  option2: z.string().nullish(),
  option3: z.string().nullish(),
});

export const ShopifyProductOption = z.object({
  name: z.string(),
  values: z.string().array(),
});

export const ShopifyProduct = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  variants: z.array(ShopifyVariant),
  images: z.array(ShopifyImage).optional(),
  vendor: z.string(),
  options: ShopifyProductOption.array().optional(),
});

export const ShopifyResult = z.object({
  products: z.array(ShopifyProduct),
});

export const PreparedProductVariantRecord = z.object({
  key: z.string(),
  price: z.number(),
  available: z.boolean(),
  name: z.string(),
  image: z.string().optional(),
  productId: z.number(),
  variantId: z.number(),
  handle: z.string(),
  createdTimestamp: z.number(),
  updatedTimestamp: z.number().optional(),
  hookId: z.string(),
  shopBase: z.string(),
  vendor: z.string(),
});

export const ProductVariantRecordWithMessageId = PreparedProductVariantRecord.extend({
  messageId: z.string(),
});
export const ProductVariantRecordsWithMessageId = ProductVariantRecordWithMessageId.array();

export type ProductVariantWithIdMap = Map<
  string,
  z.output<typeof ProductVariantRecordWithMessageId>
>;
export type ProductMap = Map<number, z.output<typeof ShopifyProduct>>;
export type ProductRecords = Map<string, z.output<typeof ProductVariantRecordWithMessageId>>;
export type ShopProductMap = Map<string, ProductMap>;
export type ProductFilters = Pick<
  z.output<typeof ConfigEntry>,
  "vendor_any" | "title_any" | "allowed_sizes"
>;
export type PreparedProductMap = Map<string, z.output<typeof PreparedProductVariantRecord>>;
