/* ============================================
   OrbitOS - System Kernel
   Auth, Window Manager, Database (Dexie.js)
   ============================================ */

// ─── Database Setup (Dexie.js / IndexedDB) ───
const db = new Dexie('OrbitOS');
db.version(1).stores({
  files: '++id, name, parentId, type, mimeType, createdAt',
  kanban: '++id, title, status, createdAt'
});
db.version(2).stores({
  files: '++id, name, parentId, type, mimeType, createdAt',
  kanban: '++id, title, status, createdAt',
  calendarEvents: '++id, title, date, color, createdAt',
  pomodoroSessions: '++id, type, duration, completedAt'
});

// ─── Utility: Simple Hash ───
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Auth System ───
const Auth = {
  getCurrentUser() {
    return localStorage.getItem('orbitos_currentUser');
  },

  async register(username, password) {
    if (!username || username.length < 3) {
      throw new Error('O nome de usuário deve ter ao menos 3 caracteres.');
    }
    if (!password || password.length < 4) {
      throw new Error('A senha deve ter ao menos 4 caracteres.');
    }

    const users = JSON.parse(localStorage.getItem('orbitos_users') || '{}');
    if (users[username]) {
      throw new Error('Este nome de usuário já está em uso.');
    }

    const hashed = await hashPassword(password);
    users[username] = { passwordHash: hashed, createdAt: Date.now() };
    localStorage.setItem('orbitos_users', JSON.stringify(users));
  },

  async login(username, password) {
    const users = JSON.parse(localStorage.getItem('orbitos_users') || '{}');
    if (!users[username]) {
      throw new Error('Usuário não encontrado.');
    }

    const hashed = await hashPassword(password);
    if (users[username].passwordHash !== hashed) {
      throw new Error('Senha incorreta.');
    }

    localStorage.setItem('orbitos_currentUser', username);
  },

  logout() {
    localStorage.removeItem('orbitos_currentUser');
    WindowManager.closeAll();
    showScreen('login-screen');
  }
};

// ─── Screen Manager ───
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(screenId);
  if (screen) screen.classList.add('active');

  // Toggle body class for background switching
  if (screenId === 'desktop') {
    document.body.classList.add('desktop-active');
  } else {
    document.body.classList.remove('desktop-active');
  }
}

