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
  calculator: () => {},
  sheets: () => SheetsApp.init(),
  slides: () => SlidesApp.init(),
  paint: () => PaintApp.init(),
  calendar: () => CalendarApp.init(),
  pomodoro: () => PomodoroApp.init()
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

    // Save to Drive
    document.getElementById('notepad-save-drive').addEventListener('click', async () => {
      await this.saveToDrive();
    });
  },

  async saveToDrive() {
    const editor = document.getElementById('notepad-editor');
    const content = editor.innerHTML;
    const textContent = editor.innerText.trim();

    if (!textContent) {
      alert('O bloco de notas está vazio. Escreva algo antes de salvar!');
      return;
    }

    const name = await showPrompt('Salvar no Drive', 'Nome do arquivo (ex: minhas-notas)');
    if (!name) return;

    const fileName = name.endsWith('.html') ? name : name + '.html';

    // Save as HTML to preserve formatting
    const htmlBlob = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${fileName}</title>
<style>body{font-family:Inter,sans-serif;padding:24px;line-height:1.8;color:#222;max-width:800px;margin:0 auto;}</style>
</head><body>${content}</body></html>`;

    const base64 = 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(htmlBlob)));

    await db.files.add({
      name: fileName,
      parentId: DriveApp.getParentId(),
      type: 'file',
      mimeType: 'text/html',
      blob: base64,
      createdAt: Date.now()
    });

    // Visual feedback
    const btn = document.getElementById('notepad-save-drive');
    const icon = btn.querySelector('.material-icons-round');
    const originalIcon = icon.textContent;
    icon.textContent = 'check_circle';
    btn.style.color = 'var(--emerald)';
    setTimeout(() => {
      icon.textContent = originalIcon;
      btn.style.color = '';
    }, 2000);
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
<br><br>📂 <strong>OrbitOS:</strong>
<br>• <strong>"como criar pasta"</strong> — Criar pastas no Drive
<br>• <strong>"como fazer upload"</strong> — Enviar arquivos
<br>• <strong>"como usar kanban"</strong> — Gerenciador de projetos
<br>• <strong>"como exportar notas"</strong> — Exportar do Bloco de Notas
<br>• <strong>"calculadora"</strong> — Dicas da calculadora
<br>• <strong>"sobre"</strong> — Sobre o OrbitOS
<br><br>🕐 <strong>Utilidades:</strong>
<br>• <strong>"hora"</strong> / <strong>"data"</strong> — Hora e data atual
<br>• <strong>"converter"</strong> — Tabela de conversões
<br>• <strong>"senha segura"</strong> — Dicas de segurança digital
<br>• <strong>"lembrete"</strong> — Como criar lembretes
<br><br>🧠 <strong>Dia a dia:</strong>
<br>• <strong>"motivação"</strong> — Frase motivacional
<br>• <strong>"produtividade"</strong> — Dicas para focar
<br>• <strong>"estudar"</strong> — Técnicas de estudo
<br>• <strong>"dormir"</strong> — Dicas de sono
<br>• <strong>"exercício"</strong> — Dicas de treino
<br>• <strong>"receita"</strong> — Receitas rápidas
<br>• <strong>"finanças"</strong> — Dicas financeiras
<br>• <strong>"música"</strong> — Sugestões musicais
<br>• <strong>"piada"</strong> — Uma piada para descontrair
<br>• <strong>"curiosidade"</strong> — Fatos interessantes
<br>• <strong>"programação"</strong> — Dicas de código`
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
    },
    // ─── Everyday Practical Responses ───
    {
      patterns: [/que dia|qual a data|data de hoje|dia hoje/i],
      response: () => {
        const now = new Date();
        const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
        return `Hoje é <strong>${dias[now.getDay()]}</strong>, <strong>${now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>.`;
      }
    },
    {
      patterns: [/motivação|motivar|frase motivacional|me inspira|preciso de motivação/i],
      response: () => {
        const quotes = [
          '"O sucesso é a soma de pequenos esforços repetidos dia após dia." — Robert Collier',
          '"A persistência é o caminho do êxito." — Charlie Chaplin',
          '"Acredite em si mesmo e tudo será possível." — Unknown',
          '"Não espere por oportunidades extraordinárias. Agarre ocasiões comuns e as torne grandes." — Orison Swett Marden',
          '"O único lugar onde o sucesso vem antes do trabalho é no dicionário." — Vidal Sassoon',
          '"Comece de onde você está. Use o que tem. Faça o que puder." — Arthur Ashe',
          '"Toda grande conquista foi primeiro um sonho impossível." — Unknown',
          '"A diferença entre ordinário e extraordinário é aquele pequeno extra." — Jimmy Johnson'
        ];
        return `💪 <strong>Motivação do momento:</strong><br><br><em>${quotes[Math.floor(Math.random() * quotes.length)]}</em>`;
      }
    },
    {
      patterns: [/piada|me conta uma piada|piada de|conte uma piada|humor/i],
      response: () => {
        const jokes = [
          'Por que o programador usa óculos? Porque ele não consegue C#! 😄',
          'O que o JavaScript disse para o CSS? "Você não tem classe!" 😂',
          'Por que o computador foi ao médico? Porque tinha um vírus! 🤒',
          'O que é um byte? Um bit que jantou! 🍽️',
          'Quantos programadores são necessários para trocar uma lâmpada? Nenhum, isso é um problema de hardware! 💡',
          'Por que o Wi-Fi terminou com a internet? Porque não tinha mais conexão! 📶'
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
      }
    },
    {
      patterns: [/dica de produtividade|ser mais produtivo|produtividade|dica para focar|foco/i],
      response: () => {
        const tips = [
          '<strong>Técnica Pomodoro:</strong> Trabalhe 25 min focado → Pause 5 min → Repita. A cada 4 ciclos, pause 15-30 min.',
          '<strong>Regra dos 2 minutos:</strong> Se algo leva menos de 2 minutos para fazer, faça agora!',
          '<strong>Eat the Frog:</strong> Comece o dia pela tarefa mais difícil. O resto parecerá fácil!',
          '<strong>Bloco de Tempo:</strong> Reserve blocos específicos no dia para cada tipo de tarefa. Evite multitarefas!',
          '<strong>Regra 80/20:</strong> 20% das suas ações geram 80% dos resultados. Identifique e priorize essas ações.',
          '<strong>Digital Detox:</strong> Desative notificações não essenciais. Cada interrupção leva ~23 min para retomar o foco!'
        ];
        return `📋 <strong>Dica de Produtividade:</strong><br><br>${tips[Math.floor(Math.random() * tips.length)]}`;
      }
    },
    {
      patterns: [/converter|conversão|quanto é.*em|celsius|fahrenheit|metros|quilos|libras|km|milhas/i],
      response: `<strong>Conversões úteis:</strong>
<br>• <strong>Temperatura:</strong> °C × 1.8 + 32 = °F | (°F − 32) ÷ 1.8 = °C
<br>• <strong>Peso:</strong> 1 kg = 2.205 libras | 1 libra = 0.454 kg
<br>• <strong>Distância:</strong> 1 km = 0.621 milhas | 1 milha = 1.609 km
<br>• <strong>Volume:</strong> 1 litro = 0.264 galões | 1 galão = 3.785 litros
<br>• <strong>Área:</strong> 1 m² = 10.764 pés² | 1 hectare = 10.000 m²
<br><br>Use a <strong>Calculadora</strong> do OrbitOS para os cálculos! 🧮`
    },
    {
      patterns: [/clima|tempo|previsão|vai chover|chuva|sol|frio|calor/i],
      response: `Infelizmente não tenho acesso à internet para checar o clima em tempo real. 🌤️
<br><br>Mas posso te dar <strong>dicas úteis</strong>:
<br>• Consulte sites como <strong>Climatempo</strong> ou <strong>AccuWeather</strong>
<br>• No celular, o app do tempo nativo já ajuda bastante
<br>• Leve um guarda-chuva se houver mais de 40% de chance de chuva!`
    },
    {
      patterns: [/receita|culinária|cozinhar|o que fazer para comer|comida/i],
      response: () => {
        const recipes = [
          '<strong>Omelete rápida:</strong> 2 ovos + sal + o que tiver (queijo, tomate, presunto). Bata, despeje na frigideira quente com manteiga. 3 min de cada lado!',
          '<strong>Macarrão alho e óleo:</strong> Cozinhe o macarrão. Em uma panela: azeite + 4 dentes de alho fatiados + pimenta. Misture tudo. Simples e delicioso!',
          '<strong>Sanduíche natural:</strong> Pão integral + peito de frango desfiado + cenoura ralada + milho + maionese light. Pronto em 5 min!',
          '<strong>Arroz de micro-ondas:</strong> 1 xícara de arroz + 2 de água + sal + azeite. Tampa com filme, micro-ondas 18 min. Funciona!',
          '<strong>Banana com aveia:</strong> Amasse 1 banana + 3 colheres de aveia + canela. Frigideira antiaderente, 2 min de cada lado. Panqueca fitness!'
        ];
        return `🍳 <strong>Receita rápida:</strong><br><br>${recipes[Math.floor(Math.random() * recipes.length)]}`;
      }
    },
    {
      patterns: [/exercício|treino|academia|malhar|atividade física|se exercitar/i],
      response: () => {
        const workouts = [
          '<strong>Treino rápido em casa (15 min):</strong><br>• 20 agachamentos<br>• 15 flexões<br>• 30s prancha<br>• 20 polichinelos<br>• 10 burpees<br>Repita 3x!',
          '<strong>Alongamento matinal:</strong><br>• Estique os braços para cima (15s)<br>• Toque os pés (15s)<br>• Gire os ombros (10x)<br>• Gire o pescoço (10x)<br>• Alongue as laterais (15s cada)',
          '<strong>Caminhada produtiva:</strong> 30 min de caminhada por dia reduz estresse, melhora o humor e queima ~150 calorias. Coloque um podcast e aproveite!'
        ];
        return `💪 <strong>Dica de Exercício:</strong><br><br>${workouts[Math.floor(Math.random() * workouts.length)]}`;
      }
    },
    {
      patterns: [/estudar|dica de estudo|como estudar|aprender|estudo/i],
      response: () => {
        const tips = [
          '<strong>Repetição Espaçada:</strong> Revise o conteúdo em intervalos crescentes (1 dia, 3 dias, 7 dias, 21 dias). A memorização é muito mais eficiente!',
          '<strong>Técnica Feynman:</strong> Tente explicar o assunto como se fosse ensinar uma criança. Se não conseguir, volte e estude mais aquela parte.',
          '<strong>Mapas Mentais:</strong> Resuma temas complexos em diagramas visuais. O cérebro memoriza imagens melhor que textos!',
          '<strong>Estudo Ativo:</strong> Em vez de só ler, faça perguntas, resolva exercícios e teste a si mesmo. Ler é passivo, praticar é ativo!'
        ];
        return `📚 <strong>Dica de Estudo:</strong><br><br>${tips[Math.floor(Math.random() * tips.length)]}`;
      }
    },
    {
      patterns: [/dormir|sono|insônia|dormir melhor|não consigo dormir/i],
      response: `😴 <strong>Dicas para dormir melhor:</strong>
<br>• Evite telas (celular, PC) 30 min antes de dormir
<br>• Mantenha horário regular de sono (mesmo nos finais de semana)
<br>• Evite cafeína após as 16h
<br>• Mantenha o quarto escuro e fresco
<br>• Tente técnica 4-7-8: Inspire 4s → Segure 7s → Expire 8s
<br>• Leia um livro físico antes de dormir`
    },
    {
      patterns: [/música|playlist|ouvir música|recomendar música/i],
      response: () => {
        const genres = [
          '<strong>Para focar:</strong> Lo-fi hip hop, músicas instrumentais, trilhas sonoras de filmes, música clássica (Mozart, Bach)',
          '<strong>Para animar:</strong> Pop, funk brasileiro, rock clássico, eletrônica',
          '<strong>Para relaxar:</strong> Jazz suave, bossa nova, ambient, sons da natureza',
          '<strong>Para treinar:</strong> Hip hop, EDM, rock pesado, trap'
        ];
        return `🎵 <strong>Sugestão Musical:</strong><br><br>${genres[Math.floor(Math.random() * genres.length)]}<br><br>Busque playlists no Spotify ou YouTube!`;
      }
    },
    {
      patterns: [/tédio|entediado|fazer o que|sem nada para fazer|estou à toa/i],
      response: () => {
        const ideas = [
          'Que tal organizar seu Orbit Drive? Crie pastas e organize seus arquivos! 📁',
          'Use o Kanban para planejar seus próximos projetos pessoais! 📋',
          'Escreva um diário no Bloco de Notas — registre como foi seu dia! ✍️',
          'Aprenda algo novo: veja um tutorial, leia um artigo, ou comece um curso online! 📚',
          'Faça uma lista de metas para este mês no Bloco de Notas! 🎯',
          'Organize suas ideias em um brainstorm usando o Bloco de Notas! 💡'
        ];
        return ideas[Math.floor(Math.random() * ideas.length)];
      }
    },
    {
      patterns: [/ansiedade|ansioso|estressado|estresse|calma|acalmar/i],
      response: `🧘 <strong>Técnicas para acalmar:</strong>
<br>• <strong>Respiração 4-7-8:</strong> Inspire (4s) → Segure (7s) → Expire (8s). Repita 4x
<br>• <strong>Grounding 5-4-3-2-1:</strong> Observe 5 coisas que vê, 4 que toca, 3 que ouve, 2 que cheira, 1 que saboreia
<br>• <strong>Caminhada curta:</strong> 10 min de caminhada já libera endorfina
<br>• <strong>Escreva:</strong> Coloque seus pensamentos no Bloco de Notas. Externalizar ajuda!
<br><br>Se a ansiedade for constante, procure ajuda profissional. CVV: <strong>188</strong> 💚`
    },
    {
      patterns: [/dinheiro|finanças|economia|economizar|gastar menos|poupar/i],
      response: `💰 <strong>Dicas de Finanças:</strong>
<br>• <strong>Regra 50/30/20:</strong> 50% necessidades, 30% desejos, 20% poupança/investimentos
<br>• <strong>Anote gastos:</strong> Use o Bloco de Notas para registrar despesas diárias por 30 dias
<br>• <strong>Corte assinaturas:</strong> Revise serviços mensais que você não usa
<br>• <strong>Compras:</strong> Espere 24h antes de comprar algo não essencial (evita compras por impulso)
<br>• <strong>Reserva:</strong> Tente guardar pelo menos 3-6 meses de despesas para emergências`
    },
    {
      patterns: [/senha segura|criar senha|senha forte|segurança digital|privacidade/i],
      response: `🔐 <strong>Dicas de Segurança Digital:</strong>
<br>• Use senhas com 12+ caracteres, misturando letras, números e símbolos
<br>• Nunca reutilize a mesma senha em sites diferentes
<br>• Ative autenticação de dois fatores (2FA) em tudo
<br>• Cuidado com links em e-mails suspeitos (phishing)
<br>• Mantenha seu sistema e apps atualizados
<br>• Use um gerenciador de senhas (Bitwarden, 1Password)`
    },
    {
      patterns: [/como estou|como vai|tudo bem|como você está/i],
      response: () => {
        const replies = [
          'Estou ótimo, obrigado por perguntar! 😊 E você, como posso ajudar?',
          'Tudo bem por aqui! Estou pronto para ajudar no que precisar!',
          'Funcionando perfeitamente! Me diga, o que posso fazer por você?',
          'Muito bem! Sempre disponível para ajudar. O que precisa?'
        ];
        return replies[Math.floor(Math.random() * replies.length)];
      }
    },
    {
      patterns: [/tchau|bye|até mais|até logo|falou|fui/i],
      response: () => {
        const byes = [
          'Até mais! Volte quando precisar! 👋',
          'Tchau! Bom restante de dia! 🌟',
          'Até logo! Estarei aqui quando voltar. 😊',
          'Falou! Qualquer coisa, é só chamar! ✌️'
        ];
        return byes[Math.floor(Math.random() * byes.length)];
      }
    },
    {
      patterns: [/lembrete|me lembre|lembrar|não esquecer/i],
      response: `⏰ Ainda não tenho sistema de lembretes com notificações, mas posso sugerir:
<br>• Crie uma tarefa no <strong>Kanban</strong> como lembrete visual
<br>• Escreva no <strong>Bloco de Notas</strong> e salve no Drive
<br>• Use o alarme do seu celular para lembretes com horário`
    },
    {
      patterns: [/programar|programação|código|html|css|javascript|python/i],
      response: () => {
        const tips = [
          '<strong>Dica de JS:</strong> Use <code>console.table()</code> em vez de <code>console.log()</code> para visualizar arrays e objetos de forma mais organizada!',
          '<strong>Dica de CSS:</strong> Use <code>gap</code> no Flexbox/Grid em vez de margins. Mais limpo e consistente!',
          '<strong>Dica Geral:</strong> Escreva código como se a pessoa que vai mantê-lo fosse um psicopata que sabe onde você mora. 😅 Nomes claros > comentários!',
          '<strong>Para iniciantes:</strong> Comece com HTML + CSS + JS. Depois explore frameworks. Não tente aprender tudo de uma vez!',
          '<strong>Dica de Debug:</strong> Leia a mensagem de erro INTEIRA antes de buscar no Google. Ela geralmente diz exatamente o problema!'
        ];
        return `💻 <strong>Dica de Programação:</strong><br><br>${tips[Math.floor(Math.random() * tips.length)]}`;
      }
    },
    {
      patterns: [/curiosidade|fato curioso|sabia que|fato interessante|me surpreenda/i],
      response: () => {
        const facts = [
          'O primeiro computador pesava 27 toneladas e ocupava uma sala inteira (ENIAC, 1945)! 🖥️',
          'O nome "Google" vem de "googol" — o número 1 seguido de 100 zeros! 🔢',
          'Um raio pode aquecer o ar ao redor a até 30.000°C — 5x mais quente que a superfície do Sol! ⚡',
          'Seu cérebro gera cerca de 12-25 watts de eletricidade — suficiente para acender uma lâmpada LED! 🧠',
          'O primeiro SMS da história foi enviado em 1992 e dizia "Merry Christmas" 📱',
          'Existem mais formas possíveis de organizar um baralho de cartas do que átomos na Terra! 🃏',
          'O mel nunca estraga. Arqueólogos encontraram mel de 3000 anos no Egito ainda comestível! 🍯'
        ];
        return `🤓 <strong>Curiosidade:</strong><br><br>${facts[Math.floor(Math.random() * facts.length)]}`;
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
   6. ORBIT SHEETS (Spreadsheet)
   ============================================ */
const SheetsApp = {
  initialized: false,
  rows: 30,
  cols: 10,
  data: {},       // { "A1": "=SUM(A2:A5)", ... }
  computed: {},   // { "A1": 123, ... }
  selectedCell: null,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.buildTable();

    // Formula bar
    const formulaBar = document.getElementById('sheets-formula-bar');
    formulaBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedCell) {
          this.data[this.selectedCell] = formulaBar.value;
          this.recalcAll();
          // Move down
          const col = this.selectedCell.match(/[A-Z]+/)[0];
          const row = parseInt(this.selectedCell.match(/\d+/)[0]) + 1;
          if (row <= this.rows) this.selectCell(col + row);
        }
      }
    });

    // Export CSV
    document.getElementById('sheets-export-csv').addEventListener('click', () => this.exportCSV());

    // Save to Drive
    document.getElementById('sheets-save-drive').addEventListener('click', () => this.saveToDrive());
  },

  buildTable() {
    const table = document.getElementById('sheets-table');
    const colLetters = [];
    for (let c = 0; c < this.cols; c++) {
      colLetters.push(String.fromCharCode(65 + c));
    }

    let html = '<thead><tr><th></th>';
    colLetters.forEach(l => { html += `<th>${l}</th>`; });
    html += '</tr></thead><tbody>';

    for (let r = 1; r <= this.rows; r++) {
      html += `<tr><th>${r}</th>`;
      colLetters.forEach(l => {
        const cellId = l + r;
        html += `<td data-cell="${cellId}"><input type="text" data-cell="${cellId}"></td>`;
      });
      html += '</tr>';
    }
    html += '</tbody>';
    table.innerHTML = html;

    // Attach cell events
    table.querySelectorAll('td input').forEach(input => {
      input.addEventListener('focus', () => {
        this.selectCell(input.dataset.cell);
        const formulaBar = document.getElementById('sheets-formula-bar');
        formulaBar.value = this.data[input.dataset.cell] || '';
      });
      input.addEventListener('blur', () => {
        const cellId = input.dataset.cell;
        this.data[cellId] = input.value;
        this.recalcAll();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const cellId = input.dataset.cell;
          this.data[cellId] = input.value;
          this.recalcAll();
          // Move down
          const col = cellId.match(/[A-Z]+/)[0];
          const row = parseInt(cellId.match(/\d+/)[0]) + 1;
          if (row <= this.rows) this.selectCell(col + row);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const cellId = input.dataset.cell;
          this.data[cellId] = input.value;
          this.recalcAll();
          // Move right
          const col = cellId.match(/[A-Z]+/)[0];
          const row = parseInt(cellId.match(/\d+/)[0]);
          const nextColIdx = col.charCodeAt(0) - 65 + 1;
          if (nextColIdx < this.cols) {
            this.selectCell(String.fromCharCode(65 + nextColIdx) + row);
          }
        }
      });
    });
  },

  selectCell(cellId) {
    // Remove previous selection
    document.querySelectorAll('.sheets-table td.selected').forEach(td => td.classList.remove('selected'));

    this.selectedCell = cellId;
    document.getElementById('sheets-cell-ref').textContent = cellId;

    const td = document.querySelector(`.sheets-table td[data-cell="${cellId}"]`);
    if (td) {
      td.classList.add('selected');
      const input = td.querySelector('input');
      if (input) {
        input.focus();
        input.value = this.data[cellId] || '';
      }
    }

    const formulaBar = document.getElementById('sheets-formula-bar');
    formulaBar.value = this.data[cellId] || '';
  },

  recalcAll() {
    this.computed = {};
    Object.keys(this.data).forEach(cellId => {
      this.computed[cellId] = this.evaluate(this.data[cellId]);
    });

    // Update display
    document.querySelectorAll('.sheets-table td input').forEach(input => {
      const cellId = input.dataset.cell;
      const raw = this.data[cellId];
      if (raw && raw.startsWith('=')) {
        input.value = this.computed[cellId] !== undefined ? this.computed[cellId] : raw;
      } else {
        input.value = raw || '';
      }
    });
  },

  evaluate(value) {
    if (!value) return '';
    if (typeof value !== 'string') return value;
    if (!value.startsWith('=')) {
      const num = parseFloat(value);
      return isNaN(num) ? value : num;
    }

    const formula = value.substring(1).toUpperCase();
    try {
      // Handle SUM(range)
      const sumMatch = formula.match(/^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
      if (sumMatch) return this.rangeReduce(sumMatch[1], sumMatch[2], (a, b) => a + b, 0);

      // Handle AVG/AVERAGE(range)
      const avgMatch = formula.match(/^(?:AVG|AVERAGE)\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
      if (avgMatch) {
        const vals = this.getRangeValues(avgMatch[1], avgMatch[2]);
        const nums = vals.filter(v => typeof v === 'number');
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      }

      // Handle MIN(range)
      const minMatch = formula.match(/^MIN\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
      if (minMatch) {
        const vals = this.getRangeValues(minMatch[1], minMatch[2]).filter(v => typeof v === 'number');
        return vals.length ? Math.min(...vals) : 0;
      }

      // Handle MAX(range)
      const maxMatch = formula.match(/^MAX\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
      if (maxMatch) {
        const vals = this.getRangeValues(maxMatch[1], maxMatch[2]).filter(v => typeof v === 'number');
        return vals.length ? Math.max(...vals) : 0;
      }

      // Handle COUNT(range)
      const countMatch = formula.match(/^COUNT\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
      if (countMatch) {
        return this.getRangeValues(countMatch[1], countMatch[2]).filter(v => typeof v === 'number').length;
      }

      // Simple cell references and math
      let expr = formula.replace(/[A-Z]+\d+/g, (ref) => {
        const val = this.getCellValue(ref);
        return typeof val === 'number' ? val : 0;
      });
      const sanitized = expr.replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
      return new Function('return ' + sanitized)();
    } catch {
      return '#ERR';
    }
  },

  getCellValue(cellId) {
    const raw = this.data[cellId];
    if (!raw) return 0;
    if (typeof raw === 'string' && raw.startsWith('=')) {
      return this.evaluate(raw);
    }
    const num = parseFloat(raw);
    return isNaN(num) ? raw : num;
  },

  getRangeValues(start, end) {
    const startCol = start.match(/[A-Z]+/)[0].charCodeAt(0);
    const startRow = parseInt(start.match(/\d+/)[0]);
    const endCol = end.match(/[A-Z]+/)[0].charCodeAt(0);
    const endRow = parseInt(end.match(/\d+/)[0]);
    const values = [];
    for (let c = startCol; c <= endCol; c++) {
      for (let r = startRow; r <= endRow; r++) {
        values.push(this.getCellValue(String.fromCharCode(c) + r));
      }
    }
    return values;
  },

  rangeReduce(start, end, fn, initial) {
    const values = this.getRangeValues(start, end).filter(v => typeof v === 'number');
    return values.reduce(fn, initial);
  },

  exportCSV() {
    const colLetters = [];
    for (let c = 0; c < this.cols; c++) colLetters.push(String.fromCharCode(65 + c));

    let csv = colLetters.join(',') + '\n';
    for (let r = 1; r <= this.rows; r++) {
      const row = colLetters.map(l => {
        const cellId = l + r;
        const val = this.computed[cellId] !== undefined ? this.computed[cellId] : (this.data[cellId] || '');
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      });
      csv += row.join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orbit-sheets.csv';
    a.click();
    URL.revokeObjectURL(url);
  },

  async saveToDrive() {
    const name = await showPrompt('Salvar no Drive', 'Nome da planilha');
    if (!name) return;
    const fileName = name.endsWith('.csv') ? name : name + '.csv';

    const colLetters = [];
    for (let c = 0; c < this.cols; c++) colLetters.push(String.fromCharCode(65 + c));

    let csv = colLetters.join(',') + '\n';
    for (let r = 1; r <= this.rows; r++) {
      const row = colLetters.map(l => {
        const cellId = l + r;
        const val = this.computed[cellId] !== undefined ? this.computed[cellId] : (this.data[cellId] || '');
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      });
      csv += row.join(',') + '\n';
    }

    const base64 = 'data:text/csv;base64,' + btoa(unescape(encodeURIComponent(csv)));
    await db.files.add({
      name: fileName,
      parentId: DriveApp.getParentId(),
      type: 'file',
      mimeType: 'text/csv',
      blob: base64,
      createdAt: Date.now()
    });

    const btn = document.getElementById('sheets-save-drive');
    const icon = btn.querySelector('.material-icons-round');
    icon.textContent = 'check_circle';
    btn.style.color = 'var(--emerald)';
    setTimeout(() => { icon.textContent = 'cloud_upload'; btn.style.color = ''; }, 2000);
  }
};


/* ============================================
   7. ORBIT SLIDES (Presentations)
   ============================================ */
const SlidesApp = {
  initialized: false,
  slides: [],
  currentSlide: 0,

  init() {
    if (this.initialized) {
      this.renderPanel();
      return;
    }
    this.initialized = true;

    // Start with one slide
    this.slides = [
      { content: '<h1>Clique para editar o título</h1><p>Subtítulo da apresentação</p>', bg: '#1a1a2e' }
    ];

    this.renderPanel();
    this.loadSlide(0);

    // Add slide
    document.getElementById('slides-add').addEventListener('click', () => {
      this.slides.push({ content: '<h1>Novo Slide</h1><p>Conteúdo aqui</p>', bg: '#1a1a2e' });
      this.currentSlide = this.slides.length - 1;
      this.renderPanel();
      this.loadSlide(this.currentSlide);
    });

    // Delete slide
    document.getElementById('slides-delete').addEventListener('click', () => {
      if (this.slides.length <= 1) return;
      this.slides.splice(this.currentSlide, 1);
      if (this.currentSlide >= this.slides.length) this.currentSlide = this.slides.length - 1;
      this.renderPanel();
      this.loadSlide(this.currentSlide);
    });

    // Background color
    document.getElementById('slides-bg-color').addEventListener('change', (e) => {
      this.slides[this.currentSlide].bg = e.target.value;
      document.getElementById('slides-canvas').style.backgroundColor = e.target.value;
      this.renderPanel();
    });

    // Save canvas content on blur
    document.getElementById('slides-canvas').addEventListener('blur', () => {
      this.saveCurrentSlide();
    });

    // Present mode
    document.getElementById('slides-present').addEventListener('click', () => this.startPresentation());

    // Save to Drive
    document.getElementById('slides-save-drive').addEventListener('click', () => this.saveToDrive());
  },

  saveCurrentSlide() {
    const canvas = document.getElementById('slides-canvas');
    this.slides[this.currentSlide].content = canvas.innerHTML;
    this.renderPanel();
  },

  loadSlide(index) {
    this.currentSlide = index;
    const slide = this.slides[index];
    const canvas = document.getElementById('slides-canvas');
    canvas.innerHTML = slide.content;
    canvas.style.backgroundColor = slide.bg;

    // Update bg select
    const bgSelect = document.getElementById('slides-bg-color');
    bgSelect.value = slide.bg;

    this.highlightThumb(index);
  },

  renderPanel() {
    const panel = document.getElementById('slides-panel');
    panel.innerHTML = this.slides.map((slide, i) => {
      const preview = slide.content.replace(/<[^>]+>/g, ' ').substring(0, 30);
      return `<div class="slide-thumb ${i === this.currentSlide ? 'active' : ''}" data-index="${i}" style="background:${slide.bg}">
        <span class="slide-thumb-number">${i + 1}</span>
        ${preview || 'Vazio'}
      </div>`;
    }).join('');

    panel.querySelectorAll('.slide-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        this.saveCurrentSlide();
        this.loadSlide(parseInt(thumb.dataset.index));
      });
    });
  },

  highlightThumb(index) {
    document.querySelectorAll('.slide-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === index);
    });
  },

  startPresentation() {
    this.saveCurrentSlide();
    let presentIndex = 0;
    const overlay = document.createElement('div');
    overlay.className = 'slides-fullscreen';

    const canvas = document.createElement('div');
    canvas.className = 'slides-canvas';
    canvas.style.backgroundColor = this.slides[presentIndex].bg;
    canvas.innerHTML = this.slides[presentIndex].content;
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    const navigate = (dir) => {
      presentIndex += dir;
      if (presentIndex < 0) presentIndex = 0;
      if (presentIndex >= this.slides.length) {
        overlay.remove();
        document.removeEventListener('keydown', keyHandler);
        return;
      }
      canvas.innerHTML = this.slides[presentIndex].content;
      canvas.style.backgroundColor = this.slides[presentIndex].bg;
    };

    const keyHandler = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') navigate(1);
      else if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
    };
    document.addEventListener('keydown', keyHandler);
    overlay.addEventListener('click', () => navigate(1));
  },

  async saveToDrive() {
    this.saveCurrentSlide();
    const name = await showPrompt('Salvar no Drive', 'Nome da apresentação');
    if (!name) return;
    const fileName = name.endsWith('.html') ? name : name + '.html';

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + fileName + '</title>';
    html += '<style>body{margin:0;font-family:Inter,sans-serif;}.slide{width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;color:#fff;} h1{font-size:3rem;margin-bottom:16px;} p{font-size:1.4rem;opacity:0.7;}</style>';
    html += '</head><body>';
    this.slides.forEach(slide => {
      html += `<div class="slide" style="background:${slide.bg}">${slide.content}</div>`;
    });
    html += '</body></html>';

    const base64 = 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(html)));
    await db.files.add({
      name: fileName,
      parentId: DriveApp.getParentId(),
      type: 'file',
      mimeType: 'text/html',
      blob: base64,
      createdAt: Date.now()
    });

    const btn = document.getElementById('slides-save-drive');
    const icon = btn.querySelector('.material-icons-round');
    icon.textContent = 'check_circle';
    btn.style.color = 'var(--emerald)';
    setTimeout(() => { icon.textContent = 'cloud_upload'; btn.style.color = ''; }, 2000);
  }
};


