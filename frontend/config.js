// frontend/config.js
(function () {
  // In dev, your API is the same origin (http://localhost:3000)
  window.API_BASE  = window.API_BASE  || location.origin;
  // One, single key for the token everywhere
  window.TOKEN_KEY = window.TOKEN_KEY || 'authToken';
})();
