/* ============================================
   OrbitOS - Applications Layer
   Drive, Notepad, Calculator, Kanban, Chat/AI
   ============================================ */

// App callbacks triggered when windows open
const AppCallbacks = {
  drive: () => DriveApp.render(),
  kanban: () => KanbanApp.init(),
  chat: () => {},
  notepad: () => {},
  calculator: () => {}
};

/* ============================================
   1. ORBIT DRIVE (File Manager)
   ============================================ */
const DriveApp = {
  currentPath: '/',
  viewMode: 'grid', // 'grid' | 'list'
  contextTarget: null,

  async init() {
    // New folder button
    document.getElementById('btn-new-folder').addEventListener('click', async () => {
      const name = await showPrompt('Nova Pasta', 'Nome da pasta');
      if (!name) return;
      await db.files.add({
        name,
        parentId: this.getParentId(),
        type: 'folder',
        mimeType: null,
        blob: null,
        createdAt: Date.now()
      });
      this.render();
    });

    // Upload button
    document.getElementById('btn-upload-file').addEventListener('click', () => {
      document.getElementById('file-upload-input').click();
    });

    document.getElementById('file-upload-input').addEventListener('change', async (e) => {
      const files = e.target.files;
      for (const file of files) {
        const blob = await this.fileToBase64(file);
        await db.files.add({
          name: file.name,
          parentId: this.getParentId(),
          type: 'file',
          mimeType: file.type,
          blob,
          createdAt: Date.now()
        });
      }
      e.target.value = '';
      this.render();
    });

    // View toggle
    document.getElementById('btn-view-toggle').addEventListener('click', () => {
      this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
      const icon = document.querySelector('#btn-view-toggle .material-icons-round');
      icon.textContent = this.viewMode === 'grid' ? 'grid_view' : 'view_list';
      this.render();
    });

    // Context menu actions
    document.querySelectorAll('#context-menu .ctx-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!this.contextTarget) return;

        if (action === 'open') {
          this.openItem(this.contextTarget);
        } else if (action === 'rename') {
          const newName = await showPrompt('Renomear', 'Novo nome');
          if (newName) {
            await db.files.update(this.contextTarget.id, { name: newName });
            this.render();
          }
        } else if (action === 'delete') {
          await this.deleteRecursive(this.contextTarget.id);
          this.render();
        }
        this.contextTarget = null;
      });
    });
  },

  getParentId() {
    if (this.currentPath === '/') return 0;
    return parseInt(this.currentPath.split('/').filter(Boolean).pop());
  },

  async render() {
    const container = document.getElementById('drive-content');
    const parentId = this.getParentId();

    const items = await db.files.where('parentId').equals(parentId).toArray();

    container.className = 'drive-content' + (this.viewMode === 'list' ? ' list-view' : '');

    if (items.length === 0) {
      container.innerHTML = `
        <div class="drive-empty">
          <span class="material-icons-round">cloud_queue</span>
          <p>Nenhum arquivo ainda. Faça upload ou crie uma pasta!</p>
        </div>`;
      return;
    }

    // Sort: folders first, then files
    items.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    container.innerHTML = items.map(item => {
      const iconClass = this.getIconClass(item);
      const iconName = this.getIconName(item);
      return `
        <div class="drive-item" data-id="${item.id}" data-type="${item.type}">
          <span class="material-icons-round ${iconClass}">${iconName}</span>
          <span class="drive-item-name">${this.escapeHtml(item.name)}</span>
        </div>`;
    }).join('');

    // Attach events
    container.querySelectorAll('.drive-item').forEach(el => {
      const id = parseInt(el.dataset.id);

      el.addEventListener('dblclick', async () => {
        const item = await db.files.get(id);
        if (item) this.openItem(item);
      });

      el.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = await db.files.get(id);
        this.contextTarget = item;
        const menu = document.getElementById('context-menu');
        menu.classList.remove('hidden');
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
      });
    });

    this.updateBreadcrumb();
  },

  openItem(item) {
    if (item.type === 'folder') {
      this.currentPath = this.currentPath + item.id + '/';
      this.render();
    } else {
      this.previewFile(item);
    }
  },

  previewFile(item) {
    if (!item.blob) return;

    if (item.mimeType && item.mimeType.startsWith('image/')) {
      showPreview(item.name, `<img src="${item.blob}" alt="${this.escapeHtml(item.name)}">`);
    } else if (item.mimeType === 'application/pdf') {
      showPreview(item.name, `<embed src="${item.blob}" type="application/pdf">`);
    } else if (item.mimeType && item.mimeType.startsWith('text/')) {
      // Decode base64 text
      try {
        const base64Data = item.blob.split(',')[1];
        const text = atob(base64Data);
        showPreview(item.name, `<pre style="white-space:pre-wrap;color:var(--text-primary);font-size:0.9rem;padding:10px;">${this.escapeHtml(text)}</pre>`);
      } catch {
        showPreview(item.name, `<p style="color:var(--text-muted);">Não foi possível visualizar este arquivo.</p>`);
      }
    } else {
      showPreview(item.name, `<p style="color:var(--text-muted);text-align:center;padding:40px;">Visualização não disponível para este tipo de arquivo.<br><br>Tipo: ${item.mimeType || 'desconhecido'}</p>`);
    }
  },

  updateBreadcrumb() {
    const breadcrumb = document.getElementById('drive-breadcrumb');
    const parts = this.currentPath.split('/').filter(Boolean);

    let html = `<span class="breadcrumb-item" data-path="/">Orbit Drive</span>`;

    parts.forEach((part, i) => {
      const path = '/' + parts.slice(0, i + 1).join('/') + '/';
      html += `<span class="breadcrumb-separator"></span>`;
      html += `<span class="breadcrumb-item" data-path="${path}" data-id="${part}">...</span>`;
    });

    breadcrumb.innerHTML = html;

    // Load folder names for breadcrumb
    breadcrumb.querySelectorAll('.breadcrumb-item[data-id]').forEach(async (el) => {
      const id = parseInt(el.dataset.id);
      const item = await db.files.get(id);
      if (item) el.textContent = item.name;
    });

    breadcrumb.querySelectorAll('.breadcrumb-item').forEach(el => {
      el.addEventListener('click', () => {
        this.currentPath = el.dataset.path;
        this.render();
      });
    });
  },

  async deleteRecursive(id) {
    const item = await db.files.get(id);
    if (!item) return;

    if (item.type === 'folder') {
      const children = await db.files.where('parentId').equals(id).toArray();
      for (const child of children) {
        await this.deleteRecursive(child.id);
      }
    }
    await db.files.delete(id);
  },

  getIconClass(item) {
    if (item.type === 'folder') return 'item-icon-folder';
    if (item.mimeType && item.mimeType.startsWith('image/')) return 'item-icon-image';
    if (item.mimeType === 'application/pdf') return 'item-icon-pdf';
    return 'item-icon-file';
  },

  getIconName(item) {
    if (item.type === 'folder') return 'folder';
    if (item.mimeType && item.mimeType.startsWith('image/')) return 'image';
    if (item.mimeType === 'application/pdf') return 'picture_as_pdf';
    if (item.mimeType && item.mimeType.startsWith('video/')) return 'videocam';
    if (item.mimeType && item.mimeType.startsWith('audio/')) return 'audiotrack';
    return 'insert_drive_file';
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};


