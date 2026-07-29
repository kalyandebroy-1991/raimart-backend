# RAI MART Backend + Admin Panel

A Node.js/Express + SQLite backend with a browser-based admin panel for managing
your product catalog, stock status, and daily offers.

## What's included

- REST API for products and categories
- JWT-based admin login
- Stock toggle (In Stock / Out of Stock) per product
- Daily offer management (% discount, can be turned on/off without losing the number)
- Bulk import via Excel/CSV
- A ready-to-use admin panel at `/admin`

## Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and set:
- `JWT_SECRET` — any long random string
- `ADMIN_USER` / `ADMIN_PASS` — your admin login (only used the very first time the
  database is created; after that, change your password from inside the admin panel)

Then start the server:

```bash
node server.js
```

- API runs at `http://localhost:4000`
- Admin panel: `http://localhost:4000/admin`

The SQLite database file is created automatically at `data/raimart.db` on first run,
along with 8 default categories (Fruits & Vegetables, Dairy & Bakery, etc.) and your
admin account.

## Daily use: managing stock and offers

1. Go to `/admin` and log in.
2. Every product row has:
   - An **In Stock** toggle — flip it off the moment something runs out, flip it
     back on when restocked. This takes effect immediately for anyone hitting the API.
   - A **Today's Offer** toggle + a % field — turn on a discount and set the
     percentage (e.g. 15 for 15% off). The site/app will automatically show both the
     original price and the discounted price.
3. Use **+ Add Product** for one-off additions, or **Bulk Import** to upload an
   Excel/CSV file with many products at once.

### Bulk import file format

Columns (case-insensitive, order doesn't matter):

| name | category | unit | price | image_url | in_stock | offer_percent |
|------|----------|------|-------|-----------|----------|----------------|
| Toned Milk 500ml | Dairy & Bakery | packet | 28 | | 1 | 0 |
| Parle-G Biscuits | Snacks & Sweets | pack | 20 | | 1 | 10 |

New categories mentioned in the file are created automatically.

## API endpoints (for the website/app to consume)

Public (no auth needed):
- `GET /api/products` — list products. Supports `?category_id=`, `?in_stock=true`, `?featured=true`, `?search=`
- `GET /api/products/:id` — single product
- `GET /api/categories` — list categories

Admin (needs `Authorization: Bearer <token>` from `/api/auth/login`):
- `POST /api/products` — create
- `PUT /api/products/:id` — full edit
- `PATCH /api/products/:id/stock` — quick stock toggle
- `PATCH /api/products/:id/offer` — quick offer update
- `DELETE /api/products/:id`
- `POST /api/products/bulk-import` — upload Excel/CSV (multipart `file` field)
- `POST /api/categories`, `DELETE /api/categories/:id`
- `POST /api/auth/change-password`

Every product returned by the public API includes a `final_price` field —
already discounted if an offer is active — so the website/app never has to do
that math themselves.

## Deploying for real (not just local testing)

This currently runs on SQLite on local disk, which is fine for one server but
won't survive a redeploy on most hosting platforms. When you're ready to put
this on Railway or Render (as planned), the two things to change are:
1. Set real values for `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS` as environment
   variables on the host (don't commit `.env`).
2. Either use the host's persistent disk/volume feature for the SQLite file, or
   migrate to a hosted Postgres/MySQL database — happy to help with that step
   when you get there.

## Next step: connecting the website

The neon marketing website built earlier has hardcoded product HTML. To make it
reflect real stock/offers, its product section needs to `fetch('/api/products')`
on page load instead of using static cards. That's a good follow-up once this
backend is deployed somewhere reachable.
