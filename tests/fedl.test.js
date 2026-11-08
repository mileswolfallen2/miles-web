import test from 'node:test';
import assert from 'node:assert/strict';
import { createFedlService } from '../server/services/fedl.js';
import { createTestContext, jsonResponse, silentLogger } from './helpers.js';

function fedlPayloads() {
  return {
    list: {
      items: [
        { level: 'new', position: '1', title: 'Alpha Demon', url: 'https://youtu.be/a' },
        { level: 'new', position: '2', title: 'Beta Demon', url: 'https://youtu.be/b' },
        { level: 'new', position: '3', title: 'Gamma Demon', url: 'https://youtu.be/c' }
      ]
    },
    runs: {
      items: [
        {
          id: 'run_1',
          playerName: 'player1',
          levelTitle: 'Alpha Demon',
          percent: '100',
          status: 'approved',
          submittedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          videoUrl: 'https://youtu.be/run1'
        },
        {
          id: 'run_2',
          playerName: 'player2',
          levelTitle: 'Beta Demon',
          percent: '75',
          status: 'approved',
          submittedAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T00:00:00.000Z'
        },
        {
          id: 'run_3',
          playerName: 'player3',
          levelTitle: 'Beta Demon',
          percent: '12',
          status: 'rejected',
          submittedAt: '2026-10-19T00:00:00.000Z',
          updatedAt: '2026-10-19T00:00:00.000Z'
        }
      ]
    }
  };
}

test('FEDL service uses the real /list and /runs shapes and diffs snapshots', async (t) => {
  const { config, db } = createTestContext(t, {
    fedl: { apiBase: 'https://fedl.test/fedl/api' }
  });
  const state = fedlPayloads();
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    const value = String(url);
    if (value.endsWith('/list')) return jsonResponse(state.list);
    if (value.endsWith('/runs')) return jsonResponse(state.runs);
    throw new Error('Unexpected FEDL URL ' + url);
  };
  const now = new Date('2026-11-07T12:00:00.000Z');
  const service = createFedlService({
    config,
    db,
    logger: silentLogger(),
    fetchFn,
    now: () => now
  });

  const first = await service.refresh({ force: true });
  assert.equal(calls, 2);
  assert.equal(first.totals.rankedLevels, 3);
  assert.equal(first.totals.records, 2);
  assert.equal(first.totals.rejected, 1);
  assert.equal(first.totals.players, 2);
  assert.equal(first.topLevels[0].title, 'Alpha Demon');
  assert.equal(first.changes.comparedTo, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM fedl_snapshots').get().c, 1);

  state.list.items = [
    { level: 'new', position: '1', title: 'Beta Demon', url: 'https://youtu.be/b' },
    { level: 'new', position: '2', title: 'Alpha Demon', url: 'https://youtu.be/a' },
    { level: 'new', position: '4', title: 'Delta Demon', url: 'https://youtu.be/d' }
  ];
  const second = await service.refresh({ force: true });
  assert.equal(second.changes.counts.added, 1);
  assert.equal(second.changes.counts.removed, 1);
  assert.equal(second.changes.added[0].title, 'Delta Demon');
  assert.equal(second.changes.removed[0].title, 'Gamma Demon');
  assert.equal(second.changes.counts.rankChanges, 2);

  const activity = await service.getActivity();
  assert.equal(activity.changes.counts.added, 1);
  assert.equal(activity.recentRecords[0].id, 'run_1');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM fedl_snapshots').get().c, 2);
});

test('FEDL service serves its last good snapshot when refresh fails', async (t) => {
  const { config, db } = createTestContext(t);
  const state = fedlPayloads();
  const now = new Date('2026-11-07T12:00:00.000Z');
  let good = true;
  const service = createFedlService({
    config,
    db,
    logger: silentLogger(),
    now: () => now,
    fetchFn: async (url) => {
      if (!good) throw new Error('network down');
      if (String(url).endsWith('/list')) return jsonResponse(state.list);
      return jsonResponse(state.runs);
    }
  });

  const first = await service.refresh({ force: true });
  good = false;
  const fallback = await service.refresh({ force: true });
  assert.equal(fallback.generatedAt, first.generatedAt);
  assert.equal(fallback.totals.rankedLevels, 3);
});