/* ============================================
   2. NOTEPAD PRO
   ============================================ */
const NotepadApp = {
  init() {
    const editor = document.getElementById('notepad-editor');

    // Formatting buttons
    document.querySelectorAll('#window-notepad .notepad-toolbar .btn-icon[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        editor.focus();
      });
    });

    // Font size
    document.getElementById('notepad-font-size').addEventListener('change', (e) => {
      document.execCommand('fontSize', false, e.target.value);
      editor.focus();
    });

    // Export TXT
    document.getElementById('notepad-export-txt').addEventListener('click', () => {
      const text = editor.innerText;
      const blob = new Blob([text], { type: 'text/plain' });
      this.downloadBlob(blob, 'notas-orbitos.txt');
    });

    // Export PDF
    document.getElementById('notepad-export-pdf').addEventListener('click', () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const text = editor.innerText;
      const lines = doc.splitTextToSize(text, 180);
      doc.setFontSize(12);
      doc.text(lines, 15, 20);
      doc.save('notas-orbitos.pdf');
    });

    // Export PNG
    document.getElementById('notepad-export-png').addEventListener('click', () => {
      html2canvas(editor, {
        backgroundColor: '#1a1840',
        scale: 2
      }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'notas-orbitos.png';
        link.href = canvas.toDataURL();
        link.click();
      });
    });
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};


/* ============================================
   3. SCIENTIFIC CALCULATOR
   ============================================ */
