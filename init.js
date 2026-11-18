const PRIORIDADE = Object.freeze({
  BAIXA: 1,
  MEDIA: 2,
  ALTA: 3,
  CRITICA: 4,
});

const STATUS = Object.freeze({
  PENDENTE: "pendente",
  EM_ANDAMENTO: "em_andamento",
  CONCLUIDA: "concluida",
  CANCELADA: "cancelada",
});

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(evento, callback) {
    if (!this.listeners.has(evento)) {
      this.listeners.set(evento, new Set());
    }
    this.listeners.get(evento).add(callback);
    return () => this.off(evento, callback);
  }

  off(evento, callback) {
    const set = this.listeners.get(evento);
    if (set) {
      set.delete(callback);
    }
  }

  emit(evento, payload) {
    const set = this.listeners.get(evento);
    if (!set) return;
    for (const callback of set) {
      try {
        callback(payload);
      } catch (err) {
        console.error(`Erro no listener do evento "${evento}":`, err);
      }
    }
  }
}

class Tarefa {
  constructor({
    id,
    titulo,
    descricao = "",
    prioridade = PRIORIDADE.MEDIA,
    tags = [],
    prazo = null,
  }) {
    if (!titulo || typeof titulo !== "string" || !titulo.trim()) {
      throw new Error("O título da tarefa é obrigatório.");
    }
    if (!Object.values(PRIORIDADE).includes(prioridade)) {
      throw new Error("Prioridade inválida.");
    }

    this.id = id ?? `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.titulo = titulo.trim();
    this.descricao = descricao.trim();
    this.prioridade = prioridade;
    this.status = STATUS.PENDENTE;
    this.tags = [...new Set(tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
    this.prazo = prazo ? new Date(prazo) : null;
    this.criadaEm = new Date();
    this.atualizadaEm = new Date();
    this.concluidaEm = null;
  }

  atualizarStatus(novoStatus) {
    if (!Object.values(STATUS).includes(novoStatus)) {
      throw new Error(`Status inválido: ${novoStatus}`);
    }
    this.status = novoStatus;
    this.atualizadaEm = new Date();
    this.concluidaEm = novoStatus === STATUS.CONCLUIDA ? new Date() : null;
  }

  clonar() {
    const copia = new Tarefa({
      id: this.id,
      titulo: this.titulo,
      descricao: this.descricao,
      prioridade: this.prioridade,
      tags: this.tags,
      prazo: this.prazo ? this.prazo.toISOString() : null,
    });
    copia.status = this.status;
    copia.criadaEm = new Date(this.criadaEm);
    copia.atualizadaEm = new Date(this.atualizadaEm);
    copia.concluidaEm = this.concluidaEm ? new Date(this.concluidaEm) : null;
    return copia;
  }
}

class GerenciadorTarefas {
  constructor() {
    this.tarefas = new Map();
    this.eventos = new EventBus();
    this.historico = [];
    this.indiceHistorico = -1;
    this.limiteHistorico = 50;
  }

  _snapshot() {
    const estado = Array.from(this.tarefas.values()).map((t) => t.clonar());
    this.historico = this.historico.slice(0, this.indiceHistorico + 1);
    this.historico.push(estado);

    if (this.historico.length > this.limiteHistorico) {
      this.historico.shift();
    } else {
      this.indiceHistorico++;
    }
  }

  _restaurarSnapshot(estado) {
    this.tarefas.clear();
    for (const tarefa of estado) {
      this.tarefas.set(tarefa.id, tarefa.clonar());
    }
    this.eventos.emit("estadoAlterado", this.listar());
  }

  desfazer() {
    if (this.indiceHistorico <= 0) return false;
    this.indiceHistorico--;
    this._restaurarSnapshot(this.historico[this.indiceHistorico]);
    return true;
  }

  refazer() {
    if (this.indiceHistorico >= this.historico.length - 1) return false;
    this.indiceHistorico++;
    this._restaurarSnapshot(this.historico[this.indiceHistorico]);
    return true;
  }

  adicionar(dados) {
    if (this.indiceHistorico === -1) {
      this._snapshot();
    }
    const tarefa = new Tarefa(dados);
    this.tarefas.set(tarefa.id, tarefa);
    this._snapshot();
    this.eventos.emit("tarefaAdicionada", tarefa.clonar());
    return tarefa;
  }

  obter(id) {
    return this.tarefas.get(id) || null;
  }

  editar(id, campos) {
    const tarefa = this.tarefas.get(id);
    if (!tarefa) {
      throw new Error(`Tarefa não encontrada: ${id}`);
    }

    if (typeof campos.titulo === "string" && campos.titulo.trim()) {
      tarefa.titulo = campos.titulo.trim();
    }
    if (typeof campos.descricao === "string") {
      tarefa.descricao = campos.descricao.trim();
    }
    if (campos.prioridade !== undefined) {
      if (!Object.values(PRIORIDADE).includes(campos.prioridade)) {
        throw new Error("Prioridade inválida.");
      }
      tarefa.prioridade = campos.prioridade;
    }
    if (Array.isArray(campos.tags)) {
      tarefa.tags = [...new Set(campos.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
    }
    if (campos.prazo !== undefined) {
      tarefa.prazo = campos.prazo ? new Date(campos.prazo) : null;
    }
    if (campos.status !== undefined) {
      tarefa.atualizarStatus(campos.status);
    } else {
      tarefa.atualizadaEm = new Date();
    }

    this._snapshot();
    this.eventos.emit("tarefaAtualizada", tarefa.clonar());
    return tarefa;
  }

  remover(id) {
    const tarefa = this.tarefas.get(id);
    if (!tarefa) return false;
    this.tarefas.delete(id);
    this._snapshot();
    this.eventos.emit("tarefaRemovida", tarefa.clonar());
    return true;
  }

  proximaTarefa() {
    const pendentes = this.listar({ status: STATUS.PENDENTE });
    if (pendentes.length === 0) return null;

    return pendentes.sort((a, b) => {
      if (b.prioridade !== a.prioridade) {
        return b.prioridade - a.prioridade;
      }
      const prazoA = a.prazo ? a.prazo.getTime() : Infinity;
      const prazoB = b.prazo ? b.prazo.getTime() : Infinity;
      if (prazoA !== prazoB) {
        return prazoA - prazoB;
      }
      return a.criadaEm.getTime() - b.criadaEm.getTime();
    })[0];
  }

  listar({ status, prioridade, tag, busca, ordenarPor = "prioridade" } = {}) {
    let resultado = Array.from(this.tarefas.values());

    if (status) {
      resultado = resultado.filter((t) => t.status === status);
    }
    if (prioridade) {
      resultado = resultado.filter((t) => t.prioridade === prioridade);
    }
    if (tag) {
      const tagNormalizada = String(tag).toLowerCase().trim();
      resultado = resultado.filter((t) => t.tags.includes(tagNormalizada));
    }
    if (busca && busca.trim()) {
      const termo = busca.toLowerCase().trim();
      resultado = resultado.filter(
        (t) =>
          t.titulo.toLowerCase().includes(termo) ||
          t.descricao.toLowerCase().includes(termo) ||
          t.tags.some((tg) => tg.includes(termo))
      );
    }

    const comparadores = {
      prioridade: (a, b) => b.prioridade - a.prioridade || a.criadaEm - b.criadaEm,
      prazo: (a, b) => {
        const pa = a.prazo ? a.prazo.getTime() : Infinity;
        const pb = b.prazo ? b.prazo.getTime() : Infinity;
        return pa - pb;
      },
      criacao: (a, b) => a.criadaEm - b.criadaEm,
      titulo: (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"),
    };

    const comparador = comparadores[ordenarPor] || comparadores.prioridade;
    return resultado.sort(comparador);
  }

  estatisticas() {
    const todas = Array.from(this.tarefas.values());
    const agora = Date.now();

    const porStatus = {
      [STATUS.PENDENTE]: 0,
      [STATUS.EM_ANDAMENTO]: 0,
      [STATUS.CONCLUIDA]: 0,
      [STATUS.CANCELADA]: 0,
    };

    const porPrioridade = {
      [PRIORIDADE.BAIXA]: 0,
      [PRIORIDADE.MEDIA]: 0,
      [PRIORIDADE.ALTA]: 0,
      [PRIORIDADE.CRITICA]: 0,
    };

    let atrasadas = 0;

    for (const t of todas) {
      porStatus[t.status]++;
      porPrioridade[t.prioridade]++;
      if (
        t.prazo &&
        t.prazo.getTime() < agora &&
        t.status !== STATUS.CONCLUIDA &&
        t.status !== STATUS.CANCELADA
      ) {
        atrasadas++;
      }
    }

    const total = todas.length;
    const concluidas = porStatus[STATUS.CONCLUIDA];
    const percentualConcluido = total > 0 ? Number(((concluidas / total) * 100).toFixed(1)) : 0;

    return {
      total,
      atrasadas,
      percentualConcluido,
      porStatus,
      porPrioridade,
    };
  }

  exportarJSON() {
    return JSON.stringify(Array.from(this.tarefas.values()), null, 2);
  }

  importarJSON(jsonString, { substituir = false } = {}) {
    const dados = JSON.parse(jsonString);
    if (!Array.isArray(dados)) {
      throw new Error("O JSON importado deve conter um array de tarefas.");
    }

    if (substituir) {
      this.tarefas.clear();
    }

    for (const item of dados) {
      const tarefa = new Tarefa(item);
      if (item.status) tarefa.atualizarStatus(item.status);
      this.tarefas.set(tarefa.id, tarefa);
    }

    this._snapshot();
    this.eventos.emit("estadoAlterado", this.listar());
    return this.tarefas.size;
  }
}

// --- Exemplo de uso ---
const app = new GerenciadorTarefas();

app.eventos.on("tarefaAdicionada", (t) => {
  console.log(`[+] Nova tarefa: "${t.titulo}" (ID: ${t.id})`);
});

app.eventos.on("tarefaAtualizada", (t) => {
  console.log(`[~] Tarefa atualizada: "${t.titulo}" -> ${t.status}`);
});

const t1 = app.adicionar({
  titulo: "Corrigir bug de autenticação",
  descricao: "Token expira antes do tempo em rotas protegidas",
  prioridade: PRIORIDADE.CRITICA,
  tags: ["backend", "seguranca"],
  prazo: new Date(Date.now() + 3600 * 1000 * 4),
});

const t2 = app.adicionar({
  titulo: "Atualizar documentação da API",
  descricao: "Adicionar exemplos de payload no README",
  prioridade: PRIORIDADE.BAIXA,
  tags: ["docs"],
});

const t3 = app.adicionar({
  titulo: "Revisar pull request do checkout",
  prioridade: PRIORIDADE.ALTA,
  tags: ["frontend", "review"],
});

const urgente = app.proximaTarefa();
console.log("Próxima tarefa recomendada:", urgente?.titulo);

app.editar(t1.id, { status: STATUS.EM_ANDAMENTO });
console.log("Estatísticas:", app.estatisticas());

app.desfazer();
