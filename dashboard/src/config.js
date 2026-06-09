// Always use relative URL so all API calls go through the Netlify proxy (/api/* → Render).
// This avoids CORS issues entirely — the browser sees same-origin requests.
// In dev: Vite proxy (vite.config.js) handles /api/* → api-server.mjs.
export const API_URL = '';