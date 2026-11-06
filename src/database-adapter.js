// Adaptador de banco que funciona com DOIS motores:
//  - PostgreSQL (Supabase) em producao  -> usado quando DATABASE_URL existe
//  - SQLite embutido (node:sqlite) local -> usado nos testes (sem internet/npm)
//
// Ambos expoem a MESMA interface assincrona: query(sql, params) -> { rows }.
// Os SQLs usam placeholders estilo Postgres ($1, $2...). No modo SQLite,
// convertemos $N para ? e traduzimos tipos (SERIAL, TIMESTAMPTZ, now(), ::int).

const usandoPostgres = Boolean(process.env.DATABASE_URL) && process.env.DB_ENGINE !== 'sqlite';

let _query; // função query(sql, params) => Promise<{ rows }>

if (usandoPostgres) {
  // ----- Motor PostgreSQL (producao / Supabase) -----
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  _query = async (sql, params = []) => pool.query(sql, params);
  console.log('[DB] Usando PostgreSQL (Supabase).');
} else {
  // ----- Motor SQLite (testes locais) -----
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dir = process.env.DATA_DIR || join(__dirname, '..', 'data');
  mkdirSync(dir, { recursive: true });
  const sdb = new DatabaseSync(join(dir, 'cotacoes.db'));
  sdb.exec('PRAGMA foreign_keys = ON');

  // traduz tipos/funcoes "estilo Postgres" para SQLite (SEM mexer nos placeholders)
  function traduzirTipos(sql) {
    return sql
      .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
      .replace(/TIMESTAMPTZ/gi, 'TEXT')
      .replace(/NUMERIC/gi, 'REAL')
      .replace(/DEFAULT now\(\)/gi, "DEFAULT (datetime('now'))")
      .replace(/now\(\)/gi, "datetime('now')")
      .replace(/::int/gi, '');
  }

  // Converte placeholders $N -> ? E REORDENA os params na ordem de aparicao no SQL.
  // Ex: "... SET a=$2, b=$3 WHERE token=$1" com params [tok, a, b]
  //     vira "... SET a=?, b=? WHERE token=?" com params [a, b, tok].
  function converterPlaceholders(sql, params) {
    const ordem = [];
    const novoSql = sql.replace(/\$(\d+)/g, (_, n) => {
      ordem.push(Number(n) - 1); // $1 -> indice 0
      return '?';
    });
    const novosParams = ordem.map((i) => params[i]);
    return { novoSql, novosParams };
  }

  _query = async (sql, paramsOrig = []) => {
    const comTipos = traduzirTipos(sql);
    const { novoSql: traduzido, novosParams: params } = converterPlaceholders(comTipos, paramsOrig);
    const ehSelectOuReturning = /^\s*select/i.test(traduzido) || /returning/i.test(traduzido);
    // multiplos statements (CREATE TABLE ...; CREATE TABLE ...;)
    if (/;\s*create/i.test(traduzido) || /^\s*create/i.test(traduzido)) {
      sdb.exec(traduzido.replace(/returning \*/gi, ''));
      return { rows: [] };
    }
    const stmt = sdb.prepare(traduzido.replace(/returning \*/gi, ''));
    if (ehSelectOuReturning && /^\s*select/i.test(traduzido)) {
      return { rows: stmt.all(...params) };
    }
    const info = stmt.run(...params);
    // emula RETURNING * buscando a linha inserida/alterada.
    if (/returning \*/i.test(sql)) {
      const ehInsert = /^\s*insert/i.test(sql);
      const tabela = (sql.match(/(?:INTO|UPDATE)\s+(\w+)/i) || [])[1];
      if (ehInsert) {
        // INSERT: usa o rowid recem-inserido
        return { rows: sdb.prepare(`SELECT * FROM ${tabela} WHERE rowid = ?`).all(Number(info.lastInsertRowid)) };
      }
      // UPDATE: recupera pela propria clausula WHERE ($1 = paramsOrig[0])
      if (/WHERE\s+id\s*=\s*\$1/i.test(sql)) {
        return { rows: sdb.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).all(paramsOrig[0]) };
      }
      if (/WHERE\s+token\s*=\s*\$1/i.test(sql)) {
        return { rows: sdb.prepare(`SELECT * FROM ${tabela} WHERE token = ?`).all(paramsOrig[0]) };
      }
    }
    return { rows: [] };
  };
  console.log('[DB] Usando SQLite local (modo de teste).');
}

export const query = _query;
export { usandoPostgres };
