// Camada de dados. Usa o adaptador (Postgres em producao, SQLite nos testes).
// Todas as funcoes sao assincronas e retornam Promises.
import { query } from './database-adapter.js';

// ---------- Criacao das tabelas (idempotente) ----------
export async function inicializarBanco() {
  await query(`
    CREATE TABLE IF NOT EXISTS parceiros (
      id         SERIAL PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS cotacoes (
      id                 SERIAL PRIMARY KEY,
      origem             TEXT NOT NULL,
      destino            TEXT NOT NULL,
      peso_kg            NUMERIC NOT NULL,
      produto            TEXT,
      volume             TEXT,
      valor_mercadoria   NUMERIC NOT NULL,
      tipo_veiculo       TEXT NOT NULL,
      comercial          TEXT NOT NULL,
      data_coleta        DATE,
      data_entrega       DATE,
      observacoes        TEXT,
      prazo_resposta     TIMESTAMPTZ NOT NULL,
      parceiro_vencedor  INTEGER REFERENCES parceiros(id),
      valor_fechado      NUMERIC,
      comissao_variavel  NUMERIC DEFAULT 0,
      bonificacao        NUMERIC DEFAULT 0,
      fechado_em         TIMESTAMPTZ,
      resultado_notificado_em TIMESTAMPTZ,
      veiculo_placa      TEXT,
      motorista_nome     TEXT,
      motorista_telefone TEXT,
      veiculo_preenchido_em TIMESTAMPTZ,
      criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Migracao idempotente: adiciona as colunas novas em bancos que ja existiam.
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS produto TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS volume TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS data_coleta DATE`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS data_entrega DATE`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS resultado_notificado_em TIMESTAMPTZ`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS veiculo_placa TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS motorista_nome TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS motorista_telefone TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS veiculo_preenchido_em TIMESTAMPTZ`);
  // Acompanhamento da viagem (preenchido pelo parceiro vencedor)
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS coletado TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS coletado_em TIMESTAMPTZ`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS entregue TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS comprovante_url TEXT`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS bonificacao NUMERIC DEFAULT 0`);
  // Controle financeiro: data em que recebemos do parceiro / pagamos a bonificacao (vazio = pendente)
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS recebido_em DATE`);
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS bonificacao_paga_em DATE`);
  await query(`
    CREATE TABLE IF NOT EXISTS convites (
      id             SERIAL PRIMARY KEY,
      cotacao_id     INTEGER NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
      parceiro_id    INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
      token          TEXT NOT NULL UNIQUE,
      valor_cotado   NUMERIC,
      prazo_entrega  TEXT,
      comentario     TEXT,
      respondido_em  TIMESTAMPTZ,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil     TEXT NOT NULL DEFAULT 'comercial', -- 'adm' | 'comercial'
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // ----- Modulo Leads -----
  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id              SERIAL PRIMARY KEY,
      empresa         TEXT NOT NULL,
      contato         TEXT,
      telefone        TEXT,
      email           TEXT,
      origem          TEXT,
      comercial       TEXT NOT NULL,
      etapa           TEXT NOT NULL DEFAULT 'novo',
      proximo_contato DATE,
      observacoes     TEXT,
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS lead_contatos (
      id         SERIAL PRIMARY KEY,
      lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      tipo       TEXT NOT NULL,
      descricao  TEXT NOT NULL,
      autor      TEXT,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Vinculo Lead -> Cotacao (opcional). Se o lead for excluido, a cotacao e mantida (lead_id vira nulo).
  await query(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL`);
}

