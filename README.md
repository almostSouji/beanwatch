# About

Configure shopify stores exposing their catalogue as json file and get informed about updates in Discord.

# Configuration

Configuration is read from `./config.yml` and follows the following format:

> [!IMPORTANT]
> The current implementation assumes that:
>
> 1. `<url>/products.json` is exposed and supports `page` and `limit` queries.
> 2. `<url>/products/<handle>` exposes product detail pages and supports `variant` queries

```yml
- discord_webhook_token: ""
  discord_webhook_id: ""
  discord_thread_id: ""
  description: "short description"
  catalogues:
    - "https://baseurl.com"
  vendor_any:
    - "optional list of watched vendor phrases"
  title_any:
    - "optional title phrases, matching regardless of vendor"
  allowed_sizes:
    - L
    - XL
```

- `discord_webhook_token` (`string`): token part of the discord webhook to use
- `discord_webhook_id` (`string`): id part of the discord webhook to use
- `discord_thread_id` (`string`): id of the thread used to publish updates to the catalogue
- `description` (`string`, optional): not surfaced anywhere, just organizational recommendation
- `catalogues` (`list[string]`): list of shopify base URLs to track
- `vendor_any` (`list[string]`, optional): vendors matching any of the phrases in this list will be tracked
- `title_any` (`list[string]`, optional): product titles matching any of the phrases in this list will be tracked
- either `vendor_any` or `title_any` are required, else nothing will be tracked
- `allowed_sizes` (`list[string]`, optional): merchandise sizes that should be logged, ignores all other size variants (determined by size options being available on the produc)

> [!IMPORTANT]
> `discord_thread_id` has to be a thread created in the same channel as the webhook is placed in.

# Setup

`./records` holds the state of the currently tracked products per configured webhook and is mounted into the docker container (if hosting via docker or podman).
The file name format is `<discord_webhook_id>.json`.
