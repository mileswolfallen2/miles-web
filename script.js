(() => {
  const USR = 'mileswolfallen2';

  const ASCII = `
 ██╗   ██╗██████╗  ██████╗ ███████╗██╗      ██████╗ ██╗    ██╗
 ██║   ██║██╔══██╗██╔═══██╗██╔════╝██║     ██╔═══██╗██║    ██║
 ██║   ██║██████╔╝██║   ██║███████╗██║     ██║   ██║██║ █╗ ██║
 ██║   ██║██╔══██╗██║   ██║╚════██║██║     ██║   ██║██║███╗██║
 ╚██████╔╝██║  ██║╚██████╔╝███████║███████╗╚██████╔╝╚███╔███╔╝
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝ ╚═════╝  ╚══╝╚══╝`.trim();

  const bootLines = [
    'BIOS v4.0 — Miles Systems Inc.',
    'Copyright (c) 2026 Miles Allen',
    '',
    'Memory Test: 640K OK',
    'Detecting hardware...',
    '  CPU: Developer Core™ @ 3.5GHz',
    '  GPU: Pixel Renderer v2.0',
    '  RAM: 640K Conventional + 384K Extended',
    '  HDD: 42 Repos Detected',
    '',
    'Loading MILES.EXE...',
    '  [████████████████████████] 100%',
    '',
    'Connecting to GitHub API...',
    '  Status: CONNECTED',
    '',
    'Connecting to FEDL Server...',
    '  Status: ONLINE',
    '',
    'Initializing Portfolio v4.0...',
    '  Rendering interface... DONE',
    '',
    'System Ready. Type HELP for commands.',
    '> Starting MILES.EXE...'
  ];

  const bootScreen = document.getElementById('boot-screen');
  const bootText = document.getElementById('boot-text');
  const site = document.getElementById('site');
  let bootIndex = 0;

  function typeBoot() {
    if (bootIndex >= bootLines.length) {
      setTimeout(() => {
        bootScreen.classList.add('done');
        site.classList.remove('hidden');
        initSite();
      }, 300);
      return;
    }
    bootText.textContent += (bootIndex === 0 ? '' : '\n') + bootLines[bootIndex];
    bootIndex++;
    const delay = bootLines[bootIndex - 1] === '' ? 200 : bootLines[bootIndex - 1].startsWith('  [') ? 20 : 60;
    setTimeout(typeBoot, delay);
  }
  setTimeout(typeBoot, 400);

  // ═══════════ SITE INIT ═══════════
  function initSite() {
    renderAsciiArt();
    renderSkills();
    renderTools();
    loadGitHub();
    loadFEDL();
    startClock();
    initNav();
    initScrollSpy();
    initFilters();
  }

  // ═══════════ ASCII ART ═══════════
  function renderAsciiArt() {
    const el = document.getElementById('ascii-art');
    if (!el) return;
    el.textContent = ASCII;
  }

  // ═══════════ CLOCK ═══════════
  function startClock() {
    const el = document.getElementById('menu-clock');
    function tick() {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ═══════════ NAVIGATION ═══════════
  function initNav() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const target = link.getAttribute('href').slice(1);
        document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // ═══════════ SCROLL SPY ═══════════
  let spyTicking = false;
  function initScrollSpy() {
    const sections = document.querySelectorAll('.section');
    const links = document.querySelectorAll('.nav-link');
    function update() {
      const scrollY = window.scrollY + 120;
      let current = 'home';
      sections.forEach(sec => {
        if (sec.offsetTop <= scrollY) current = sec.id;
      });
      links.forEach(l => {
        const isActive = l.dataset.section === current;
        l.classList.toggle('active', isActive);
      });
      sections.forEach(sec => {
        sec.classList.toggle('active-section', sec.id === current);
      });
      spyTicking = false;
    }
    window.addEventListener('scroll', () => {
      if (!spyTicking) { spyTicking = true; requestAnimationFrame(update); }
    });
    setTimeout(update, 100);
  }

  // ═══════════ GITHUB API ═══════════
  async function loadGitHub() {
    try {
      const userRes = await fetch(`https://api.github.com/users/${USR}`);
      if (!userRes.ok) throw new Error(userRes.status);
      const user = await userRes.json();

      animateNum('stat-repos', user.public_repos || 0, 147);
      animateNum('stat-followers', user.followers || 0, 12);
      animateNum('stat-gists', user.public_gists || 0, 1);
      document.getElementById('stat-joined').textContent = new Date(user.created_at).getFullYear().toString();
      animateBar('bar-joined', 80);

      const reposRes = await fetch(`https://api.github.com/users/${USR}/repos?per_page=100&sort=updated`);
      if (!reposRes.ok) throw new Error(reposRes.status);
      const repos = await reposRes.json();

      let totalStars = 0, totalForks = 0;
      repos.forEach(r => { totalStars += r.stargazers_count || 0; totalForks += r.forks_count || 0; });

      animateNum('stat-stars', totalStars, 50);
      animateNum('stat-forks', totalForks, 30);
      animateBar('bar-repos', Math.min(100, (user.public_repos / 150) * 100));
      animateBar('bar-stars', Math.min(100, totalStars * 10));
      animateBar('bar-forks', Math.min(100, totalForks * 10));
      animateBar('bar-followers', Math.min(100, (user.followers / 20) * 100));
      animateBar('bar-gists', Math.min(100, user.public_gists * 20));

      try {
        const eventsRes = await fetch(`https://api.github.com/users/${USR}/events/public?per_page=15`);
        if (eventsRes.ok) {
          const events = await eventsRes.json();
          renderActivity(events.slice(0, 10));
        }
      } catch (e) { /* skip */ }

      renderProjects(repos);
      document.getElementById('sb-status').textContent = 'GitHub API: Connected (' + repos.length + ' repos)';
    } catch (err) {
      document.getElementById('sb-status').textContent = 'GitHub API: Error — retrying...';
      document.getElementById('activity-log').innerHTML = `<div class="log-line dim">&gt; API error: ${err.message}</div>`;
      setTimeout(loadGitHub, 30000);
    }
  }

  // ═══════════ FEDL API ═══════════
  const FEDL_BASE = 'https://server.fedl.site/fedl';

  async function loadFEDL() {
    try {
      const [listRes, runsRes, ghRes] = await Promise.allSettled([
        fetch(`${FEDL_BASE}/api/list`),
        fetch(`${FEDL_BASE}/api/runs`),
        fetch(`https://api.github.com/repos/${USR}/fedl`)
      ]);

      if (listRes.status === 'fulfilled' && listRes.value.ok) {
        const listData = await listRes.value.json();
        const levels = listData.items || [];
        animateNum('fedl-levels', levels.length, 30);
        const firstLevel = levels[0];
        if (firstLevel) {
          document.getElementById('fedl-top1').textContent =
            (firstLevel.title || firstLevel.name || '').slice(0, 14) || '#1';
        }
      }

      if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
        const runsData = await runsRes.value.json();
        const runs = runsData.items || [];
        const verified = runs.filter(r => r.status === 'approved');
        animateNum('fedl-runs', verified.length, 25);

        const playerCounts = {};
        verified.forEach(r => {
          const name = r.playerName || r.player || 'Unknown';
          playerCounts[name] = (playerCounts[name] || 0) + 1;
        });
        const topPlayer = Object.entries(playerCounts).sort((a, b) => b[1] - a[1])[0];
        if (topPlayer) {
          document.getElementById('fedl-topplayer').textContent =
            topPlayer[0].slice(0, 14);
        }
        animateNum('fedl-players', Object.keys(playerCounts).length, 20);

        const sorted = [...verified].sort((a, b) =>
          new Date(b.reviewedAt || b.submittedAt || 0) - new Date(a.reviewedAt || a.submittedAt || 0)
        );
        if (sorted[0]) {
          const date = sorted[0].reviewedAt || sorted[0].submittedAt;
          document.getElementById('fedl-updated').textContent = date ? getTimeAgo(date) : 'recently';
        }
      }

      if (ghRes.status === 'fulfilled' && ghRes.value.ok) {
        const gh = await ghRes.value.json();
        animateNum('fedl-stars', gh.stargazers_count || 0, 30);
        document.getElementById('fedl-lang').textContent = gh.language || 'HTML';
        if (!document.getElementById('fedl-updated').textContent ||
            document.getElementById('fedl-updated').textContent === '—') {
          document.getElementById('fedl-updated').textContent = getTimeAgo(gh.pushed_at);
        }
      }
    } catch (err) {
      console.error('FEDL load error:', err);
    }
  }

  // ═══════════ RENDER ═══════════
  function renderActivity(events) {
    const log = document.getElementById('activity-log');
    log.innerHTML = events.map(e => {
      let dot = 'other', msg = e.type;
      if (e.type === 'PushEvent') { dot = 'push'; msg = `Push ${e.payload.commits?.length || 0} commit(s)`; }
      else if (e.type === 'CreateEvent') { dot = 'create'; msg = `Create ${e.payload.ref_type}`; }
      else if (e.type === 'DeleteEvent') { msg = `Delete ${e.payload.ref_type}`; }
      else if (e.type === 'IssuesEvent') { msg = `${e.payload.action} issue`; }
      else if (e.type === 'WatchEvent') { msg = 'Star'; }
      else if (e.type === 'ForkEvent') { msg = 'Fork'; }
      else if (e.type === 'PullRequestEvent') { msg = `${e.payload.action} PR`; }
      return `<div class="log-line">
        <span class="log-dot ${dot}"></span>
        <span class="log-repo">${(e.repo?.name || '').replace(USR + '/', '')}</span>
        <span class="log-msg">${msg}</span>
        <span class="log-time">${getTimeAgo(e.created_at)}</span>
      </div>`;
    }).join('');
  }

  const SITE_URLS = {
    'fedl': 'https://fedl.site',
    'miles-web': 'https://me.fedl.site',
    'OmniEmu2.0': 'https://github.com/mileswolfallen2/OmniEmu2.0',
    'moon-gaming': 'https://moon-gaming.vercel.app',
    'linuxWeb': 'https://linuxweb.vercel.app',
    'FNFHTML5': 'https://fnfhtml5.pages.dev',
    'fun-miles-lancher': 'https://github.com/mileswolfallen2/fun-miles-lancher',
    'goplayer': 'https://github.com/mileswolfallen2/goplayer'
  };

  const PINNED = ['OmniEmu2.0', 'fedl', 'moon-gaming', 'miles-web'];
  const ICONS = {
    'OmniEmu2.0': '🎮', 'fedl': '🎯', 'moon-gaming': '🌙', 'miles-web': '🌐',
    'linuxWeb': '🐧', 'FNFHTML5': '🎵', 'fun-miles-lancher': '🚀',
    'the-start-of-the-thing': '⭐', 'for-a-frend': '🤝', 'v86-wasmless': '💻',
    'goplayer': '🎶', 'open-fl-test': '🧪', 'A1R': '✈️'
  };

  function renderProjects(repos) {
    const list = document.getElementById('projects-list');

    const sorted = repos.sort((a, b) => {
      const ai = PINNED.indexOf(a.name), bi = PINNED.indexOf(b.name);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return (b.stargazers_count || 0) - (a.stargazers_count || 0);
    }).slice(0, 20);

    list.innerHTML = sorted.map(r => {
      const icon = ICONS[r.name] || '📁';
      const desc = r.description || 'No description.';
      const isFork = r.fork;
      const url = SITE_URLS[r.name] || r.homepage || `https://github.com/${USR}/${r.name}`;
      return `<a href="${url}" target="_blank" class="project-row" data-type="${isFork ? 'fork' : 'original'}">
        <span class="pr-icon">${icon}</span>
        <div class="pr-info">
          <div class="pr-name">${r.name}</div>
          <div class="pr-desc">${desc}</div>
        </div>
        <div class="pr-meta">
          ${r.language ? `<span class="pr-tag lang">${r.language}</span>` : ''}
          ${r.stargazers_count > 0 ? `<span class="pr-tag stars">★ ${r.stargazers_count}</span>` : ''}
          ${isFork ? `<span class="pr-tag fork">FORK</span>` : ''}
        </div>
        <span class="pr-link">OPEN →</span>
      </a>`;
    }).join('');
  }

  // ═══════════ FILTERS ═══════════
  function initFilters() {
    document.querySelectorAll('.pf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        document.querySelectorAll('.project-row').forEach(row => {
          if (filter === 'all') { row.style.display = ''; return; }
          row.style.display = row.dataset.type === filter ? '' : 'none';
        });
      });
    });
  }

  // ═══════════ SKILLS ═══════════
  function renderSkills() {
    const skills = [
      { name: 'Python', pct: 80, color: 'green' },
      { name: 'JavaScript', pct: 75, color: 'amber' },
      { name: 'C++', pct: 55, color: 'cyan' },
      { name: 'HTML/CSS', pct: 85, color: 'green' },
      { name: 'React', pct: 60, color: 'purple' },
      { name: 'Node.js', pct: 65, color: 'green' },
      { name: 'Git', pct: 80, color: 'cyan' },
      { name: 'Linux', pct: 75, color: 'amber' }
    ];
    document.getElementById('skills-list').innerHTML = skills.map(s =>
      `<div class="skill-row">
        <div class="skill-name">${s.name}</div>
        <div class="skill-bar"><div class="skill-fill ${s.color}" data-pct="${s.pct}"></div></div>
        <div class="skill-pct">${s.pct}%</div>
      </div>`
    ).join('');

    setTimeout(() => {
      document.querySelectorAll('.skill-fill').forEach(f => { f.style.width = f.dataset.pct + '%'; });
    }, 300);
  }

  function renderTools() {
    const tools = ['VS Code', 'Git', 'GitHub', 'Replit', 'Node.js', 'Electron', 'Linux', 'Firefox DevTools', 'Figma', 'Docker', 'SQLite', 'Geode'];
    document.getElementById('tools-grid').innerHTML = tools.map(t =>
      `<span class="tool-chip">${t}</span>`
    ).join('');
  }

  // ═══════════ UTILITIES ═══════════
  function animateNum(id, target, speed) {
    const el = document.getElementById(id);
    if (!el) return;
    let current = 0;
    const steps = speed || 30;
    const step = Math.max(1, Math.floor(target / steps));
    const interval = setInterval(() => {
      current += step;
      if (current >= target) { current = target; clearInterval(interval); }
      el.textContent = current.toLocaleString();
    }, 30);
  }

  function animateBar(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => { el.style.width = pct + '%'; }, 200);
  }

  function getTimeAgo(dateStr) {
    const now = new Date();
    const then = new Date(dateStr);
    const mins = Math.floor((now - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  setInterval(() => { loadGitHub(); loadFEDL(); }, 300000);
})();