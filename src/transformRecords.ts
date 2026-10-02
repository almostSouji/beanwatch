import { fileURLToPath } from "node:url";
import { loadConfig, loadRecords, recordKey, saveRecords } from "./functions.js";

const config = await loadConfig(fileURLToPath(new URL("../config.yml", import.meta.url)));

for (const entry of config) {
  const newRecords = new Map();
  const records = await loadRecords(entry.discord_webhook_id);

  for (const record of records.values()) {
    const newKey = recordKey(record.shopBase, record.productId, record.variantId);
    newRecords.set(newKey, { ...record, key: newKey });
  }

  await saveRecords(newRecords, entry.discord_webhook_id);
}