// ─── Window Manager ───
const WindowManager = {
  windows: {},
  zIndex: 100,
  dragState: null,

  init() {
    document.querySelectorAll('.app-window').forEach(win => {
      const app = win.dataset.app;
      this.windows[app] = {
        el: win,
        minimized: false,
        maximized: false
      };

      // Dragging (mouse + touch)
      const header = win.querySelector('.window-header');
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.window-controls')) return;
        if (this.windows[app].maximized) return;
        this.focus(app);
        this.dragState = {
          app,
          startX: e.clientX - win.offsetLeft,
          startY: e.clientY - win.offsetTop
        };
      });
      header.addEventListener('touchstart', (e) => {
        if (e.target.closest('.window-controls')) return;
        if (this.windows[app].maximized) return;
        this.focus(app);
        const touch = e.touches[0];
        this.dragState = {
          app,
          startX: touch.clientX - win.offsetLeft,
          startY: touch.clientY - win.offsetTop
        };
      }, { passive: true });

      // Window controls
      win.querySelectorAll('.win-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action === 'close') this.close(app);
          else if (action === 'minimize') this.minimize(app);
          else if (action === 'maximize') this.toggleMaximize(app);
        });
      });

      // Focus on click
      win.addEventListener('mousedown', () => this.focus(app));
    });

    // Global mouse/touch move/up for dragging
    document.addEventListener('mousemove', (e) => {
      if (!this.dragState) return;
      const win = this.windows[this.dragState.app].el;
      const x = e.clientX - this.dragState.startX;
      const y = e.clientY - this.dragState.startY;
      win.style.left = Math.max(0, x) + 'px';
      win.style.top = Math.max(0, y) + 'px';
    });
    document.addEventListener('touchmove', (e) => {
      if (!this.dragState) return;
      const touch = e.touches[0];
      const win = this.windows[this.dragState.app].el;
      const x = touch.clientX - this.dragState.startX;
      const y = touch.clientY - this.dragState.startY;
      win.style.left = Math.max(0, x) + 'px';
      win.style.top = Math.max(0, y) + 'px';
    }, { passive: true });
    document.addEventListener('mouseup', () => {
      this.dragState = null;
    });
    document.addEventListener('touchend', () => {
      this.dragState = null;
    });
  },

  open(app) {
    const w = this.windows[app];
    if (!w) return;
    w.el.classList.add('visible');
    w.el.classList.remove('minimized');
    w.minimized = false;

    // Auto-maximize on mobile
    if (window.innerWidth <= 768) {
      w.el.classList.add('maximized');
      w.maximized = true;
    }

    this.focus(app);
    this.updateTaskbar();

    // Fire app-specific init
    if (typeof AppCallbacks !== 'undefined' && AppCallbacks[app]) {
      AppCallbacks[app]();
    }
  },

  close(app) {
    const w = this.windows[app];
    if (!w) return;
    w.el.classList.remove('visible', 'focused', 'maximized');
    w.minimized = false;
    w.maximized = false;
    this.updateTaskbar();
  },

  closeAll() {
    Object.keys(this.windows).forEach(app => this.close(app));
  },

  minimize(app) {
    const w = this.windows[app];
    if (!w) return;
    w.el.classList.add('minimized');
    w.el.classList.remove('focused');
    w.minimized = true;
    this.updateTaskbar();
  },

  toggleMaximize(app) {
    const w = this.windows[app];
    if (!w) return;
    w.maximized = !w.maximized;
    w.el.classList.toggle('maximized', w.maximized);
  },

  focus(app) {
    Object.values(this.windows).forEach(w => w.el.classList.remove('focused'));
    const w = this.windows[app];
    if (!w) return;
    this.zIndex++;
    w.el.style.zIndex = this.zIndex;
    w.el.classList.add('focused');
  },

  toggleWindow(app) {
    const w = this.windows[app];
    if (!w) return;
    if (!w.el.classList.contains('visible')) {
      this.open(app);
    } else if (w.minimized) {
      w.el.classList.remove('minimized');
      w.minimized = false;
      this.focus(app);
    } else if (w.el.classList.contains('focused')) {
      this.minimize(app);
    } else {
      this.focus(app);
    }
    this.updateTaskbar();
  },

  updateTaskbar() {
    const container = document.getElementById('taskbar-apps');
    container.innerHTML = '';

    const appNames = {
      drive: 'Orbit Drive',
      notepad: 'Bloco de Notas',
      calculator: 'Calculadora',
      kanban: 'Projetos',
      chat: 'Team Chat',
      sheets: 'Orbit Sheets',
      slides: 'Orbit Slides',
      paint: 'Orbit Paint',
      calendar: 'Orbit Calendar',
      pomodoro: 'Pomodoro'
    };
    const appIcons = {
      drive: 'cloud',
      notepad: 'edit_note',
      calculator: 'calculate',
      kanban: 'view_kanban',
      chat: 'forum',
      sheets: 'grid_on',
      slides: 'slideshow',
      paint: 'brush',
      calendar: 'calendar_month',
      pomodoro: 'timer'
    };

    Object.entries(this.windows).forEach(([app, w]) => {
      if (!w.el.classList.contains('visible')) return;
      const btn = document.createElement('button');
      btn.className = 'taskbar-app-btn' + (w.el.classList.contains('focused') && !w.minimized ? ' active' : '');
      btn.innerHTML = `<span class="material-icons-round">${appIcons[app]}</span>${appNames[app]}`;
      btn.addEventListener('click', () => this.toggleWindow(app));
      container.appendChild(btn);
    });
  }
};

// ─── Clock ───
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const el = document.getElementById('taskbar-clock');
  if (el) el.textContent = `${h}:${m}`;
}

