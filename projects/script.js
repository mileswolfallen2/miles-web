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

  /* CURSOR */
  (function(){
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    if (!dot || !ring) return;
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
    document.querySelectorAll('a, button, .meta-chip, .tech-badge, .feature-card, .proj-card, .blog-card, .hl-cell, .term-btn, .chip').forEach(function(el){
      el.addEventListener('mouseenter', function(){ dot.classList.add('hover'); ring.classList.add('hover'); });
      el.addEventListener('mouseleave', function(){ dot.classList.remove('hover'); ring.classList.remove('hover'); });
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
    updateIcon();
    btn.addEventListener('click', function(){
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      updateIcon();
    });
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
    });
  })();
})();
