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
}

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
      `INSERT INTO cotacoes (origem, destino, peso_kg, produto, volume, valor_mercadoria, tipo_veiculo, comercial, data_coleta, data_entrega, observacoes, prazo_resposta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [d.origem, d.destino, d.peso_kg, d.produto || null, d.volume || null, d.valor_mercadoria, d.tipo_veiculo, d.comercial,
       d.data_coleta || null, d.data_entrega || null, d.observacoes || null, d.prazo_resposta]
    )).rows[0],
  fechar: async (id, { parceiro_vencedor, valor_fechado, comissao_variavel }) =>
    (await query(
      `UPDATE cotacoes
       SET parceiro_vencedor = $2, valor_fechado = $3, comissao_variavel = $4, fechado_em = now()
       WHERE id = $1 RETURNING *`,
      [Number(id), parceiro_vencedor, valor_fechado, comissao_variavel || 0]
    )).rows[0],
  atualizarComissao: async (id, comissao) =>
    (await query('UPDATE cotacoes SET comissao_variavel = $2 WHERE id = $1 RETURNING *', [Number(id), comissao || 0])).rows[0],
  marcarNotificado: async (id) =>
    (await query('UPDATE cotacoes SET resultado_notificado_em = now() WHERE id = $1 RETURNING *', [Number(id)])).rows[0],
  salvarVeiculo: async (id, { placa, motorista, telefone }) =>
    (await query(
      `UPDATE cotacoes SET veiculo_placa = $2, motorista_nome = $3, motorista_telefone = $4, veiculo_preenchido_em = now()
       WHERE id = $1 RETURNING *`,
      [Number(id), placa || null, motorista || null, telefone || null]
    )).rows[0],
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

export default { inicializarBanco, parceiros, cotacoes, convites, usuarios };