const CalculatorApp = {
  expression: '',
  result: '0',
  lastWasEquals: false,

  init() {
    document.querySelectorAll('#window-calculator .calc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const value = btn.dataset.value;

        switch (action) {
          case 'number':
            this.appendNumber(value);
            break;
          case 'decimal':
            this.appendDecimal();
            break;
          case 'operator':
            this.appendOperator(value);
            break;
          case 'equals':
            this.calculate();
            break;
          case 'clear':
            this.clear();
            break;
          case 'backspace':
            this.backspace();
            break;
          case 'percent':
            this.percent();
            break;
          case 'func':
            this.scientificFunc(value);
            break;
        }
      });
    });
  },

  appendNumber(n) {
    if (this.lastWasEquals) {
      this.expression = '';
      this.lastWasEquals = false;
    }
    this.expression += n;
    this.result = this.expression;
    this.updateDisplay();
  },

  appendDecimal() {
    // Prevent double decimal in current number segment
    const parts = this.expression.split(/[\+\-\*\/]/);
    const last = parts[parts.length - 1];
    if (last.includes('.')) return;
    this.expression += '.';
    this.result = this.expression;
    this.updateDisplay();
  },

  appendOperator(op) {
    this.lastWasEquals = false;
    // Replace trailing operator
    if (/[\+\-\*\/]$/.test(this.expression)) {
      this.expression = this.expression.slice(0, -1);
    }
    this.expression += op;
    this.updateDisplay();
  },

  calculate() {
    if (!this.expression) return;
    try {
      // Use Function constructor instead of eval for slightly safer evaluation
      const sanitized = this.expression.replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
      const res = new Function('return ' + sanitized)();
      const displayExpr = this.expression
        .replace(/\*/g, ' × ')
        .replace(/\//g, ' ÷ ')
        .replace(/\+/g, ' + ')
        .replace(/\-/g, ' − ');

      this.addTapeEntry(`${displayExpr} = ${res}`);
      this.expression = String(res);
      this.result = String(res);
      this.lastWasEquals = true;
      this.updateDisplay();
    } catch {
      this.result = 'Erro';
      this.updateDisplay();
    }
  },

  clear() {
    this.expression = '';
    this.result = '0';
    this.lastWasEquals = false;
    this.updateDisplay();
  },

  backspace() {
    this.expression = this.expression.slice(0, -1);
    this.result = this.expression || '0';
    this.updateDisplay();
  },

  percent() {
    if (!this.expression) return;
    try {
      const val = new Function('return ' + this.expression)();
      const res = val / 100;
      this.expression = String(res);
      this.result = String(res);
      this.updateDisplay();
    } catch {
      this.result = 'Erro';
      this.updateDisplay();
    }
  },

  scientificFunc(func) {
    const currentVal = parseFloat(this.expression) || parseFloat(this.result) || 0;
    let res;

    switch (func) {
      case 'sin':
        res = Math.sin(currentVal * Math.PI / 180);
        this.addTapeEntry(`sin(${currentVal}°) = ${res}`);
        break;
      case 'cos':
        res = Math.cos(currentVal * Math.PI / 180);
        this.addTapeEntry(`cos(${currentVal}°) = ${res}`);
        break;
      case 'tan':
        res = Math.tan(currentVal * Math.PI / 180);
        this.addTapeEntry(`tan(${currentVal}°) = ${res}`);
        break;
      case 'sqrt':
        res = Math.sqrt(currentVal);
        this.addTapeEntry(`√${currentVal} = ${res}`);
        break;
      case 'pow':
        res = Math.pow(currentVal, 2);
        this.addTapeEntry(`${currentVal}² = ${res}`);
        break;
      default:
        return;
    }

    this.expression = String(res);
    this.result = String(res);
    this.lastWasEquals = true;
    this.updateDisplay();
  },

  addTapeEntry(text) {
    const tape = document.getElementById('calc-tape');
    const entry = document.createElement('div');
    entry.className = 'tape-entry';
    entry.textContent = text;
    tape.appendChild(entry);
    tape.scrollTop = tape.scrollHeight;
  },

  updateDisplay() {
    const exprEl = document.getElementById('calc-expression');
    const resEl = document.getElementById('calc-result');

    exprEl.textContent = this.expression
      .replace(/\*/g, '×')
      .replace(/\//g, '÷');

    // Format large/small numbers
    let display = this.result;
    const num = parseFloat(display);
    if (!isNaN(num) && display !== 'Erro') {
      if (Math.abs(num) > 999999999999) {
        display = num.toExponential(6);
      } else {
        // Round to avoid floating point display issues
        display = String(parseFloat(num.toPrecision(12)));
      }
    }
    resEl.textContent = display;
  }
};


/* ============================================
   4. KANBAN (Project Manager)
   ============================================ */
const KanbanApp = {
  initialized: false,

  async init() {
    if (this.initialized) {
      await this.render();
      return;
    }
    this.initialized = true;

    // Add task buttons
    document.querySelectorAll('.btn-add-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.status;
        const title = await showPrompt('Nova Tarefa', 'Título da tarefa');
        if (!title) return;
        await db.kanban.add({
          title,
          status,
          createdAt: Date.now()
        });
        this.render();
      });
    });

    await this.render();
  },

  async render() {
    const tasks = await db.kanban.toArray();

    ['todo', 'doing', 'done'].forEach(status => {
      const container = document.getElementById(`kanban-${status}`);
      const filtered = tasks.filter(t => t.status === status);

      container.innerHTML = filtered.map(task => `
        <div class="kanban-card" data-id="${task.id}">
          <div class="kanban-card-title">${this.escapeHtml(task.title)}</div>
          <div class="kanban-card-date">${this.formatDate(task.createdAt)}</div>
          <button class="kanban-card-delete" data-id="${task.id}">
            <span class="material-icons-round">close</span>
          </button>
        </div>
      `).join('');

      // Delete buttons
      container.querySelectorAll('.kanban-card-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          await db.kanban.delete(id);
          this.render();
        });
      });

      // SortableJS for drag-and-drop
      if (typeof Sortable !== 'undefined') {
        Sortable.create(container, {
          group: 'kanban',
          animation: 200,
          ghostClass: 'sortable-ghost',
          onEnd: async (evt) => {
            const id = parseInt(evt.item.dataset.id);
            const newStatus = evt.to.id.replace('kanban-', '');
            await db.kanban.update(id, { status: newStatus });
          }
        });
      }
    });
  },

  formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};


