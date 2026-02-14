/* ============================================
   OrbitOS - Animated Star Field Background
   Canvas-based particle system with nebula feel
   ============================================ */

(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let stars = [];
  let shootingStars = [];
  let animationId;
  let mouseX = -1000;
  let mouseY = -1000;

  const STAR_COUNT = 180;
  const SHOOTING_STAR_INTERVAL = 4000;

  // Colors matching the OrbitOS palette
  const starColors = [
    'rgba(167, 139, 250, ',  // accent violet
    'rgba(196, 181, 253, ',  // light violet
    'rgba(34, 211, 238, ',   // cyan
    'rgba(244, 114, 182, ',  // pink
    'rgba(240, 238, 246, ',  // white
    'rgba(56, 189, 248, ',   // sky blue
  ];

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createStar() {
    const colorBase = starColors[Math.floor(Math.random() * starColors.length)];
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.8 + 0.3,
      color: colorBase,
      alpha: Math.random() * 0.6 + 0.2,
      alphaSpeed: (Math.random() * 0.008 + 0.002) * (Math.random() > 0.5 ? 1 : -1),
      alphaMin: 0.1,
      alphaMax: 0.8,
      vx: (Math.random() - 0.5) * 0.08,
      vy: (Math.random() - 0.5) * 0.06,
    };
  }

  function createShootingStar() {
    const startX = Math.random() * width * 0.8;
    const startY = Math.random() * height * 0.4;
    return {
      x: startX,
      y: startY,
      length: Math.random() * 60 + 40,
      speed: Math.random() * 4 + 3,
      angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
      alpha: 1,
      decay: 0.015 + Math.random() * 0.01,
      width: Math.random() * 1.5 + 0.5,
    };
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push(createStar());
    }
  }

  function drawStar(star) {
    // Subtle mouse interaction — stars near cursor glow slightly brighter
    const dx = star.x - mouseX;
    const dy = star.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const mouseFactor = dist < 120 ? 1 + (1 - dist / 120) * 0.5 : 1;

    const alpha = Math.min(star.alphaMax, star.alpha * mouseFactor);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size * mouseFactor, 0, Math.PI * 2);
    ctx.fillStyle = star.color + alpha + ')';
    ctx.fill();

    // Subtle glow for brighter stars
    if (star.size > 1.2) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size * 2.5 * mouseFactor, 0, Math.PI * 2);
      ctx.fillStyle = star.color + (alpha * 0.15) + ')';
      ctx.fill();
    }
  }

  function drawShootingStar(s) {
    const tailX = s.x - Math.cos(s.angle) * s.length;
    const tailY = s.y - Math.sin(s.angle) * s.length;

    const gradient = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
    gradient.addColorStop(0, 'rgba(167, 139, 250, 0)');
    gradient.addColorStop(0.6, 'rgba(196, 181, 253, ' + s.alpha * 0.4 + ')');
    gradient.addColorStop(1, 'rgba(255, 255, 255, ' + s.alpha + ')');

    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(s.x, s.y);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Bright head
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.width + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + s.alpha + ')';
    ctx.fill();
  }

  function update() {
    // Stars
    for (const star of stars) {
      // Twinkle
      star.alpha += star.alphaSpeed;
      if (star.alpha >= star.alphaMax || star.alpha <= star.alphaMin) {
        star.alphaSpeed *= -1;
      }
      star.alpha = Math.max(star.alphaMin, Math.min(star.alphaMax, star.alpha));

      // Gentle drift
      star.x += star.vx;
      star.y += star.vy;

      // Wrap around
      if (star.x < -10) star.x = width + 10;
      if (star.x > width + 10) star.x = -10;
      if (star.y < -10) star.y = height + 10;
      if (star.y > height + 10) star.y = -10;
    }

    // Shooting stars
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      s.x += Math.cos(s.angle) * s.speed;
      s.y += Math.sin(s.angle) * s.speed;
      s.alpha -= s.decay;
      if (s.alpha <= 0 || s.x > width + 100 || s.y > height + 100) {
        shootingStars.splice(i, 1);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const star of stars) {
      drawStar(star);
    }
    for (const s of shootingStars) {
      drawShootingStar(s);
    }
  }

  function loop() {
    update();
    draw();
    animationId = requestAnimationFrame(loop);
  }

  // Init
  resize();
  initStars();
  loop();

  // Periodic shooting stars
  setInterval(() => {
    if (shootingStars.length < 2) {
      shootingStars.push(createShootingStar());
    }
  }, SHOOTING_STAR_INTERVAL);

  // Resize handler
  window.addEventListener('resize', () => {
    resize();
    initStars();
  });

  // Mouse tracking for interactive glow
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  document.addEventListener('mouseleave', () => {
    mouseX = -1000;
    mouseY = -1000;
  });
})();
