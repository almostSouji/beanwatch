import * as z from "zod";

export const ConfigEntry = z.object({
  discord_webhook_token: z.string(),
  discord_webhook_id: z.string(),
  discord_notification_role_id: z.string().nullish(),
  description: z.string().nullish(),
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
});

export const ShopifyProduct = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  variants: z.array(ShopifyVariant),
  images: z.array(ShopifyImage),
});

export const ShopifyResult = z.object({
  products: z.array(ShopifyProduct),
});

export const ProductVariantRecord = z.object({
  key: z.string(),
  price: z.number(),
  available: z.boolean(),
  name: z.string(),
  image: z.string(),
  productId: z.number(),
  variantId: z.number(),
  handle: z.string(),
});

export const ProductVairantRecords = z.array(ProductVariantRecord);
