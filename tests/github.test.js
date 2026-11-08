import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubService } from '../server/services/github.js';
import { createTestContext, jsonResponse, silentLogger } from './helpers.js';

function mockGitHub(now, calls) {
  return async function fetchFn(url, options = {}) {
    calls.push({ url: String(url), headers: options.headers || {} });
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/users/octocat') {
      return jsonResponse(
        {
          login: 'octocat',
          name: 'The Octocat',
          avatar_url: 'https://avatars.example/octocat.png',
          bio: 'test',
          followers: 10,
          following: 2,
          public_repos: 165,
          created_at: '2020-01-01T00:00:00Z'
        },
        { headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1900000000' } }
      );
    }
    if (pathname === '/users/octocat/repos') {
      return jsonResponse([
        {
          full_name: 'octocat/alpha',
          description: 'Alpha repository',
          html_url: 'https://github.com/octocat/alpha',
          homepage: 'https://alpha.test',
          language: 'JavaScript',
          stargazers_count: 12,
          forks_count: 3,
          open_issues_count: 1,
          subscribers_count: 4,
          default_branch: 'main',
          archived: false,
          fork: false,
          topics: ['test'],
          pushed_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          updated_at: now.toISOString(),
          created_at: '2024-01-01T00:00:00Z'
        }
      ]);
    }
    if (pathname === '/users/octocat/events/public') {
      return jsonResponse([
        {
          type: 'PushEvent',
          created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          repo: { name: 'octocat/alpha' },
          actor: { login: 'octocat' },
          payload: {
            ref: 'refs/heads/main',
            commits: [
              {
                sha: 'abcdef1234567890',
                message: 'Add a real feature\n\nWith details',
                author: { name: 'Miles' }
              }
            ]
          }
        },
        {
          type: 'WatchEvent',
          created_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
          repo: { name: 'octocat/alpha' }
        }
      ]);
    }
    if (pathname === '/repos/octocat/alpha/commits') {
      return jsonResponse([
        {
          sha: 'fedcba9876543210',
          commit: {
            message: 'Latest commit subject\n\nBody',
            author: { name: 'Miles', date: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }
          },
          html_url: 'https://github.com/octocat/alpha/commit/fedcba9876543210'
        }
      ]);
    }
    throw new Error('Unexpected GitHub URL: ' + url);
  };
}

test('GitHub service normalizes live API data and caches it', async (t) => {
  const { config, db } = createTestContext(t, {
    github: { token: 'secret-github-token', enrich: false },
    projects: [
      {
        id: 'alpha',
        name: 'Alpha',
        description: 'Configured description',
        github: { owner: 'octocat', repo: 'alpha' },
        website: 'https://alpha.test/',
        api: null,
        order: 1,
        visible: true,
        featured: true
      }
    ]
  });
  const now = new Date('2026-11-07T12:00:00.000Z');
  const calls = [];
  const service = createGitHubService({
    config,
    db,
    logger: silentLogger(),
    fetchFn: mockGitHub(now, calls),
    now: () => now
  });

  const overview = await service.getOverview();
  assert.equal(overview.profile.login, 'octocat');
  assert.equal(overview.totals.publicRepos, 165);
  assert.equal(overview.totals.trackedRepos, 1);
  assert.equal(overview.totals.stars, 12);
  assert.equal(overview.totals.forks, 3);
  assert.equal(overview.languages[0].name, 'JavaScript');
  assert.equal(overview.recentCommits[0].message, 'Add a real feature');
  assert.equal(overview.recentCommits[0].sha, 'abcdef1');
  assert.equal(overview.rateLimit.authenticated, true);
  assert.equal(overview.rateLimit.remaining, 4999);

  const repos = await service.getRepositories();
  assert.equal(repos.repositories[0].latestCommit.sha, 'fedcba9');
  assert.equal(repos.repositories[0].website, 'https://alpha.test');
  assert.equal(JSON.stringify(overview).includes('secret-github-token'), false);
  assert.ok(calls.some((call) => call.headers.Authorization === 'Bearer secret-github-token'));

  const countAfterFirst = calls.length;
  await service.getActivity();
  assert.equal(calls.length, countAfterFirst, 'fresh cached summary should not refetch GitHub');
});

test('GitHub service falls back to cached data when the API fails', async (t) => {
  const { config, db } = createTestContext(t, {
    projects: [
      {
        id: 'alpha',
        name: 'Alpha',
        description: 'Test',
        github: { owner: 'octocat', repo: 'alpha' },
        website: 'https://alpha.test/',
        api: null,
        order: 1,
        visible: true,
        featured: true
      }
    ]
  });
  const now = new Date('2026-11-07T12:00:00.000Z');
  const calls = [];
  const first = createGitHubService({
    config,
    db,
    logger: silentLogger(),
    fetchFn: mockGitHub(now, calls),
    now: () => now
  });
  const fresh = await first.getOverview();

  const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const stale = createGitHubService({
    config,
    db,
    logger: silentLogger(),
    fetchFn: async () => { throw new Error('offline'); },
    now: () => later
  });
  const cached = await stale.getOverview();
  assert.equal(cached.generatedAt, fresh.generatedAt);
  assert.equal(cached.totals.stars, 12);
});
