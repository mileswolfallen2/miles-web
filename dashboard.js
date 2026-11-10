(function () {
  'use strict';

  var host = window.location.hostname;
  var fallbackBase = (host === 'milesallen.site' || host === 'www.milesallen.site')
    ? 'https://api.milesallen.site'
    : '';
  var API = document.documentElement.dataset.api ||
    window.MILES_API_URL ||
    (fallbackBase ? fallbackBase + '/api' : '/api');
  var REFRESH_SECONDS = 60;
  var countdown = REFRESH_SECONDS;
  var refreshing = false;
  var hasLoaded = false;

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setText(id, value) {
    var node = $(id);
    if (node) node.textContent = value === null || value === undefined ? '--' : String(value);
  }

  function fmtNumber(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toLocaleString('en-US');
  }

  function fmtMs(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    var n = Number(value);
    return n >= 1000 ? (n / 1000).toFixed(2) + ' s' : Math.round(n) + ' ms';
  }

  function fmtPct(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1) + '%';
  }

  function fmtRelative(iso) {
    if (!iso) return 'never';
    var then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return 'never';
    var diff = Math.round((Date.now() - then) / 1000);
    if (diff < 0) diff = 0;
    if (diff < 45) return 'just now';
    if (diff < 90) return '1m ago';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 2592000) return Math.round(diff / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function toneFor(status) {
    if (status === 'operational' || status === 'online' || status === 'ok') return 'ok';
    if (status === 'degraded' || status === 'slow') return 'warn';
    if (status === 'offline' || status === 'down') return 'bad';
    return 'unknown';
  }

  function labelFor(status) {
    if (status === 'operational') return 'operational';
    if (status === 'online') return 'online';
    if (status === 'degraded') return 'degraded';
    if (status === 'offline') return 'offline';
    return 'unknown';
  }

  async function get(path) {
    var response = await fetch(API + path, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    var body = null;
    try { body = await response.json(); } catch (err) { body = null; }
    if (!response.ok) {
      throw new Error((body && body.error && body.error.message) || ('Request failed (' + response.status + ')'));
    }
    return body;
  }

  function renderBarChart(container, rows, valueKey, secondaryKey, labelKey, label) {
    container.replaceChildren();
    var max = 0;
    rows.forEach(function (row) {
      var value = Number(row[valueKey]) || 0;
      if (value > max) max = value;
    });
    rows.forEach(function (row) {
      var value = Number(row[valueKey]) || 0;
      var col = el('div', 'bar-col');
      var bar = el('div', 'bar' + (value === 0 ? ' zero' : ''));
      var height = max ? Math.max(2, Math.round((value / max) * 100)) : 2;
      bar.style.height = height + '%';
      var extra = secondaryKey && row[secondaryKey] !== undefined ? ' · ' + row[secondaryKey] : '';
      bar.title = row[labelKey] + ' · ' + value + ' ' + label + extra;
      col.appendChild(bar);
      container.appendChild(col);
    });
    container.setAttribute('aria-label', label + ' over the last ' + rows.length + ' days');
  }

  function renderRowsError(container, message) {
    container.replaceChildren();
    container.appendChild(el('div', 'row-empty', message));
  }

  function renderFeedError(container, message) {
    container.replaceChildren();
    container.appendChild(el('li', 'empty error', message));
  }

  function feedItem(title, meta, sub, href) {
    var li = el('li');
    var top = el('div', 'feed-top');
    var name = el('span', 'feed-name', title);
    if (href) {
      var link = el('a', null, title);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      name = link;
      name.className = 'feed-name';
    }
    top.appendChild(name);
    top.appendChild(el('span', 'feed-meta', meta || ''));
    li.appendChild(top);
    if (sub) li.appendChild(el('span', 'feed-sub', sub));
    return li;
  }

  function agoText(iso) {
    if (!iso) return '';
    return fmtRelative(iso);
  }

  function renderServerRows(status) {
    var container = $('serverRows');
    var servers = status.servers || [];
    if (!servers.length) {
      renderRowsError(container, 'No home servers are configured.');
      return;
    }
    container.replaceChildren();
    servers.forEach(function (server) {
      var tone = toneFor(server.status);
      var row = el('div', 'row');
      var main = el('div', 'row-main');
      main.appendChild(el('span', 'status-dot ' + tone));
      var text = el('div');
      text.style.minWidth = '0';
      text.appendChild(el('div', 'row-name', server.name));
      var sub = 'checked ' + agoText(server.lastCheckAt);
      if (server.status === 'unknown' && server.reason === 'not_on_home_network') {
        sub = 'outside home network';
      } else if (server.status === 'unknown' && server.reason && server.reason !== 'no_data') {
        sub = String(server.reason).replace(/_/g, ' ');
      } else if (server.lastSuccessAt) {
        sub += ' · up ' + agoText(server.lastSuccessAt);
      }
      text.appendChild(el('div', 'row-sub', sub));
      main.appendChild(text);

      var state = el('div', 'row-status ' + tone, labelFor(server.status));
      var metric = el('div', 'row-metric', fmtMs(server.responseMs));
      var uptime = el('div', 'row-uptime');
      var pct = server.uptime ? server.uptime['24h'] : null;
      var fillTone = pct === null ? '' : pct >= 99 ? '' : pct >= 90 ? 'warn' : 'bad';
      var bar = el('div', 'uptime-bar');
      var fill = el('div', 'uptime-fill ' + fillTone);
      fill.style.width = pct === null ? '0%' : Math.max(1, Math.min(100, pct)) + '%';
      bar.appendChild(fill);
      uptime.appendChild(bar);
      uptime.appendChild(el('span', 'uptime-text', '24h ' + fmtPct(pct) + ' · 7d ' + fmtPct(server.uptime ? server.uptime['7d'] : null)));

      row.appendChild(main);
      row.appendChild(state);
      row.appendChild(metric);
      row.appendChild(uptime);
      container.appendChild(row);
    });
  }

  function renderServiceRows(status) {
    var container = $('serviceRows');
    var services = status.services || [];
    if (!services.length) {
      renderRowsError(container, 'No websites are configured.');
      return;
    }
    container.replaceChildren();
    services.slice().sort(function (a, b) {
      var rank = { offline: 0, degraded: 1, unknown: 2, operational: 3 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    }).forEach(function (service) {
      var tone = toneFor(service.status);
      var row = el('div', 'row');
      var main = el('div', 'row-main');
      main.appendChild(el('span', 'status-dot ' + tone));
      var text = el('div');
      text.style.minWidth = '0';
      text.appendChild(el('div', 'row-name', service.name));
      var host = service.url;
      try { host = new URL(service.url).hostname; } catch (err) {}
      var sub = host + ' · checked ' + agoText(service.lastCheckAt);
      if (service.lastSuccessAt) sub += ' · last ok ' + agoText(service.lastSuccessAt);
      text.appendChild(el('div', 'row-sub', sub));
      main.appendChild(text);

      var state = el('div', 'row-status ' + tone, labelFor(service.status));
      var metric = el('div', 'row-metric', fmtMs(service.responseMs));
      var uptime = el('div', 'row-uptime');
      var pct = service.uptime ? service.uptime['24h'] : null;
      var fillTone = pct === null ? '' : pct >= 99 ? '' : pct >= 90 ? 'warn' : 'bad';
      var bar = el('div', 'uptime-bar');
      var fill = el('div', 'uptime-fill ' + fillTone);
      fill.style.width = pct === null ? '0%' : Math.max(1, Math.min(100, pct)) + '%';
      bar.appendChild(fill);
      uptime.appendChild(bar);
      uptime.appendChild(el('span', 'uptime-text', '24h ' + fmtPct(pct) + ' · 7d ' + fmtPct(service.uptime ? service.uptime['7d'] : null)));

      row.appendChild(main);
      row.appendChild(state);
      row.appendChild(metric);
      row.appendChild(uptime);
      container.appendChild(row);
    });
  }

  async function loadStatus() {
    try {
      var status = await get('/status');
      var servers = status.servers || [];
      var services = status.services || [];
      var overall = status.overall || {};
      var tone = toneFor(overall.status === 'operational' ? 'operational' : overall.status);
      var pill = $('overallPill');
      pill.className = 'overall-pill ' + (tone === 'ok' ? 'ok' : tone);

      var overallText = 'Status unknown';
      if (overall.status === 'operational') overallText = 'All systems nominal';
      else if (overall.status === 'degraded') overallText = 'Partial degradation';
      else if (overall.status === 'offline') overallText = 'Outage detected';
      setText('overallText', overallText);
      setText('lastUpdated', 'updated ' + fmtDateTime(status.generatedAt));
      setText('networkTag', status.network && status.network.onHomeNetwork === true ? 'home network' : status.network && status.network.onHomeNetwork === false ? 'remote network' : 'network unknown');

      var upServices = services.filter(function (s) { return s.status === 'operational'; }).length;
      var upServers = servers.filter(function (s) { return s.status === 'online'; }).length;
      setText('statServices', upServices + '/' + services.length);
      setText('statServers', upServers + '/' + servers.length);
      setText('statServicesNote', overall.counts && overall.counts.degraded ? overall.counts.degraded + ' degraded' : 'website checks');
      setText('statServersNote', status.network && status.network.onHomeNetwork === false ? 'off home network' : 'home network');

      renderServerRows(status);
      renderServiceRows(status);

      var notice = $('networkNotice');
      if (status.network && status.network.onHomeNetwork === false) {
        notice.hidden = false;
        notice.textContent = 'This machine does not appear to be on the home network. Home server checks are marked unknown instead of offline, so a failed ping is not reported as a server outage.';
      } else if (status.network && status.network.onHomeNetwork === null) {
        notice.hidden = false;
        notice.textContent = 'Home network context is not available yet. Server checks may be unknown until the first monitor pass completes.';
      } else {
        notice.hidden = true;
      }
    } catch (err) {
      renderRowsError($('serverRows'), 'Status API unavailable: ' + err.message);
      renderRowsError($('serviceRows'), 'Status API unavailable: ' + err.message);
      $('overallPill').className = 'overall-pill bad';
      setText('overallText', 'API unreachable');
    }
  }

  async function loadGitHub() {
    try {
      var results = await Promise.all([get('/github/overview'), get('/github/activity')]);
      var overview = results[0];
      var activity = results[1];
      var totals = overview.totals || {};
      var profile = overview.profile || {};

      setText('ghPublicRepos', fmtNumber(totals.publicRepos ?? profile.publicRepos));
      setText('ghTracked', fmtNumber(totals.trackedRepos));
      setText('ghStars', fmtNumber(totals.stars));
      setText('ghForks', fmtNumber(totals.forks));
      setText('statStars', fmtNumber(totals.stars));
      setText('statStarsNote', (totals.trackedRepos || 0) + ' tracked repos');

      if (profile.login) {
        var profileLink = $('githubProfileLink');
        profileLink.href = 'https://github.com/' + profile.login;
        profileLink.textContent = '@' + profile.login + ' →';
      }

      var chartRows = (activity.activity && activity.activity.days) || [];
      renderBarChart($('githubChart'), chartRows, 'events', null, 'day', 'events');

      var rate = overview.rateLimit || {};
      if (rate.authenticated && rate.remaining !== null && rate.remaining !== undefined) {
        setText('githubRate', 'API ' + rate.remaining + ' left');
      } else if (rate.authenticated) {
        setText('githubRate', 'authenticated API');
      } else {
        setText('githubRate', 'anonymous API');
      }

      var commits = overview.recentCommits || [];
      var feed = $('commitFeed');
      feed.replaceChildren();
      if (!commits.length) {
        feed.appendChild(el('li', 'empty', 'No public push events in the GitHub events window.'));
      } else {
        commits.slice(0, 8).forEach(function (commit) {
          feed.appendChild(feedItem(
            commit.project + ' · ' + (commit.sha || ''),
            agoText(commit.date),
            commit.message || '(no message)',
            commit.url
          ));
        });
      }

      var top = overview.topActive || [];
      var repoFeed = $('repoActivity');
      repoFeed.replaceChildren();
      if (!top.length) {
        repoFeed.appendChild(el('li', 'empty', 'No repository activity in the last 30 days.'));
      } else {
        top.slice(0, 6).forEach(function (entry) {
          repoFeed.appendChild(feedItem(
            entry.project,
            (entry.events || 0) + ' events',
            (entry.pushes || 0) + ' pushes · ' + entry.repo,
            'https://github.com/' + entry.repo
          ));
        });
      }

      var chips = $('languageChips');
      chips.replaceChildren();
      var languages = overview.languages || [];
      if (!languages.length) chips.appendChild(el('span', 'chip muted', '—'));
      languages.slice(0, 7).forEach(function (language) {
        chips.appendChild(el('span', 'chip', language.name + ' ×' + language.count));
      });

      var generated = overview.generatedAt ? 'Cached ' + agoText(overview.generatedAt) + '. ' : '';
      $('githubFoot').textContent = generated + 'Server-cached GitHub REST data. The token is never sent to the browser.';
    } catch (err) {
      renderFeedError($('commitFeed'), 'GitHub API unavailable: ' + err.message);
      renderFeedError($('repoActivity'), 'GitHub API unavailable.');
      $('githubChart').replaceChildren();
      $('githubFoot').textContent = 'GitHub data is unavailable right now. This is not being replaced with mock data.';
    }
  }

  async function loadFedl() {
    try {
      var stats = await get('/fedl/stats');
      var totals = stats.totals || {};
      setText('fedlLevels', fmtNumber(totals.rankedLevels));
      setText('fedlRecords', fmtNumber(totals.records));
      setText('fedlPlayers', fmtNumber(totals.players));
      setText('fedlSubmissions', fmtNumber(totals.submissions));
      setText('statLevels', fmtNumber(totals.rankedLevels));
      setText('statLevelsNote', (totals.records || 0) + ' approved runs');

      var top = $('fedlTop');
      top.replaceChildren();
      var levels = stats.topLevels || [];
      if (!levels.length) {
        top.appendChild(el('li', 'empty', 'No ranked levels returned.'));
      } else {
        levels.slice(0, 8).forEach(function (level) {
          var li = el('li');
          li.appendChild(el('span', 'rank', '#' + (level.position ?? '?')));
          var link = el('a', 'rank-name', level.title);
          if (level.url) {
            link.href = level.url;
            link.target = '_blank';
            link.rel = 'noopener';
          }
          li.appendChild(link);
          top.appendChild(li);
        });
      }

      var changes = stats.changes || { counts: {}, comparedTo: null };
      var changeFeed = $('fedlChanges');
      changeFeed.replaceChildren();
      if (!changes.comparedTo) {
        changeFeed.appendChild(el('li', 'empty', 'Baseline snapshot stored. Additions, removals, and rank changes will appear after the next refresh.'));
      } else {
        var items = [];
        (changes.added || []).forEach(function (item) {
          items.push({ label: '+ ' + item.title, note: 'added at #' + (item.position ?? '?'), cls: 'ok' });
        });
        (changes.removed || []).forEach(function (item) {
          items.push({ label: '− ' + item.title, note: 'removed from #' + (item.position ?? '?'), cls: 'bad' });
        });
        (changes.rankChanges || []).forEach(function (item) {
          items.push({
            label: (item.delta > 0 ? '↑ ' : '↓ ') + item.title,
            note: '#' + item.from + ' → #' + item.to,
            cls: item.delta > 0 ? 'ok' : 'warn'
          });
        });
        if (!items.length) {
          changeFeed.appendChild(el('li', 'empty', 'No list changes since the previous snapshot.'));
        } else {
          items.slice(0, 8).forEach(function (item) {
            var li = el('li');
            var row = el('div', 'feed-top');
            row.appendChild(el('span', 'feed-name', item.label));
            row.appendChild(el('span', 'feed-meta', item.note));
            li.appendChild(row);
            changeFeed.appendChild(li);
          });
        }
      }

      var foot = 'FEDL API: /list and /runs · refreshed ' + agoText(stats.generatedAt);
      if (stats.stale) foot += ' · serving cached data after a failed refresh';
      $('fedlFoot').textContent = foot;
    } catch (err) {
      renderFeedError($('fedlTop'), 'FEDL data unavailable: ' + err.message);
      renderFeedError($('fedlChanges'), 'FEDL data unavailable.');
    }
  }

  async function loadAnalytics() {
    try {
      var results = await Promise.all([
        get('/analytics/overview'),
        get('/analytics/pages?days=30&limit=8')
      ]);
      var overview = results[0];
      var pages = results[1];
      var totals = overview.totals || {};
      setText('viewsTotal', fmtNumber(totals.pageviews));
      setText('viewsToday', fmtNumber(totals.pageviewsToday));
      setText('views7d', fmtNumber(totals.pageviews7d));
      setText('visitors30d', fmtNumber(totals.uniqueVisitors30d));
      setText('statViews', fmtNumber(totals.pageviewsToday));
      setText('statViewsNote', fmtNumber(totals.pageviews7d) + ' in 7 days');
      setText('statVisitors', fmtNumber(totals.uniqueVisitors30d));
      setText('statVisitorsNote', 'daily hashes · 30d');

      var retention = overview.retentionDays || 30;
      setText('analyticsRetention', retention + '-day retention');
      var daily = overview.daily || [];
      var peak = 0;
      daily.forEach(function (day) { peak = Math.max(peak, day.views || 0); });
      setText('analyticsPeak', peak ? 'peak ' + peak + ' views/day' : 'no traffic recorded');
      renderBarChart($('analyticsChart'), daily, 'views', 'visitors', 'day', 'pageviews');

      var pageRows = pages.pages || [];
      var top = $('topPages');
      top.replaceChildren();
      if (!pageRows.length) {
        top.appendChild(el('li', 'empty', 'No pageviews recorded in the last 30 days.'));
      } else {
        pageRows.forEach(function (page) {
          top.appendChild(feedItem(
            page.path,
            fmtNumber(page.views) + ' views',
            fmtNumber(page.visitors) + ' visitors · ' + fmtPct(page.share) + ' share'
          ));
        });
      }

      var recent = overview.recentActivity || [];
      var feed = $('recentHits');
      feed.replaceChildren();
      if (!recent.length) {
        feed.appendChild(el('li', 'empty', 'No recent traffic.'));
      } else {
        recent.slice(0, 8).forEach(function (hit) {
          feed.appendChild(feedItem(
            hit.path,
            agoText(hit.created_at),
            hit.referrer_domain ? 'via ' + hit.referrer_domain : 'direct / no referrer'
          ));
        });
      }
    } catch (err) {
      renderFeedError($('topPages'), 'Analytics unavailable: ' + err.message);
      renderFeedError($('recentHits'), 'Analytics unavailable.');
      $('analyticsChart').replaceChildren();
    }
  }

  async function loadProjects() {
    try {
      var data = await get('/projects');
      var projects = data.projects || [];
      var grid = $('projectGrid');
      grid.replaceChildren();
      setText('projectCount', projects.length + ' visible');
      projects.forEach(function (project) {
        var node = document.createElement(project.website ? 'a' : 'div');
        node.className = 'project-card';
        if (project.website) {
          node.href = project.website;
          node.target = '_blank';
          node.rel = 'noopener';
        }
        var top = el('div', 'pc-top');
        top.appendChild(el('span', 'pc-name', project.name));
        var health = project.health;
        if (health) {
          top.appendChild(el('span', 'status-dot ' + toneFor(health)));
        }
        node.appendChild(top);
        node.appendChild(el('div', 'pc-desc', project.description || 'No description.'));
        var meta = [];
        if (project.github) meta.push(project.github.owner + '/' + project.github.repo);
        if (health) meta.push(labelFor(health));
        if (project.api) meta.push(project.api.type + ' API');
        node.appendChild(el('div', 'pc-meta', meta.join(' · ') || 'registry entry'));
        grid.appendChild(node);
      });
      if (!projects.length) grid.appendChild(el('div', 'empty', 'No visible projects configured.'));
    } catch (err) {
      var grid = $('projectGrid');
      grid.replaceChildren();
      grid.appendChild(el('div', 'empty error', 'Project registry unavailable: ' + err.message));
    }
  }

  async function loadAll() {
    if (refreshing) return;
    refreshing = true;
    countdown = REFRESH_SECONDS;
    var button = $('refreshBtn');
    button.disabled = true;
    try {
      await Promise.allSettled([loadStatus(), loadGitHub(), loadFedl(), loadAnalytics(), loadProjects()]);
      hasLoaded = true;
    } finally {
      refreshing = false;
      button.disabled = false;
    }
  }

  $('refreshBtn').addEventListener('click', loadAll);

  setInterval(function () {
    if (document.hidden) return;
    countdown -= 1;
    if (countdown <= 0) {
      countdown = REFRESH_SECONDS;
      loadAll();
    }
    var node = $('refreshCountdown');
    if (node) node.textContent = refreshing ? 'refreshing…' : 'auto-refresh ' + countdown + 's';
  }, 1000);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      countdown = REFRESH_SECONDS;
      if (!hasLoaded) loadAll();
    }
  });

  loadAll();
})();
