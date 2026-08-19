(function(){
  /* TOAST SYSTEM */
  const toastQueue = document.getElementById('toastStack');
  const shownToasts = {};
  window.showToast = function(id, title, body, icon){
    if (shownToasts[id]) return;
    shownToasts[id] = true;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span class="icon">' + (icon || '!') + '</span><span><span class="title">' + title + '</span>' + body + '</span>';
    toastQueue.appendChild(t);
    if (window.gsap) {
      window.gsap.to(t, { x: 0, duration: 0.6, ease: 'power3.out' });
      setTimeout(function(){
        window.gsap.to(t, { x: '-150%', opacity: 0, duration: 0.4, ease: 'power2.in', onComplete: function(){ t.remove(); } });
      }, 3000);
    }
  };

  /* KONAMI CODE */
  (function(){
    const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
    let pos = 0;
    window.addEventListener('keydown', function(e){
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === seq[pos]) {
        pos++;
        if (pos === seq.length) {
          pos = 0;
          triggerKonami();
        }
      } else {
        pos = (key === seq[0]) ? 1 : 0;
      }
    });
    function triggerKonami(){
      try { window.showToast('konami', 'SECRET FOUND', 'Konami Code Activated', '*'); } catch(e) {}
      const flash = document.getElementById('flash');
      if (flash && window.gsap) {
        window.gsap.fromTo(flash, { opacity: 0.5 }, { opacity: 0, duration: 0.5 });
      }
      if (window.gsap) {
        window.gsap.to('body', { x: 'random(-5,5)', y: 'random(-5,5)', duration: 0.05, repeat: 10, ease: 'sine.inOut', onComplete: function(){ window.gsap.set('body', { x: 0, y: 0 }); } });
      }
      document.body.style.cursor = 'auto';
      let s = document.getElementById('konami-cursor');
      if (!s) {
        s = document.createElement('style');
        s.id = 'konami-cursor';
        document.head.appendChild(s);
      }
      s.textContent = '*{cursor:auto !important;}';
    }
  })();

  /* MUSIC PAGE EASTER EGG: A, B, ←, →, ←, →, ↓, ↓, ↑, ↑ */
  (function(){
    const seq = ['a','b','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','ArrowDown','ArrowDown','ArrowUp','ArrowUp'];
    let pos = 0;
    window.addEventListener('keydown', function(e){
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === seq[pos]) {
        pos++;
        if (pos === seq.length) {
          pos = 0;
          window.location.href = '/music.html';
        }
      } else {
        pos = (key === seq[0]) ? 1 : 0;
      }
    });
  })();

  /* GAMES PAGE EASTER EGG: g, a, m, e, s */
  (function(){
    const seq = ['g','a','m','e','s'];
    let pos = 0;
    window.addEventListener('keydown', function(e){
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === seq[pos]) {
        pos++;
        if (pos === seq.length) {
          pos = 0;
          window.location.href = '/games.html';
        }
      } else {
        pos = (key === seq[0]) ? 1 : 0;
      }
    });
  })();

  /* CURSOR */
  (function(){
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    if (!dot || !ring) return;
    document.body.classList.add('custom-cursor-enabled');
    let mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', function(e){
      mx = e.clientX;
      my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top = my + 'px';
    });
    (function loop(){
      rx += (mx - rx) * 0.15;
      ry += (my - ry) * 0.15;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      requestAnimationFrame(loop);
    })();
    document.addEventListener('mouseover', function(e){
      const t = e.target.closest('a, button, input, textarea, select, [role="button"], .meta-chip, .tech-badge, .feature-card, .proj-card, .blog-card, .hl-cell, .term-btn, .chip');
      dot.classList.toggle('hover', !!t);
      ring.classList.toggle('hover', !!t);
    });
  })();

  /* PROGRESS BAR */
  (function(){
    const bar = document.getElementById('progressBar');
    if (!bar) return;
    window.addEventListener('scroll', function(){
      const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100;
      bar.style.width = pct + '%';
    }, { passive: true });
  })();

  /* DESIGN LANGUAGE SYSTEM */
  (function(){
    const THEMES = [
      { id: 'minimal',    label: 'Minimal',    desc: 'Clean and calm — made for business.',   emoji: '\u2600' },
      { id: 'default',    label: 'Default',    desc: 'The original glitchy retro terminal.',   emoji: '\u2728' },
      { id: 'maximalist', label: 'Maximalist', desc: 'Loud, chunky, poster-heavy.',            emoji: '\ud83c\udf1f' },
      { id: 'synthwave',  label: 'Neon',       desc: 'Synthwave glow — retro futurescape.',   emoji: '\ud83c\udf06' },
      { id: 'phosphor',   label: 'Phosphor',   desc: 'CRT green terminal with scanlines.',    emoji: '\ud83d\udda5' },
      { id: 'chrome',     label: 'Chrome',     desc: 'Mono brutalist — black & white only.',  emoji: '\u2b1b' },
      { id: 'paper',      label: 'Paper',      desc: 'Warm light mode with serif ink.',       emoji: '\ud83d\udcc4' }
    ];
    const ORDER = ['default', 'minimal', 'maximalist', 'synthwave', 'phosphor', 'chrome', 'paper'];
    const THEME_CLASSES = ['clean', 'maximalist', 'synthwave', 'phosphor', 'chrome', 'paper'];

    function currentTheme(){
      const s = localStorage.getItem('theme');
      if (s === 'clean') return 'minimal';
      if (s === 'dark') return 'default';
      if (THEMES.some(t => t.id === s)) return s;
      return 'default';
    }

    function applyTheme(theme){
      THEME_CLASSES.forEach(c => document.body.classList.remove(c));
      if (theme === 'minimal') document.body.classList.add('clean');
      if (theme === 'maximalist' || theme === 'synthwave' || theme === 'phosphor' || theme === 'chrome' || theme === 'paper') {
        document.body.classList.add(theme);
      }
      localStorage.setItem('theme', theme);
      loadDesignFonts();
      updateToggle();
    }

    function loadDesignFonts(){
      if (document.getElementById('design-fonts')) return;
      const link = document.createElement('link');
      link.id = 'design-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=Permanent+Marker&family=Space+Mono:wght@400;700&family=Orbitron:wght@500;700;900&family=VT323&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Caveat:wght@500;600;700&family=Patrick+Hand&display=swap';
      document.head.appendChild(link);
    }

    function updateToggle(){
      const btn = document.getElementById('themeToggle');
      if (!btn) return;
      const t = THEMES.filter(x => x.id === currentTheme())[0] || THEMES[1];
      btn.textContent = t.emoji;
      btn.title = 'Design: ' + t.label + ' — click to change';
    }

    const DESIGN_CSS = '' +
      '.design-picker{position:fixed;inset:0;z-index:20000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.88);backdrop-filter:blur(6px);padding:20px;}' +
      '.design-picker.open{display:flex;}' +
      '.design-picker .dp-card{background:#0a0a0a;border:6px solid #f4ff2e;box-shadow:14px 14px 0 #ff1a7e;max-width:660px;width:100%;padding:34px;font-family:"Space Mono",monospace;color:#f7f4ea;text-align:center;}' +
      '.design-picker .dp-kicker{font-family:"Bebas Neue",sans-serif;font-size:16px;letter-spacing:3px;color:#ff1a7e;text-transform:uppercase;border:3px solid #ff1a7e;padding:4px 14px;display:inline-block;transform:rotate(-2deg);}' +
      '.design-picker .dp-title{font-family:"Archivo Black",sans-serif;font-size:clamp(24px,5vw,36px);text-transform:uppercase;line-height:1;margin:18px 0 8px;color:#f7f4ea;}' +
      '.design-picker .dp-sub{font-size:13px;color:#cfcfc7;line-height:1.6;margin-bottom:26px;}' +
      '.design-picker .dp-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}' +
      '.design-picker .dp-option{border:4px solid #f7f4ea;background:#111;color:#f7f4ea;padding:18px 14px;cursor:pointer;text-align:left;transition:transform .12s,box-shadow .12s;font-family:"Space Mono",monospace;}' +
      '.design-picker .dp-option:hover{transform:translate(-3px,-3px);box-shadow:8px 8px 0 #00c2ff;}' +
      '.design-picker .dp-option.active{border-color:#ff1a7e;box-shadow:8px 8px 0 #ff1a7e;transform:translate(-2px,-2px);}' +
      '.design-picker .dp-swatch{display:flex;align-items:center;justify-content:center;height:70px;margin-bottom:12px;border:3px solid #0a0a0a;}' +
      '.design-picker .dp-swatch.dp-minimal{background:#18181e;}' +
      '.design-picker .dp-swatch.dp-default{background:#000;box-shadow:0 0 0 2px #f7f4ea,0 0 20px rgba(255,61,154,0.5);}' +
      '.design-picker .dp-swatch.dp-maximalist{background:linear-gradient(135deg,#ff1a7e 0 25%,#f4ff2e 25% 50%,#00c2ff 50% 75%,#ff2b0a 75% 100%);}' +
      '.design-picker .dp-swatch.dp-synthwave{background:linear-gradient(180deg,#1a0b3d 0 40%,#ff2e97 40% 60%,#00e5ff 60% 80%,#0d0a24 80% 100%);box-shadow:0 0 0 2px #ff2e97,0 0 18px rgba(255,46,151,0.6);}' +
      '.design-picker .dp-swatch.dp-phosphor{background:radial-gradient(circle at 50% 30%,#0a2b16,#000 70%);box-shadow:0 0 0 2px #39ff6c,0 0 14px rgba(57,255,108,0.5);}' +
      '.design-picker .dp-swatch.dp-chrome{background:linear-gradient(135deg,#000 0 50%,#fff 50% 100%);box-shadow:0 0 0 2px #fff;}' +
      '.design-picker .dp-swatch.dp-paper{background:#f4f1e8;box-shadow:0 0 0 2px #1b1917;}' +
      '.design-picker .dp-swatch .dp-mark{width:14px;height:14px;background:#fff;box-shadow:4px 4px 0 #f4ff2e;border:2px solid #0a0a0a;}' +
      '.design-picker .dp-name{display:block;font-family:"Bebas Neue",sans-serif;font-size:22px;letter-spacing:1px;text-transform:uppercase;color:#f7f4ea;}' +
      '.design-picker .dp-desc{display:block;font-size:11px;color:#cfcfc7;margin-top:4px;line-height:1.4;}';

    function ensurePicker(){
      if (document.getElementById('designPicker')) return;
      const style = document.createElement('style');
      style.textContent = DESIGN_CSS;
      document.head.appendChild(style);
      const wrap = document.createElement('div');
      wrap.id = 'designPicker';
      wrap.className = 'design-picker';
      wrap.innerHTML = '<div class="dp-card">' +
        '<span class="dp-kicker">Choose a design</span>' +
        '<h2 class="dp-title">How should this site look?</h2>' +
        '<p class="dp-sub">Pick a design language. You can switch anytime with the button in the corner.</p>' +
        '<div class="dp-options">' + THEMES.map(t =>
          '<button class="dp-option" data-theme="' + t.id + '">' +
            '<span class="dp-swatch dp-' + t.id + '"><span class="dp-mark"></span></span>' +
            '<span class="dp-name">' + t.label + '</span>' +
            '<span class="dp-desc">' + t.desc + '</span>' +
          '</button>').join('') +
        '</div></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function(e){
        if (e.target.classList.contains('design-picker')) { closePicker(true); return; }
        const opt = e.target.closest('.dp-option');
        if (opt) {
          const theme = opt.getAttribute('data-theme');
          applyTheme(theme);
          closePicker(false);
          const label = THEMES.filter(x => x.id === theme)[0].label;
          try { window.showToast('design', 'DESIGN', 'Switched to ' + label, '!'); } catch(err) {}
        }
      });
      window.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && wrap.classList.contains('open')) closePicker(true);
      });
    }

    function openPicker(){
      ensurePicker();
      const wrap = document.getElementById('designPicker');
      wrap.classList.add('open');
      const cur = currentTheme();
      wrap.querySelectorAll('.dp-option').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-theme') === cur);
      });
    }

    function closePicker(dismissed){
      const wrap = document.getElementById('designPicker');
      if (wrap) wrap.classList.remove('open');
      if (dismissed && !localStorage.getItem('theme')) localStorage.setItem('theme', 'default');
    }

    const hasSaved = localStorage.getItem('theme') !== null;
    applyTheme(currentTheme());
    if (!hasSaved) setTimeout(openPicker, 400);

    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', openPicker);

    window.openDesignPicker = openPicker;
    window.toggleTheme = function(){
      const cur = currentTheme();
      applyTheme(ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]);
    };
  })();

  /* SECRET HINT: inject into shortcut modal */
  (function(){
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    const card = modal.querySelector('.shortcut-card');
    if (card && !card.querySelector('.secret-hint')) {
      const hint = document.createElement('div');
      hint.className = 'secret-hint';
      hint.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:#666;text-align:center;padding:8px 0 4px;border-top:1px solid rgba(255,255,255,0.06);margin-top:6px;letter-spacing:.06em;';
      hint.textContent = '· · · AB \u2190 \u2192 \u2190 \u2192 \u2193 \u2193 \u2191 \u2191';
      const close = card.querySelector('.close-hint');
      if (close) card.insertBefore(hint, close);
      else card.appendChild(hint);
    }
  })();

  /* KEYBOARD SHORTCUTS (shared) */
  (function(){
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    function toggleModal(){ modal.classList.toggle('open'); }
    modal.addEventListener('click', function(e){ if (e.target === modal) modal.classList.remove('open'); });
    window.addEventListener('keydown', function(e){
      if (e.key === '?') { e.preventDefault(); toggleModal(); }
      if (e.key === 'Escape') modal.classList.remove('open');
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (window.toggleTheme) window.toggleTheme();
      }
    });
  })();
})();