/* ============================================
   8. ORBIT PAINT (Drawing Canvas)
   ============================================ */
const PaintApp = {
  initialized: false,
  canvas: null,
  ctx: null,
  isDrawing: false,
  currentTool: 'brush',
  color: '#a78bfa',
  size: 4,
  history: [],
  startX: 0,
  startY: 0,
  snapshot: null,

  init() {
    if (this.initialized) {
      this.resizeCanvas();
      return;
    }
    this.initialized = true;

    this.canvas = document.getElementById('paint-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.resizeCanvas();

    // Tool buttons
    document.querySelectorAll('.paint-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.paint-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
      });
    });

    // Color
    document.getElementById('paint-color').addEventListener('input', (e) => {
      this.color = e.target.value;
    });

    // Size
    const sizeSlider = document.getElementById('paint-size');
    sizeSlider.addEventListener('input', (e) => {
      this.size = parseInt(e.target.value);
      document.getElementById('paint-size-label').textContent = this.size + 'px';
    });

    // Clear
    document.getElementById('paint-clear').addEventListener('click', () => {
      this.ctx.fillStyle = '#fff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.saveHistory();
    });

    // Undo
    document.getElementById('paint-undo').addEventListener('click', () => {
      if (this.history.length > 1) {
        this.history.pop();
        const img = new Image();
        img.onload = () => {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.drawImage(img, 0, 0);
        };
        img.src = this.history[this.history.length - 1];
      }
    });

    // Export PNG
    document.getElementById('paint-export-png').addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'orbit-paint.png';
      link.href = this.canvas.toDataURL();
      link.click();
    });

    // Save to Drive
    document.getElementById('paint-save-drive').addEventListener('click', () => this.saveToDrive());

    // Drawing events — mouse
    this.canvas.addEventListener('mousedown', (e) => this.onPointerDown(e.offsetX, e.offsetY));
    this.canvas.addEventListener('mousemove', (e) => this.onPointerMove(e.offsetX, e.offsetY));
    this.canvas.addEventListener('mouseup', () => this.onPointerUp());
    this.canvas.addEventListener('mouseleave', () => this.onPointerUp());

    // Drawing events — touch
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.touches[0];
      this.onPointerDown(
        (touch.clientX - rect.left) * (this.canvas.width / rect.width),
        (touch.clientY - rect.top) * (this.canvas.height / rect.height)
      );
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.touches[0];
      this.onPointerMove(
        (touch.clientX - rect.left) * (this.canvas.width / rect.width),
        (touch.clientY - rect.top) * (this.canvas.height / rect.height)
      );
    });
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.onPointerUp();
    });

    // Resize observer
    const wrap = this.canvas.parentElement;
    new ResizeObserver(() => this.resizeCanvas()).observe(wrap);

    // Initial white bg
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.saveHistory();
  },

  resizeCanvas() {
    if (!this.canvas) return;
    const wrap = this.canvas.parentElement;
    const prevData = this.canvas.toDataURL();
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;

    // Restore content
    if (this.history.length > 0) {
      const img = new Image();
      img.onload = () => this.ctx.drawImage(img, 0, 0);
      img.src = prevData;
    } else {
      this.ctx.fillStyle = '#fff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  onPointerDown(x, y) {
    this.isDrawing = true;
    this.startX = x;
    this.startY = y;

    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
    }

    // Save snapshot for shape tools
    if (['line', 'rect', 'circle'].includes(this.currentTool)) {
      this.snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  onPointerMove(x, y) {
    if (!this.isDrawing) return;

    if (this.currentTool === 'brush') {
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.size;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    } else if (this.currentTool === 'eraser') {
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = this.size * 3;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    } else if (this.currentTool === 'line') {
      this.ctx.putImageData(this.snapshot, 0, 0);
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX, this.startY);
      this.ctx.lineTo(x, y);
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.size;
      this.ctx.lineCap = 'round';
      this.ctx.stroke();
    } else if (this.currentTool === 'rect') {
      this.ctx.putImageData(this.snapshot, 0, 0);
      this.ctx.beginPath();
      this.ctx.rect(this.startX, this.startY, x - this.startX, y - this.startY);
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.size;
      this.ctx.stroke();
    } else if (this.currentTool === 'circle') {
      this.ctx.putImageData(this.snapshot, 0, 0);
      const rx = Math.abs(x - this.startX) / 2;
      const ry = Math.abs(y - this.startY) / 2;
      const cx = this.startX + (x - this.startX) / 2;
      const cy = this.startY + (y - this.startY) / 2;
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.size;
      this.ctx.stroke();
    }
  },

  onPointerUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.ctx.beginPath();
    this.saveHistory();
  },

  saveHistory() {
    if (this.history.length > 30) this.history.shift();
    this.history.push(this.canvas.toDataURL());
  },

  async saveToDrive() {
    const name = await showPrompt('Salvar no Drive', 'Nome do desenho');
    if (!name) return;
    const fileName = name.endsWith('.png') ? name : name + '.png';
    const dataUrl = this.canvas.toDataURL('image/png');

    await db.files.add({
      name: fileName,
      parentId: DriveApp.getParentId(),
      type: 'file',
      mimeType: 'image/png',
      blob: dataUrl,
      createdAt: Date.now()
    });

    const btn = document.getElementById('paint-save-drive');
    const icon = btn.querySelector('.material-icons-round');
    icon.textContent = 'check_circle';
    btn.style.color = 'var(--emerald)';
    setTimeout(() => { icon.textContent = 'cloud_upload'; btn.style.color = ''; }, 2000);
  }
};


