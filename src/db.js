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
      valor_mercadoria   NUMERIC NOT NULL,
      tipo_veiculo       TEXT NOT NULL,
      comercial          TEXT NOT NULL,
      observacoes        TEXT,
      prazo_resposta     TIMESTAMPTZ NOT NULL,
      parceiro_vencedor  INTEGER REFERENCES parceiros(id),
      valor_fechado      NUMERIC,
      comissao_variavel  NUMERIC DEFAULT 0,
      fechado_em         TIMESTAMPTZ,
      criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
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
}

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
      `INSERT INTO cotacoes (origem, destino, peso_kg, valor_mercadoria, tipo_veiculo, comercial, observacoes, prazo_resposta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.origem, d.destino, d.peso_kg, d.valor_mercadoria, d.tipo_veiculo, d.comercial, d.observacoes || null, d.prazo_resposta]
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
};

// ---------- Convites ----------
export const convites = {
  criar: async (cotacao_id, parceiro_id, token) =>
    (await query('INSERT INTO convites (cotacao_id, parceiro_id, token) VALUES ($1,$2,$3) RETURNING *',
      [cotacao_id, parceiro_id, token])).rows[0],
  porToken: async (token) => (await query('SELECT * FROM convites WHERE token = $1', [token])).rows[0],
  porCotacao: async (cotacaoId) =>
    (await query('SELECT * FROM convites WHERE cotacao_id = $1', [Number(cotacaoId)])).rows,
  registrarResposta: async (token, { valor_cotado, prazo_entrega, comentario }) =>
    (await query(
      `UPDATE convites SET valor_cotado = $2, prazo_entrega = $3, comentario = $4, respondido_em = now()
       WHERE token = $1 RETURNING *`,
      [token, valor_cotado, prazo_entrega || null, comentario || null]
    )).rows[0],
};

export default { inicializarBanco, parceiros, cotacoes, convites };
