(() => {
  'use strict';

  const SHUFFLE_INTERVAL = 7000;

  const layers = [...document.querySelectorAll('.hero-bg-layer')];
  const FALLBACK_MEDIA = ['1.webm', '2.webm', '3.webm', '4.webm', '5.webm', '6.webm'];

  let media = FALLBACK_MEDIA;
  let current = -1;
  let active = 0;

  const randomIndex = (exclude) => {
    if (media.length <= 1) return 0;
    let i;
    do {
      i = Math.floor(Math.random() * media.length);
    } while (i === exclude);
    return i;
  };

  const startNext = (preloadOnly) => {
    const next = randomIndex(current);
    const nextLayer = layers[(active + 1) % 2];
    const video = nextLayer.querySelector('video');

    video.src = 'assets/' + media[next];
    video.onloadeddata = () => {
      if (!preloadOnly) {
        layers[active].classList.remove('is-active');
        nextLayer.classList.add('is-active');
        active = (active + 1) % 2;
        current = next;
        video.play().catch(() => {});
      }
    };
    video.onerror = () => {
      if (!preloadOnly) current = next;
    };
  };

  const initShuffle = () => {
    if (!layers.length) return;

    layers.forEach((layer) => {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('aria-hidden', 'true');
      layer.appendChild(video);
    });

    const start = randomIndex(-1);
    const video = layers[0].querySelector('video');
    video.onloadeddata = () => {
      layers[0].classList.add('is-active');
      current = start;
      video.play().catch(() => {});
    };
    video.src = 'assets/' + media[start];

    setInterval(() => startNext(false), SHUFFLE_INTERVAL);
  };

  const initReveal = () => {
    const els = document.querySelectorAll('.slider, .widget-card, .shots > *, .install-cta');
    els.forEach((el) => el.classList.add('reveal'));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    els.forEach((el) => observer.observe(el));
  };

  const initSmoothScroll = () => {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  };

  const initSlider = () => {
    const slider = document.querySelector('[data-slider]');
    if (!slider) return;

    const slides = [...slider.querySelectorAll('.slider-slide')];
    const prev = slider.querySelector('.slider-prev');
    const next = slider.querySelector('.slider-next');
    const dotsWrap = slider.querySelector('.slider-dots');
    let idx = 0;
    let advanceTimer = null;

    const dots = slides.map((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'slider-dot';
      dot.type = 'button';
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      dot.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(dot);
      return dot;
    });

    const clearAdvance = () => {
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }
    };

    const scheduleAdvance = (video) => {
      clearAdvance();
      if (!video) return;
      video.onended = () => goTo(idx + 1);
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 15;
      advanceTimer = setTimeout(() => goTo(idx + 1), dur * 1000);
    };

    const goTo = (i) => {
      clearAdvance();
      idx = (i + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle('is-active', j === idx));
      dots.forEach((d, j) => d.classList.toggle('is-active', j === idx));

      slides.forEach((s, j) => {
        const video = s.querySelector('video');
        if (!video) return;
        if (j === idx) {
          video.pause();
          video.currentTime = 0;
          video.play().catch(() => {}).then(() => scheduleAdvance(video));
        } else {
          video.pause();
        }
      });
    };

    prev.addEventListener('click', () => goTo(idx - 1));
    next.addEventListener('click', () => goTo(idx + 1));

    slider.addEventListener('mouseenter', clearAdvance);
    slider.addEventListener('mouseleave', () => {
      const video = slides[idx].querySelector('video');
      if (video) scheduleAdvance(video);
    });

    goTo(0);
  };

  document.addEventListener('DOMContentLoaded', () => {
    initReveal();
    initSmoothScroll();
    initSlider();
    initShuffle();
  });
})();