// ---------- Leads ----------
export const leads = {
  listar: async () => (await query('SELECT * FROM leads ORDER BY id DESC')).rows,
  obter: async (id) => (await query('SELECT * FROM leads WHERE id = $1', [Number(id)])).rows[0],
  criar: async (d) =>
    (await query(
      `INSERT INTO leads (empresa, contato, telefone, email, origem, comercial, etapa, proximo_contato, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.empresa, d.contato || null, d.telefone || null, d.email || null, d.origem || null,
       d.comercial, d.etapa || 'novo', d.proximo_contato || null, d.observacoes || null]
    )).rows[0],
  atualizar: async (id, d) =>
    (await query(
      `UPDATE leads SET empresa = $2, contato = $3, telefone = $4, email = $5, origem = $6,
         comercial = $7, etapa = $8, proximo_contato = $9, observacoes = $10, atualizado_em = now()
       WHERE id = $1 RETURNING *`,
      [Number(id), d.empresa, d.contato || null, d.telefone || null, d.email || null, d.origem || null,
       d.comercial, d.etapa, d.proximo_contato || null, d.observacoes || null]
    )).rows[0],
  // usado ao registrar um contato: atualiza etapa e proximo contato
  atualizarAndamento: async (id, etapa, proximo_contato) =>
    (await query(
      'UPDATE leads SET etapa = $2, proximo_contato = $3, atualizado_em = now() WHERE id = $1 RETURNING *',
      [Number(id), etapa, proximo_contato || null]
    )).rows[0],
  excluir: async (id) => { await query('DELETE FROM leads WHERE id = $1', [Number(id)]); },
};

export const leadContatos = {
  porLead: async (leadId) =>
    (await query('SELECT * FROM lead_contatos WHERE lead_id = $1 ORDER BY id DESC', [Number(leadId)])).rows,
  criar: async (leadId, tipo, descricao, autor) =>
    (await query(
      'INSERT INTO lead_contatos (lead_id, tipo, descricao, autor) VALUES ($1,$2,$3,$4) RETURNING *',
      [Number(leadId), tipo, descricao, autor || null]
    )).rows[0],
};

// ---------- Usuarios (login) ----------
export const usuarios = {
  listar: async () => (await query('SELECT id, nome, email, perfil, criado_em FROM usuarios ORDER BY nome')).rows,
  porEmail: async (email) => (await query('SELECT * FROM usuarios WHERE email = $1', [String(email).toLowerCase().trim()])).rows[0],
  porId: async (id) => (await query('SELECT id, nome, email, perfil, criado_em FROM usuarios WHERE id = $1', [Number(id)])).rows[0],
  contar: async () => Number((await query('SELECT COUNT(*)::int AS n FROM usuarios')).rows[0].n),
  criar: async (nome, email, senha_hash, perfil) =>
    (await query(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1,$2,$3,$4) RETURNING id, nome, email, perfil',
      [nome, String(email).toLowerCase().trim(), senha_hash, perfil]
    )).rows[0],
  atualizarSenha: async (id, senha_hash) => { await query('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [Number(id), senha_hash]); },
  excluir: async (id) => { await query('DELETE FROM usuarios WHERE id = $1', [Number(id)]); },
};

// ---------- Parceiros ----------
export const parceiros = {
  listar: async () => (await query('SELECT * FROM parceiros ORDER BY nome')).rows,
  obter: async (id) => (await query('SELECT * FROM parceiros WHERE id = $1', [Number(id)])).rows[0],
  contar: async () => Number((await query('SELECT COUNT(*)::int AS n FROM parceiros')).rows[0].n),
  criar: async (nome, email) =>
    (await query('INSERT INTO parceiros (nome, email) VALUES ($1, $2) RETURNING *', [nome, email])).rows[0],
  excluir: async (id) => { await query('DELETE FROM parceiros WHERE id = $1', [Number(id)]); },
  // quantas cotacoes/convites este parceiro ja participou (para alertar antes de excluir)
  usos: async (id) =>
    Number((await query('SELECT COUNT(*)::int AS n FROM convites WHERE parceiro_id = $1', [Number(id)])).rows[0].n),
};

// ---------- Cotacoes ----------
export const cotacoes = {
  listar: async () => (await query('SELECT * FROM cotacoes ORDER BY id DESC')).rows,
  obter: async (id) => (await query('SELECT * FROM cotacoes WHERE id = $1', [Number(id)])).rows[0],
  criar: async (d) =>
    (await query(
      `INSERT INTO cotacoes (origem, destino, peso_kg, produto, volume, valor_mercadoria, tipo_veiculo, comercial, data_coleta, data_entrega, observacoes, prazo_resposta, lead_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [d.origem, d.destino, d.peso_kg, d.produto || null, d.volume || null, d.valor_mercadoria, d.tipo_veiculo, d.comercial,
       d.data_coleta || null, d.data_entrega || null, d.observacoes || null, d.prazo_resposta, d.lead_id || null]
    )).rows[0],
  porLead: async (leadId) =>
    (await query('SELECT * FROM cotacoes WHERE lead_id = $1 ORDER BY id DESC', [Number(leadId)])).rows,
  // vincula (ou desvincula, com null) uma cotacao a um lead
  vincularLead: async (id, leadId) =>
    (await query('UPDATE cotacoes SET lead_id = $2 WHERE id = $1 RETURNING *', [Number(id), leadId ? Number(leadId) : null])).rows[0],
  fechar: async (id, { parceiro_vencedor, valor_fechado, comissao_variavel }) =>
    (await query(
      `UPDATE cotacoes
       SET parceiro_vencedor = $2, valor_fechado = $3, comissao_variavel = $4, fechado_em = now()
       WHERE id = $1 RETURNING *`,
      [Number(id), parceiro_vencedor, valor_fechado, comissao_variavel || 0]
    )).rows[0],
  atualizarComissao: async (id, comissao, bonificacao) =>
    (await query('UPDATE cotacoes SET comissao_variavel = $2, bonificacao = $3 WHERE id = $1 RETURNING *',
      [Number(id), comissao || 0, bonificacao || 0])).rows[0],
  // Atualiza o controle financeiro. Datas em "YYYY-MM-DD" ou null (= pendente).
  atualizarFinanceiro: async (id, { recebido_em, bonificacao_paga_em }) =>
    (await query(
      'UPDATE cotacoes SET recebido_em = $2, bonificacao_paga_em = $3 WHERE id = $1 RETURNING *',
      [Number(id), recebido_em || null, bonificacao_paga_em || null]
    )).rows[0],
  marcarNotificado: async (id) =>
    (await query('UPDATE cotacoes SET resultado_notificado_em = now() WHERE id = $1 RETURNING *', [Number(id)])).rows[0],
  salvarVeiculo: async (id, { placa, motorista, telefone }) =>
    (await query(
      `UPDATE cotacoes SET veiculo_placa = $2, motorista_nome = $3, motorista_telefone = $4, veiculo_preenchido_em = now()
       WHERE id = $1 RETURNING *`,
      [Number(id), placa || null, motorista || null, telefone || null]
    )).rows[0],
  // Acompanhamento da viagem: coleta, entrega e comprovante (anexo).
  salvarAndamento: async (id, { coletado, entregue, comprovante_url }) => {
    const c = (await query('SELECT coletado, entregue, comprovante_url FROM cotacoes WHERE id = $1', [Number(id)])).rows[0] || {};
    const novoColetado = coletado ?? c.coletado;
    const novoEntregue = entregue ?? c.entregue;
    const novoComprovante = comprovante_url ?? c.comprovante_url;
    return (await query(
      `UPDATE cotacoes
       SET coletado = $2,
           coletado_em = CASE WHEN $2 = 'sim' AND coletado_em IS NULL THEN now() ELSE coletado_em END,
           entregue = $3,
           entregue_em = CASE WHEN $3 = 'sim' AND entregue_em IS NULL THEN now() ELSE entregue_em END,
           comprovante_url = $4
       WHERE id = $1 RETURNING *`,
      [Number(id), novoColetado, novoEntregue, novoComprovante]
    )).rows[0];
  },
};

// ---------- Convites ----------
export const convites = {
  criar: async (cotacao_id, parceiro_id, token) =>
    (await query('INSERT INTO convites (cotacao_id, parceiro_id, token) VALUES ($1,$2,$3) RETURNING *',
      [cotacao_id, parceiro_id, token])).rows[0],
  porToken: async (token) => (await query('SELECT * FROM convites WHERE token = $1', [token])).rows[0],
  porId: async (id) => (await query('SELECT * FROM convites WHERE id = $1', [Number(id)])).rows[0],
  porCotacao: async (cotacaoId) =>
    (await query('SELECT * FROM convites WHERE cotacao_id = $1', [Number(cotacaoId)])).rows,
  excluir: async (id) => { await query('DELETE FROM convites WHERE id = $1', [Number(id)]); },
  registrarResposta: async (token, { valor_cotado, prazo_entrega, comentario }) =>
    (await query(
      `UPDATE convites SET valor_cotado = $2, prazo_entrega = $3, comentario = $4, respondido_em = now()
       WHERE token = $1 RETURNING *`,
      [token, valor_cotado, prazo_entrega || null, comentario || null]
    )).rows[0],
};

export default { inicializarBanco, parceiros, cotacoes, convites, usuarios, leads, leadContatos };
