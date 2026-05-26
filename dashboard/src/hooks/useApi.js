import { useState, useEffect } from 'react';
import { API_URL } from '../config';

export function getShop() {
  const param = new URLSearchParams(window.location.search).get('shop');
  if (param) {
    localStorage.setItem('upsell_shop', param);
    return param;
  }
  return localStorage.getItem('upsell_shop') || import.meta.env.VITE_SHOP_DOMAIN || '';
}

export function useApi(resource) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const shop = getShop();

  useEffect(() => {
    if (!shop) {
      setError('No shop configured. Go to Settings to set your shop domain.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/dashboard/${resource}?shop=${shop}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [resource, shop]);

  return { data, loading, error, shop };
}
