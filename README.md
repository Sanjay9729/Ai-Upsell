# AI Upsell – Shopify Product Recommendation

AI-powered upsell app for Shopify: stores products in MongoDB, fetches fresh details from Shopify, and renders recommendations on product detail pages.

## Prerequisites
- Node.js 18+
- MongoDB URI (local or Atlas)
- Shopify Partner app credentials + Storefront access
- Groq API key (recommended)
- Git and Shopify CLI (required for `npm run dev`)

## Quick Start (new machine)
1) Unzip the project and open a terminal in the extracted `ai-upsell` folder.
2) Create `.env` in the project root with the variables below.
3) `npm install`
4) Production-style: `npm start` (runs `node server.js` with your env vars).

## Step-by-Step (copy/paste)
1. Check Node version: `node -v` (needs 18+)
2. Install dependencies: `npm install`
3. Create `.env` using the sample below (add your own keys)
4. Dev with Shopify tunnel: `npm run dev`  
   - or API-only: `PORT=3001 npm run dev:alt`
5. Production-style run: `npm start` (same as `node server.js`)
6. Health check: `curl http://localhost:3000/api/health`
7. Optional: sync products from Shopify to MongoDB: `npm run sync`

## Required Environment Variables
- `MONGODB_URI`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `SHOPIFY_APP_URL`
- `SHOP_CUSTOM_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `GROQ_API_KEY`

## Scripts
- `npm run dev` — Shopify CLI dev (Remix + backend)
- `npm run dev:alt` — Express API on `PORT` (default 3001)
- `npm start` — production server (`node server.js`)
- `npm run build` — Remix/Vite build
- `npm run lint` — lint JS/TS

## Project Structure (brief)
```
ai-upsell/
├── backend/         # database, routes, services
├── frontend/        # React components (if using split frontend)
├── server.js        # main server entry
├── shopify.app.toml # Shopify app config
├── package.json
└── README.md
```

## API (quick)
- `POST /api/products/sync` — sync products from Shopify to MongoDB
- `GET /api/products/upsell/:productId?shopId=shop` — recommended product IDs + metadata
- Webhooks: `POST /api/webhooks/products/{create|update|delete}`, `POST /api/webhooks/app/uninstalled`

## Troubleshooting
- Port in use → change `PORT` or free ports 3000/3001.
- Mongo connect fails → verify `MONGODB_URI` and network/allowlist.
- Shopify auth errors → check API key/secret, scopes, and `SHOPIFY_APP_URL`.
- Tunnel not opening → reinstall/sign-in Shopify CLI, rerun `npm run dev`.

## License
MIT
