// Camada de dados usando o SQLite EMBUTIDO do Node.js 22+ (node:sqlite).
// Zero dependencias externas. Os dados ficam em um arquivo .db que, em
// producao (Render), mora em um disco persistente -> sobrevive a reinicios.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DATA_DIR permite apontar para o disco persistente do Render (ex: /var/data).
// Em desenvolvimento, usa a pasta ./data do projeto.
const dataDir = process.env.DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'cotacoes.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS parceiros (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT NOT NULL,
    email     TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cotacoes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    origem           TEXT NOT NULL,
    destino          TEXT NOT NULL,
    peso_kg          REAL NOT NULL,
    valor_mercadoria REAL NOT NULL,
    tipo_veiculo     TEXT NOT NULL,
    observacoes      TEXT,
    prazo_resposta   TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'aberta',
    criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS convites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    cotacao_id    INTEGER NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
    parceiro_id   INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    valor_cotado  REAL,
    prazo_entrega TEXT,
    comentario    TEXT,
    respondido_em TEXT,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Parceiros ----------
export const parceiros = {
  listar: () => db.prepare('SELECT * FROM parceiros ORDER BY nome').all(),
  obter: (id) => db.prepare('SELECT * FROM parceiros WHERE id = ?').get(Number(id)),
  contar: () => db.prepare('SELECT COUNT(*) AS n FROM parceiros').get().n,
  criar: (nome, email) => {
    const info = db.prepare('INSERT INTO parceiros (nome, email) VALUES (?, ?)').run(nome, email);
    return { id: Number(info.lastInsertRowid), nome, email };
  },
};

// ---------- Cotacoes ----------
export const cotacoes = {
  listar: () => db.prepare('SELECT * FROM cotacoes ORDER BY id DESC').all(),
  obter: (id) => db.prepare('SELECT * FROM cotacoes WHERE id = ?').get(Number(id)),
  criar: (d) => {
    const info = db.prepare(`
      INSERT INTO cotacoes (origem, destino, peso_kg, valor_mercadoria, tipo_veiculo, observacoes, prazo_resposta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(d.origem, d.destino, d.peso_kg, d.valor_mercadoria, d.tipo_veiculo, d.observacoes || null, d.prazo_resposta);
    return cotacoes.obter(Number(info.lastInsertRowid));
  },
};

// ---------- Convites ----------
export const convites = {
  criar: (cotacao_id, parceiro_id, token) => {
    db.prepare('INSERT INTO convites (cotacao_id, parceiro_id, token) VALUES (?, ?, ?)')
      .run(cotacao_id, parceiro_id, token);
  },
  porToken: (token) => db.prepare('SELECT * FROM convites WHERE token = ?').get(token),
  porCotacao: (cotacaoId) =>
    db.prepare('SELECT * FROM convites WHERE cotacao_id = ?').all(Number(cotacaoId)),
  registrarResposta: (token, { valor_cotado, prazo_entrega, comentario }) => {
    db.prepare(`
      UPDATE convites
      SET valor_cotado = ?, prazo_entrega = ?, comentario = ?, respondido_em = datetime('now')
      WHERE token = ?
    `).run(valor_cotado, prazo_entrega || null, comentario || null, token);
  },
};

export default { parceiros, cotacoes, convites };
