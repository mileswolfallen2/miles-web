/*
 * Privacy-friendly pageview beacon.
 * - no cookies
 * - no localStorage identifier
 * - no query strings or fragments
 * - never runs on private or operator pages
 * The backend hashes the request IP with a daily rotating secret and discards it.
 */
(function () {
  'use strict';

  if (window.__milesAnalyticsLoaded) return;
  window.__milesAnalyticsLoaded = true;

  var path = window.location.pathname || '/';
  var skip = [
    /^\/dashboard(?:\.html)?\/?$/,
    /^\/vault\/?$/,
    /^\/moon-vault(?:\.html)?$/,
    /^\/games(?:\/|$)/,
    /^\/api(?:\/|$)/,
    /^\/404(?:\.html)?$/
  ];
  if (skip.some(function (pattern) { return pattern.test(path); })) return;

  var meta = document.querySelector('meta[name="miles-analytics-endpoint"]');
  var endpoint = (meta && meta.getAttribute('content')) || '/api/analytics/hit';

  var payload = {
    path: path,
    referrer: document.referrer || null
  };

  function send() {
    try {
      var body = JSON.stringify(payload);
      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).catch(function () {});
    } catch (err) {
      // Analytics must never break the page.
    }
  }

  if (document.readyState === 'complete') send();
  else window.addEventListener('load', send, { once: true });
})();
