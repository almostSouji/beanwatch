import * as z from "zod";

export const ConfigEntry = z.object({
  discord_webhook_token: z.string(),
  discord_webhook_id: z.string(),
  discord_thread_id: z.string(),
  description: z.string().nullish(),
  catalogues: z.string().array(),
  title_any: z.string().array().optional(),
  vendor_any: z.string().array().optional(),
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
});

export const ShopifyProduct = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  variants: z.array(ShopifyVariant),
  images: z.array(ShopifyImage).optional(),
  vendor: z.string(),
});

export const ShopifyResult = z.object({
  products: z.array(ShopifyProduct),
});

export const ProductVariantRecord = z.object({
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
  messageId: z.string().optional(),
  hookId: z.string(),
  shopBase: z.string(),
  vendor: z.string(),
});

export const ProductVairantRecords = z.array(ProductVariantRecord);