/* ============================================
   5. CHAT & ORBIT BOT (Rule-Based AI)
   ============================================ */
const ChatApp = {
  // Rule-based responses
  rules: [
    {
      patterns: [/^ajuda$/i, /^help$/i, /^comandos$/i, /^menu$/i],
      response: `Aqui estão os comandos que eu entendo:
<br>• <strong>"ajuda"</strong> — Mostra esta lista
<br>• <strong>"como criar pasta"</strong> — Ensina a criar pastas no Drive
<br>• <strong>"como fazer upload"</strong> — Ensina a enviar arquivos
<br>• <strong>"como usar kanban"</strong> — Dicas do gerenciador de projetos
<br>• <strong>"como exportar notas"</strong> — Formatos de exportação
<br>• <strong>"calculadora"</strong> — Dicas da calculadora
<br>• <strong>"resumo"</strong> — Resumo do sistema
<br>• <strong>"hora"</strong> — Mostra a hora atual
<br>• <strong>"sobre"</strong> — Sobre o OrbitOS`
    },
    {
      patterns: [/como criar pasta/i, /criar pasta/i, /nova pasta/i],
      response: `Para criar uma pasta no <strong>Orbit Drive</strong>:
<br>1. Abra o Orbit Drive (clique duas vezes no ícone do desktop).
<br>2. Clique no botão <strong>📁 Nova Pasta</strong> na barra superior.
<br>3. Digite o nome desejado e clique em OK.
<br>4. Você pode criar pastas dentro de pastas (aninhadas)!`
    },
    {
      patterns: [/como fazer upload/i, /upload/i, /enviar arquivo/i, /subir arquivo/i],
      response: `Para fazer upload de arquivos:
<br>1. Abra o <strong>Orbit Drive</strong>.
<br>2. Navegue até a pasta desejada.
<br>3. Clique no botão <strong>⬆ Upload</strong> na barra superior.
<br>4. Selecione um ou mais arquivos do seu computador.
<br>5. Os arquivos serão salvos localmente no seu navegador (IndexedDB).
<br><br>Seus arquivos persistem mesmo se você fechar o navegador!`
    },
    {
      patterns: [/como usar kanban/i, /kanban/i, /projeto/i, /gerenciador/i],
      response: `O <strong>Gerenciador de Projetos</strong> usa o sistema Kanban:
<br>• <strong>A Fazer</strong> — Tarefas planejadas
<br>• <strong>Fazendo</strong> — Tarefas em andamento
<br>• <strong>Feito</strong> — Tarefas concluídas
<br><br>Clique no <strong>+</strong> em cada coluna para adicionar tarefas.
<br>Arraste os cartões entre colunas para mudar o status!`
    },
    {
      patterns: [/como exportar/i, /exportar notas/i, /exportar/i, /salvar nota/i],
      response: `No <strong>Bloco de Notas Pro</strong> você pode exportar em 3 formatos:
<br>• <strong>TXT</strong> — Arquivo de texto simples
<br>• <strong>PDF</strong> — Documento PDF formatado
<br>• <strong>PNG</strong> — Captura de tela como imagem
<br><br>Use os botões na barra de ferramentas do editor!`
    },
    {
      patterns: [/calculadora/i, /calcular/i, /contas/i],
      response: `A <strong>Calculadora Científica</strong> do OrbitOS tem:
<br>• Operações básicas (+, −, ×, ÷)
<br>• Funções científicas: sin, cos, tan, √, x²
<br>• Cálculo de porcentagem (%)
<br>• Histórico de "fita" — veja todas as operações anteriores!`
    },
    {
      patterns: [/^resumo$/i, /^resumir$/i],
      response: `Ainda não leio textos longos, mas posso ajudar com a interface!
<br>Tente perguntar <strong>"ajuda"</strong> para ver tudo que sei fazer. 😊`
    },
    {
      patterns: [/^hora$/i, /que horas/i, /hora atual/i],
      response: () => {
        const now = new Date();
        return `Agora são <strong>${now.toLocaleTimeString('pt-BR')}</strong> do dia <strong>${now.toLocaleDateString('pt-BR')}</strong>.`;
      }
    },
    {
      patterns: [/^sobre$/i, /sobre o orbit/i, /o que é orbit/i],
      response: `<strong>OrbitOS</strong> é um Sistema Operacional Web focado em produtividade.
<br>• 100% Offline-First — seus dados ficam no navegador
<br>• Privacidade total — nada é enviado para servidores
<br>• Inclui: Drive, Bloco de Notas, Calculadora, Kanban e Chat
<br><br>Desenvolvido como um Web OS completo! 🚀`
    },
    {
      patterns: [/oi|olá|ola|hey|eae|eai|bom dia|boa tarde|boa noite/i],
      response: () => {
        const greetings = [
          'Olá! Como posso ajudar? Digite <strong>"ajuda"</strong> para ver os comandos!',
          'Oi! Estou aqui para ajudar. O que precisa?',
          'E aí! Precisando de alguma coisa? Digite <strong>"ajuda"</strong>!',
          'Olá! Bem-vindo ao OrbitOS. Como posso ser útil?'
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
      }
    },
    {
      patterns: [/obrigado|valeu|thanks|vlw|brigado/i],
      response: () => {
        const thanks = [
          'De nada! Estou aqui para ajudar! 😊',
          'Disponha! Qualquer dúvida, é só chamar.',
          'Por nada! Fico feliz em ajudar.'
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
      }
    }
  ],

  defaultResponses: [
    'Hmm, não tenho certeza sobre isso. Tente digitar <strong>"ajuda"</strong> para ver o que sei fazer!',
    'Ainda estou aprendendo! Digite <strong>"ajuda"</strong> para ver os comandos disponíveis.',
    'Não entendi bem, mas posso ajudar com várias coisas! Digite <strong>"ajuda"</strong>.',
    'Essa eu não sei responder, mas conheço bastante sobre o OrbitOS! Tente <strong>"ajuda"</strong>.'
  ],

  init() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      this.addMessage(text, 'user');
      input.value = '';

      // Show typing indicator then respond
      this.showTyping();
      setTimeout(() => {
        this.hideTyping();
        const response = this.getResponse(text);
        this.addMessage(response, 'bot');
      }, 600 + Math.random() * 800);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
  },

  getResponse(input) {
    const text = input.trim();

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) {
          return typeof rule.response === 'function' ? rule.response() : rule.response;
        }
      }
    }

    return this.defaultResponses[Math.floor(Math.random() * this.defaultResponses.length)];
  },

  addMessage(content, sender) {
    const container = document.getElementById('chat-messages');
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const icon = sender === 'bot' ? 'smart_toy' : 'person';
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    msg.innerHTML = `
      <div class="message-avatar"><span class="material-icons-round">${icon}</span></div>
      <div class="message-bubble">
        <p>${sender === 'user' ? this.escapeHtml(content) : content}</p>
        <span class="message-time">${time}</span>
      </div>
    `;

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  showTyping() {
    const container = document.getElementById('chat-messages');
    const existing = container.querySelector('.typing-indicator-msg');
    if (existing) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message bot typing-indicator-msg';
    msg.innerHTML = `
      <div class="message-avatar"><span class="material-icons-round">smart_toy</span></div>
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  hideTyping() {
    const container = document.getElementById('chat-messages');
    const el = container.querySelector('.typing-indicator-msg');
    if (el) el.remove();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};


/* ============================================
   INITIALIZATION
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  DriveApp.init();
  NotepadApp.init();
  CalculatorApp.init();
  ChatApp.init();
});
