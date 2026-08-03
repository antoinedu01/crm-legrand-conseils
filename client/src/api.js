async function request(method, url, body, signal) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    window.dispatchEvent(new Event('crm:unauthorized'));
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// `signal` (AbortController.signal) est optionnel partout — les appels
// existants qui ne le passent pas gardent exactement le même comportement.
export const api = {
  get: (url, signal) => request('GET', url, undefined, signal),
  post: (url, body, signal) => request('POST', url, body, signal),
  put: (url, body, signal) => request('PUT', url, body, signal),
  del: (url, body, signal) => request('DELETE', url, body, signal),
};