/* ============================================
   9. ORBIT CALENDAR
   ============================================ */
const CalendarApp = {
  initialized: false,
  currentDate: new Date(),
  events: [],

  init() {
    if (this.initialized) {
      this.loadEvents();
      return;
    }
    this.initialized = true;

    // Navigation
    document.getElementById('cal-prev').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.loadEvents();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.loadEvents();
    });
    document.getElementById('cal-today').addEventListener('click', () => {
      this.currentDate = new Date();
      this.loadEvents();
    });

    this.loadEvents();
  },

  async loadEvents() {
    this.events = await db.calendarEvents.toArray();
    this.render();
  },

  render() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    document.getElementById('cal-title').textContent = `${meses[month]} ${year}`;

    const grid = document.getElementById('calendar-grid');
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    let html = dias.map(d => `<div class="cal-day-header">${d}</div>`).join('');

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      html += `<div class="cal-day other-month"><span class="cal-day-number">${day}</span></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = isCurrentMonth && today.getDate() === d;
      const dayEvents = this.events.filter(e => e.date === dateStr);

      let eventDots = '';
      if (dayEvents.length > 0) {
        eventDots = '<div class="cal-events">' +
          dayEvents.map(e => `<div class="cal-event-dot" style="background:${e.color || '#6366f1'}" title="${this.escapeHtml(e.title)}"></div>`).join('') +
          '</div>';
      }

      html += `<div class="cal-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <span class="cal-day-number">${d}</span>
        ${eventDots}
      </div>`;
    }

    // Next month padding
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
      html += `<div class="cal-day other-month"><span class="cal-day-number">${i}</span></div>`;
    }

    grid.innerHTML = html;

    // Click to add event
    grid.querySelectorAll('.cal-day:not(.other-month)').forEach(dayEl => {
      dayEl.addEventListener('click', async () => {
        const date = dayEl.dataset.date;
        const title = await showPrompt('Novo Evento', 'Título do evento');
        if (!title) return;

        const colors = ['#6366f1', '#22c55e', '#ef4444', '#f97316', '#ec4899', '#38bdf8'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        await db.calendarEvents.add({
          title,
          date,
          color,
          createdAt: Date.now()
        });

        this.loadEvents();
      });

      // Long press / right-click to view/delete events
      dayEl.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const date = dayEl.dataset.date;
        const dayEvents = this.events.filter(ev => ev.date === date);
        if (dayEvents.length === 0) return;

        const listHtml = dayEvents.map(ev =>
          `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="width:10px;height:10px;border-radius:50%;background:${ev.color};flex-shrink:0;"></div>
            <span style="flex:1;color:var(--text-primary);font-size:0.9rem;">${this.escapeHtml(ev.title)}</span>
            <button onclick="CalendarApp.deleteEvent(${ev.id})" style="background:none;border:none;color:var(--rose);cursor:pointer;padding:4px;"><span class="material-icons-round" style="font-size:18px;">delete</span></button>
          </div>`
        ).join('');

        showPreview(`Eventos — ${date}`, listHtml);
      });
    });
  },

  async deleteEvent(id) {
    await db.calendarEvents.delete(id);
    // Close preview
    document.getElementById('preview-modal').classList.add('hidden');
    this.loadEvents();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};


/* ============================================
   10. POMODORO TIMER
   ============================================ */
const PomodoroApp = {
  initialized: false,
  mode: 'work',     // 'work' | 'short' | 'long'
  durations: { work: 25 * 60, short: 5 * 60, long: 15 * 60 },
  timeRemaining: 25 * 60,
  totalTime: 25 * 60,
  running: false,
  interval: null,
  sessionsToday: 0,
  totalFocusTime: 0,

  init() {
    if (this.initialized) {
      this.updateStats();
      return;
    }
    this.initialized = true;

    // Mode tabs
    document.querySelectorAll('.pomo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.setMode(tab.dataset.mode);
      });
    });

    // Start/Pause
    document.getElementById('pomo-start').addEventListener('click', () => {
      if (this.running) this.pause();
      else this.start();
    });

    // Reset
    document.getElementById('pomo-reset').addEventListener('click', () => this.reset());

    this.loadStats();
    this.updateDisplay();
  },

  setMode(mode) {
    this.pause();
    this.mode = mode;
    this.timeRemaining = this.durations[mode];
    this.totalTime = this.durations[mode];

    document.querySelectorAll('.pomo-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.pomo-tab[data-mode="${mode}"]`).classList.add('active');

    // Change progress color based on mode
    const progress = document.getElementById('pomo-progress');
    if (mode === 'work') {
      progress.style.stroke = 'var(--app-pomodoro)';
      progress.style.filter = 'drop-shadow(0 0 8px var(--app-pomodoro-glow))';
    } else {
      progress.style.stroke = 'var(--app-sheets)';
      progress.style.filter = 'drop-shadow(0 0 8px var(--app-sheets-glow))';
    }

    this.updateDisplay();
  },

  start() {
    this.running = true;
    const startBtn = document.getElementById('pomo-start');
    startBtn.querySelector('.material-icons-round').textContent = 'pause';
    startBtn.classList.add('running');

    this.interval = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        this.complete();
      }
      this.updateDisplay();
    }, 1000);
  },

  pause() {
    this.running = false;
    clearInterval(this.interval);
    const startBtn = document.getElementById('pomo-start');
    startBtn.querySelector('.material-icons-round').textContent = 'play_arrow';
    startBtn.classList.remove('running');
  },

  reset() {
    this.pause();
    this.timeRemaining = this.durations[this.mode];
    this.totalTime = this.durations[this.mode];
    this.updateDisplay();
  },

  async complete() {
    this.pause();

    // Save session
    if (this.mode === 'work') {
      this.sessionsToday++;
      this.totalFocusTime += this.durations.work;
      await db.pomodoroSessions.add({
        type: 'work',
        duration: this.durations.work,
        completedAt: Date.now()
      });
    }

    this.updateStats();
    this.timeRemaining = 0;
    this.updateDisplay();

    // Auto-switch to break
    setTimeout(() => {
      if (this.mode === 'work') {
        this.setMode(this.sessionsToday % 4 === 0 ? 'long' : 'short');
      } else {
        this.setMode('work');
      }
    }, 1500);
  },

  updateDisplay() {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    document.getElementById('pomo-time').textContent =
      String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');

    // Update ring progress
    const circumference = 2 * Math.PI * 90; // r=90
    const progress = this.totalTime > 0 ? (this.totalTime - this.timeRemaining) / this.totalTime : 0;
    const offset = circumference * (1 - progress);
    document.getElementById('pomo-progress').style.strokeDashoffset = offset;
  },

  async loadStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const allSessions = await db.pomodoroSessions
      .where('completedAt')
      .above(todayStart.getTime())
      .toArray();

    this.sessionsToday = allSessions.filter(s => s.type === 'work').length;
    this.totalFocusTime = allSessions
      .filter(s => s.type === 'work')
      .reduce((sum, s) => sum + s.duration, 0);

    this.updateStats();
  },

  updateStats() {
    document.getElementById('pomo-sessions').textContent = this.sessionsToday;
    const mins = Math.round(this.totalFocusTime / 60);
    document.getElementById('pomo-total-time').textContent = mins >= 60
      ? Math.floor(mins / 60) + 'h' + (mins % 60 > 0 ? mins % 60 + 'm' : '')
      : mins + 'm';
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
