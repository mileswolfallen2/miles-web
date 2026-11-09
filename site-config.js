/*
 * Deployment configuration for the public site.
 *
 * The static site can live on milesallen.site while the Node backend is
 * exposed on api.milesallen.site. Everything else (API calls, the vault,
 * analytics) is derived from this one value.
 *
 * Override before this file loads if you use a different hostname:
 *   <script>window.MILES_API_BASE = 'https://api.example.com';</script>
 *   <script src="site-config.js"></script>
 *
 * Locally the value stays empty, so requests remain same-origin.
 */
(function () {
  'use strict';
  if (window.__milesSiteConfig) return;
  window.__milesSiteConfig = true;

  var meta = document.querySelector('meta[name="miles-api-base"]');
  var configured = window.MILES_API_BASE;
  if (typeof configured !== 'string') {
    configured = meta ? meta.getAttribute('content') || '' : '';
  }

  var host = window.location.hostname;
  var local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!configured && !local) {
    // Production split-origin default. API and static site are same-site
    // (both under milesallen.site), so vault cookies remain SameSite=Strict.
    if (host === 'milesallen.site' || host === 'www.milesallen.site') {
      configured = 'https://api.milesallen.site';
    }
  }

  configured = configured.replace(/\/+$/, '');
  window.MILES_API_BASE = configured;
  window.MILES_API_URL = configured ? configured + '/api' : '/api';
  window.MILES_VAULT_URL = configured ? configured + '/vault' : '/vault';
})();