// ─── Prompt Modal Utility ───
function showPrompt(title, placeholder) {
  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    const input = document.getElementById('prompt-input');
    const titleEl = document.getElementById('prompt-title');
    const okBtn = document.getElementById('prompt-ok');
    const cancelBtn = document.getElementById('prompt-cancel');

    titleEl.textContent = title;
    input.placeholder = placeholder || '';
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    function cleanup() {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.querySelector('.modal-close').removeEventListener('click', onCancel);
      modal.querySelector('.modal-overlay').removeEventListener('click', onCancel);
    }

    function onOk() {
      const val = input.value.trim();
      cleanup();
      resolve(val || null);
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.querySelector('.modal-close').addEventListener('click', onCancel);
    modal.querySelector('.modal-overlay').addEventListener('click', onCancel);
  });
}

// ─── Preview Modal ───
function showPreview(title, contentHTML) {
  const modal = document.getElementById('preview-modal');
  document.getElementById('preview-title').textContent = title;
  document.getElementById('preview-body').innerHTML = contentHTML;
  modal.classList.remove('hidden');

  function closePreview() {
    modal.classList.add('hidden');
    document.getElementById('preview-body').innerHTML = '';
    modal.querySelector('.modal-close').removeEventListener('click', closePreview);
    modal.querySelector('.modal-overlay').removeEventListener('click', closePreview);
  }

  modal.querySelector('.modal-close').addEventListener('click', closePreview);
  modal.querySelector('.modal-overlay').addEventListener('click', closePreview);
}

// ─── Init on DOM Ready ───
document.addEventListener('DOMContentLoaded', () => {

  // --- Auth Forms ---
  const loginTabs = document.querySelectorAll('.login-tab');
  loginTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      loginTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      document.getElementById(tab.dataset.tab === 'login' ? 'login-form' : 'register-form').classList.add('active');
    });
  });

  // Login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;
      await Auth.login(user, pass);
      enterDesktop(user);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Register
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error');
    const sucEl = document.getElementById('register-success');
    errEl.textContent = '';
    sucEl.textContent = '';
    try {
      const user = document.getElementById('reg-user').value.trim();
      const pass = document.getElementById('reg-pass').value;
      const passC = document.getElementById('reg-pass-confirm').value;
      if (pass !== passC) throw new Error('As senhas não coincidem.');
      await Auth.register(user, pass);
      sucEl.textContent = 'Conta criada! Agora faça login.';
      document.getElementById('reg-user').value = '';
      document.getElementById('reg-pass').value = '';
      document.getElementById('reg-pass-confirm').value = '';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Auto-login if session exists
  const currentUser = Auth.getCurrentUser();
  if (currentUser) {
    enterDesktop(currentUser);
  }

  // --- Desktop Init ---
  function enterDesktop(username) {
    showScreen('desktop');
    document.getElementById('taskbar-user').textContent = username;
    document.getElementById('start-menu-user').textContent = username;

    // Update greeting
    const greetingUser = document.getElementById('greeting-user');
    if (greetingUser) greetingUser.textContent = username;

    const greetingDate = document.getElementById('greeting-date');
    if (greetingDate) {
      const now = new Date();
      const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
      greetingDate.textContent = `${dias[now.getDay()]}, ${now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`;
    }

    WindowManager.init();
    updateClock();
    updateLauncherClock();
    setInterval(updateClock, 30000);
    setInterval(updateLauncherClock, 30000);
  }

  // Launcher clock
  function updateLauncherClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const el = document.getElementById('launcher-clock');
    if (el) el.textContent = `${h}:${m}`;
  }

  // App card clicks (single tap — works on mobile!)
  document.querySelectorAll('.app-card, .app-card-featured').forEach(card => {
    card.addEventListener('click', () => {
      WindowManager.open(card.dataset.app);
    });
  });

  // Start Menu
  const startMenu = document.getElementById('start-menu');
  document.getElementById('start-button').addEventListener('click', (e) => {
    e.stopPropagation();
    startMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!startMenu.contains(e.target) && e.target !== document.getElementById('start-button')) {
      startMenu.classList.add('hidden');
    }
  });
  document.querySelectorAll('.start-app').forEach(btn => {
    btn.addEventListener('click', () => {
      WindowManager.open(btn.dataset.app);
      startMenu.classList.add('hidden');
    });
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());
  document.getElementById('start-logout').addEventListener('click', () => Auth.logout());

  // Hide context menu on click
  document.addEventListener('click', () => {
    document.getElementById('context-menu').classList.add('hidden');
  });
});
