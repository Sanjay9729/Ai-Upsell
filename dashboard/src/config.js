// In dev: Vite proxy handles /api/* (relative URL = '').
// In production: VITE_BACKEND_URL points directly to the backend,
// bypassing the Netlify proxy so the correct Render URL is always used.
export const API_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
