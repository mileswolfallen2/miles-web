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

  /* THEME TOGGLE */
  (function(){
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.body.classList.add('light');
    function updateIcon(){
      btn.textContent = document.body.classList.contains('light') ? '\u263E' : '\u2600';
    }
    function toggleTheme(){
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      updateIcon();
    }
    updateIcon();
    btn.addEventListener('click', toggleTheme);
    window.toggleTheme = toggleTheme;
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
