import { AppError, unavailable } from '../lib/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : null;
}

function firstLine(value) {
  return String(value || '').split('\n')[0].slice(0, 240);
}

function lastPageFromLink(link) {
  if (!link) return null;
  const match = String(link).match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createGitHubService({
  config,
  db,
  logger,
  fetchFn = globalThis.fetch,
  now = () => new Date()
}) {
  const stmts = {
    getCache: db.prepare('SELECT * FROM cache WHERE key = ?'),
    upsertCache: db.prepare(`
      INSERT INTO cache (key, value, etag, fetched_at, expires_at)
      VALUES (@key, @value, @etag, @fetchedAt, @expiresAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value, etag = excluded.etag,
        fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
    `),
    touchCache: db.prepare('UPDATE cache SET fetched_at = ?, expires_at = ? WHERE key = ?'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare(`
      INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
  };

  let refreshPromise = null;
  let timer = null;

  function meta(key) {
    return stmts.getMeta.get(key)?.value ?? null;
  }

  function setMeta(key, value) {
    stmts.setMeta.run(key, String(value), now().toISOString());
  }

  function readCache(key) {
    const row = stmts.getCache.get(key);
    if (!row) return null;
    try {
      return { ...row, data: JSON.parse(row.value) };
    } catch {
      return null;
    }
  }

  function writeCache(key, data, { etag = null, ttlMs }) {
    const at = now();
    stmts.upsertCache.run({
      key,
      value: JSON.stringify(data),
      etag,
      fetchedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + ttlMs).toISOString()
    });
  }

  function rateLimitInfo() {
    const remaining = meta('github:rate_remaining');
    const reset = meta('github:rate_reset');
    return {
      authenticated: Boolean(config.github.token),
      remaining: remaining === null ? null : Number(remaining),
      resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null
    };
  }

  function sleepUntilReset() {
    const reset = meta('github:rate_reset');
    return reset ? Number(reset) * 1000 > now().getTime() : false;
  }

  async function apiRequest(
    path,
    { key, ttlMs, force = false, withHeaders = false, allowStale = true } = {}
  ) {
    const cache = key ? readCache(key) : null;
    if (cache && !force) {
      const expires = new Date(cache.expires_at).getTime();
      if (Number.isFinite(expires) && expires > now().getTime()) {
        return withHeaders ? { data: cache.data, headers: null, stale: false } : cache.data;
      }
    }

    if (sleepUntilReset() && allowStale && cache) {
      return withHeaders ? { data: cache.data, headers: null, stale: true } : cache.data;
    }

    const url = `${config.github.apiBase}${path}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'milesallen-dashboard/1.0',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (config.github.token) headers.Authorization = `Bearer ${config.github.token}`;
    if (cache?.etag && !force) headers['If-None-Match'] = cache.etag;

    let response;
    try {
      response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(config.github.timeoutMs)
      });
    } catch (err) {
      if (allowStale && cache) return withHeaders ? { data: cache.data, headers: null, stale: true } : cache.data;
      throw unavailable(`GitHub request failed: ${err.message}`);
    }

    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    const reset = response.headers?.get?.('x-ratelimit-reset');
    if (remaining !== null && remaining !== undefined) setMeta('github:rate_remaining', remaining);
    if (reset !== null && reset !== undefined) setMeta('github:rate_reset', reset);

    if (response.status === 304 && cache) {
      const at = now();
      stmts.touchCache.run(
        at.toISOString(),
        new Date(at.getTime() + (ttlMs || config.github.refreshMs)).toISOString(),
        key
      );
      return withHeaders ? { data: cache.data, headers: response.headers, stale: false } : cache.data;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const rateLimited = response.status === 403 || response.status === 429;
      if (rateLimited && allowStale && cache) {
        if (allowStale) logger.warn('GitHub rate limited; serving cache', { path, status: response.status });
        return withHeaders ? { data: cache.data, headers: response.headers, stale: true } : cache.data;
      }
      if (response.status === 404) throw new AppError(404, 'github_not_found', `GitHub resource not found: ${path}`);
      throw unavailable(`GitHub API error (${response.status}) for ${path}${body ? ': ' + body.slice(0, 120) : ''}`);
    }

    const data = await response.json();
    if (key) writeCache(key, data, { etag: response.headers?.get?.('etag') || null, ttlMs: ttlMs || config.github.refreshMs });
    return withHeaders ? { data, headers: response.headers, stale: false } : data;
  }

  function normalizeCommit(commit, repoFullName) {
    if (!commit) return null;
    return {
      sha: shortSha(commit.sha),
      message: firstLine(commit.commit?.message),
      author: commit.commit?.author?.name || commit.author?.login || 'unknown',
      date: commit.commit?.author?.date || commit.commit?.committer?.date || null,
      url: commit.html_url || (repoFullName ? `https://github.com/${repoFullName}/commit/${commit.sha}` : null)
    };
  }

  function normalizeRepo(project, repo, latestCommit, release, contributors) {
    return {
      id: project.id,
      name: project.name,
      description: repo?.description || project.description || '',
      fullName: repo?.full_name || `${project.github.owner}/${project.github.repo}`,
      url: repo?.html_url || `https://github.com/${project.github.owner}/${project.github.repo}`,
      website: repo?.homepage || project.website || null,
      language: repo?.language || null,
      stars: repo?.stargazers_count ?? 0,
      forks: repo?.forks_count ?? 0,
      openIssues: repo?.open_issues_count ?? 0,
      watchers: repo?.subscribers_count ?? repo?.watchers_count ?? 0,
      defaultBranch: repo?.default_branch || null,
      archived: Boolean(repo?.archived),
      fork: Boolean(repo?.fork),
      topics: Array.isArray(repo?.topics) ? repo.topics.slice(0, 6) : [],
      pushedAt: repo?.pushed_at || null,
      updatedAt: repo?.updated_at || null,
      createdAt: repo?.created_at || null,
      latestCommit,
      release,
      contributors,
      featured: project.featured
    };
  }

  function buildActivity(events, repositories, profile) {
    const projectByFullName = new Map(
      repositories.map((repo) => [repo.fullName.toLowerCase(), repo])
    );
    const recentCommits = [];

    for (const event of events || []) {
      if (event.type !== 'PushEvent') continue;
      const fullName = event.repo?.name || '';
      const project = projectByFullName.get(fullName.toLowerCase());
      const branch = (event.payload?.ref || '').replace('refs/heads/', '');
      for (const commit of event.payload?.commits || []) {
        recentCommits.push({
          repo: fullName,
          project: project?.name || fullName.split('/').pop(),
          branch,
          sha: shortSha(commit.sha),
          message: firstLine(commit.message),
          author: commit.author?.name || event.actor?.login || 'unknown',
          date: event.created_at,
          url: commit.sha && fullName ? `https://github.com/${fullName}/commit/${commit.sha}` : null
        });
      }
    }

    recentCommits.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const since = now().getTime() - 30 * DAY_MS;
    const dayMap = new Map();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(now().getTime() - i * DAY_MS).toISOString().slice(0, 10);
      dayMap.set(day, { day, events: 0, pushes: 0 });
    }

    const repoEvents = new Map();
    for (const event of events || []) {
      const at = new Date(event.created_at);
      if (!Number.isFinite(at.getTime()) || at.getTime() < since) continue;
      const day = at.toISOString().slice(0, 10);
      const bucket = dayMap.get(day);
      if (bucket) {
        bucket.events += 1;
        if (event.type === 'PushEvent') bucket.pushes += 1;
      }
      const fullName = event.repo?.name || 'unknown';
      const current = repoEvents.get(fullName) || { repo: fullName, events: 0, pushes: 0 };
      current.events += 1;
      if (event.type === 'PushEvent') current.pushes += 1;
      repoEvents.set(fullName, current);
    }

    const byRepo = [...repoEvents.values()]
      .map((entry) => ({
        ...entry,
        project: projectByFullName.get(entry.repo.toLowerCase())?.name || entry.repo.split('/').pop()
      }))
      .sort((a, b) => b.events - a.events || b.pushes - a.pushes)
      .slice(0, 10);

    const totals = { stars: 0, forks: 0, openIssues: 0 };
    const languages = new Map();
    for (const repo of repositories) {
      totals.stars += repo.stars;
      totals.forks += repo.forks;
      totals.openIssues += repo.openIssues;
      if (repo.language) languages.set(repo.language, (languages.get(repo.language) || 0) + 1);
    }

    return {
      profile: profile
        ? {
            login: profile.login,
            name: profile.name,
            avatarUrl: profile.avatar_url,
            bio: profile.bio,
            company: profile.company,
            location: profile.location,
            blog: profile.blog,
            followers: profile.followers,
            following: profile.following,
            publicRepos: profile.public_repos,
            createdAt: profile.created_at
          }
        : null,
      totals: { ...totals, trackedRepos: repositories.length, publicRepos: profile?.public_repos ?? null },
      languages: [...languages.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      recentCommits: recentCommits.slice(0, 40),
      activity: { days: [...dayMap.values()], byRepo }
    };
  }

  async function doRefresh({ force = false } = {}) {
    const started = Date.now();
    const username = config.github.username;
    const ttlMs = config.github.refreshMs;

    const [profile, repos, events] = await Promise.all([
      apiRequest(`/users/${username}`, { key: `github:profile:${username}`, ttlMs, force }),
      apiRequest(`/users/${username}/repos?per_page=100&sort=updated`, {
        key: `github:repos:${username}`,
        ttlMs,
        force
      }),
      apiRequest(`/users/${username}/events/public?per_page=100`, {
        key: `github:events:${username}`,
        ttlMs,
        force
      })
    ]);

    const tracked = config.projects.filter((project) => project.visible && project.github);
    const repoList = Array.isArray(repos) ? repos : [];
    const byFullName = new Map(repoList.map((repo) => [String(repo.full_name).toLowerCase(), repo]));

    const repositories = await mapLimit(tracked, 4, async (project) => {
      const fullName = `${project.github.owner}/${project.github.repo}`;
      const keyBase = fullName.toLowerCase();
      let repo = byFullName.get(keyBase) || null;
      let latestCommit = null;
      let release = null;
      let contributors = null;
      const errors = [];

      if (!repo) {
        try {
          repo = await apiRequest(`/repos/${fullName}`, {
            key: `github:repo:${keyBase}`,
            ttlMs,
            force
          });
        } catch (err) {
          errors.push(`repo: ${err.message}`);
        }
      }

      try {
        const commits = await apiRequest(`/repos/${fullName}/commits?per_page=1`, {
          key: `github:commits:${keyBase}`,
          ttlMs,
          force
        });
        latestCommit = normalizeCommit(Array.isArray(commits) ? commits[0] : null, fullName);
      } catch (err) {
        errors.push(`commits: ${err.message}`);
      }

      if (config.github.enrich && config.github.token) {
        try {
          const releases = await apiRequest(`/repos/${fullName}/releases?per_page=1`, {
            key: `github:release:${keyBase}`,
            ttlMs: 6 * 60 * 60 * 1000,
            force
          });
          const item = Array.isArray(releases) ? releases[0] : null;
          if (item) {
            release = {
              tag: item.tag_name,
              name: item.name || item.tag_name,
              publishedAt: item.published_at,
              url: item.html_url,
              prerelease: Boolean(item.prerelease)
            };
          }
        } catch (err) {
          errors.push(`releases: ${err.message}`);
        }

        try {
          const result = await apiRequest(`/repos/${fullName}/contributors?per_page=1&anon=1`, {
            key: `github:contributors:${keyBase}`,
            ttlMs: 6 * 60 * 60 * 1000,
            force,
            withHeaders: true
          });
          const link = result.headers?.get?.('link');
          const last = lastPageFromLink(link);
          contributors = last ?? (Array.isArray(result.data) ? result.data.length : null);
        } catch (err) {
          errors.push(`contributors: ${err.message}`);
        }
      }

      return {
        ...normalizeRepo(project, repo, latestCommit, release, contributors),
        errors: errors.length ? errors : undefined
      };
    });

    const activity = buildActivity(Array.isArray(events) ? events : [], repositories, profile);

    const summary = {
      generatedAt: now().toISOString(),
      username,
      rateLimit: rateLimitInfo(),
      profile: activity.profile,
      totals: activity.totals,
      languages: activity.languages,
      repositories,
      recentCommits: activity.recentCommits,
      activity: activity.activity,
      recentlyUpdated: [...repositories]
        .sort((a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')))
        .slice(0, 8)
        .map((repo) => ({ id: repo.id, name: repo.name, pushedAt: repo.pushedAt, latestCommit: repo.latestCommit }))
    };

    writeCache('github:summary', summary, { ttlMs });
    logger.info('GitHub refresh complete', {
      repos: repositories.length,
      commits: summary.recentCommits.length,
      durationMs: Date.now() - started
    });
    return summary;
  }

  function refresh(options = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = doRefresh(options)
      .catch((err) => {
        logger.error('GitHub refresh failed', { error: err.message });
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function cachedSummary() {
    const row = readCache('github:summary');
    return row?.data || null;
  }

  async function ensureSummary() {
    const summary = cachedSummary();
    if (summary) {
      const row = readCache('github:summary');
      const expires = new Date(row.expires_at).getTime();
      if (Number.isFinite(expires) && expires <= now().getTime() && !refreshPromise) {
        refresh().catch(() => {});
      }
      return summary;
    }
    return refresh();
  }

  async function getOverview() {
    const summary = await ensureSummary();
    return {
      generatedAt: summary.generatedAt,
      username: summary.username,
      profile: summary.profile,
      rateLimit: summary.rateLimit,
      totals: summary.totals,
      languages: summary.languages,
      recentCommits: summary.recentCommits.slice(0, 12),
      recentlyUpdated: summary.recentlyUpdated,
      topActive: summary.activity.byRepo.slice(0, 6)
    };
  }

  async function getActivity() {
    const summary = await ensureSummary();
    return {
      generatedAt: summary.generatedAt,
      username: summary.username,
      rateLimit: summary.rateLimit,
      recentCommits: summary.recentCommits,
      activity: summary.activity
    };
  }

  async function getRepositories() {
    const summary = await ensureSummary();
    return {
      generatedAt: summary.generatedAt,
      rateLimit: summary.rateLimit,
      repositories: summary.repositories
    };
  }

  function start() {
    refresh({ force: false }).catch(() => {});
    timer = setInterval(() => {
      refresh({ force: false }).catch(() => {});
    }, config.github.refreshMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { refresh, getOverview, getActivity, getRepositories, start, stop, rateLimitInfo };
}
