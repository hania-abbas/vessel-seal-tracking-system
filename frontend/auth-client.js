// frontend/auth-client.js
(function () {
  const API_BASE  = window.API_BASE  || location.origin;
  const TOKEN_KEY = window.TOKEN_KEY || 'authToken';

  function getToken()   { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t)  { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function redirectToLogin() {
    const here = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${here}`;
  }

  function requireAuth() {
    const t = getToken();
    if (!t) { redirectToLogin(); throw new Error('no_token'); }
    return t;
  }

  async function apiFetch(path, options = {}) {
    const token = getToken(); // allow public endpoints if you add any later
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(url, { ...options, headers, cache: 'no-store' });

    // If token is bad/expired, clear it and bounce to login
    if (res.status === 401 || res.status === 403) {
      clearToken();
      redirectToLogin();
      throw new Error('unauthorized');
    }
    return res;
  }

  // Export a tiny SDK
  window.App = { getToken, setToken, clearToken, requireAuth, apiFetch };
})();
