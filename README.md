# 📦 App de Cotação de Serviços de Transporte

Sistema para solicitar cotações de frete a parceiros (transportadoras). O comercial cria uma
cotação, o sistema **dispara e-mails** aos parceiros, cada parceiro responde a proposta por um
**link exclusivo**, e ao fim do prazo a cotação **fecha automaticamente pelo menor valor**.
Inclui **dashboard de indicadores** e controle de **faturamento** interno.

- **App (backend):** Node.js — hospedado no **Render**
- **Banco de dados:** **PostgreSQL (Supabase)** — dados permanentes 🇧🇷

---

## ✨ Funcionalidades

**Cotação**
- Campos: Origem → Destino, Peso, Valor da mercadoria, Tipo de veículo, Observações, Prazo
- 🆕 **Comercial responsável** (Carlos / Everton / Tiago)
- Disparo de e-mail aos parceiros selecionados, cada um com link único

**Resposta do parceiro** (via link, sem login)
- Informa valor do frete, prazo de entrega e comentário
- Após o prazo, respostas são **bloqueadas** (o parceiro vê "prazo encerrado")
- 🔒 O parceiro **nunca** vê faturamento, comissão, vencedor ou valores de outros parceiros

**Status automáticos**
| Status | Quando |
|--------|--------|
| 🔵 **Aberta** | Dentro do prazo, sem respostas |
| 🟡 **Em andamento** | Dentro do prazo, com ≥1 proposta |
| 🟢 **Fechada** | Prazo encerrado → vence **automaticamente o menor valor** |

**Faturamento** (interno)
- **2% fixo** sobre o valor do frete vencedor + **comissão variável** (editável no fechamento)

**Dashboard de indicadores**
- Contadores: abertas / em andamento / fechadas
- **Faturamento total**
- **Tempo médio de resposta** dos parceiros
- **Parceiro com mais fechamentos**
- **Desempenho por comercial** (cotações, fechamentos e faturamento de Carlos/Everton/Tiago)

---

## ▶️ Rodar localmente

Requer **Node.js 22+**.

**Com banco Supabase (produção):**
```bash
export DATABASE_URL="postgresql://postgres:SENHA@db.xxxxx.supabase.co:5432/postgres"
npm install
npm start
```

**Modo de teste sem internet (SQLite local):**
```bash
DB_ENGINE=sqlite npm start
```
Abra: **http://localhost:3000**

> O app usa uma camada de banco que funciona com **PostgreSQL (Supabase)** em produção e com
> **SQLite embutido** localmente — a lógica de negócio é idêntica nos dois.

---

## 🚀 Deploy (Render + Supabase)

1. Crie um projeto no **Supabase** (região São Paulo) e pegue a *connection string* (URI).
2. No **Render**: New → **Blueprint** → selecione este repositório → **Apply**.
3. Em **Environment**, defina a variável **`DATABASE_URL`** com a string do Supabase.
4. O deploy roda `npm install` (instala o driver `pg`) e sobe o app.
5. Acesse a URL pública gerada (ex: `https://cotacao-servicos.onrender.com`).

> As tabelas são criadas automaticamente na primeira execução.

---

## ✉️ Ativar e-mail real

Por padrão roda em **modo simulado** (`MAIL_MODE=mock`): os links aparecem no log. Para enviar
de verdade, defina no Render: `MAIL_MODE=smtp` e as variáveis `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

---

## 🗂️ Estrutura

```
src/
  server.js            # servidor HTTP + rotas
  db.js                # camada de dados (consultas)
  database-adapter.js  # adaptador: PostgreSQL (prod) ou SQLite (teste)
  negocio.js           # regras: status, fechamento, faturamento, dashboard
  mailer.js            # envio de e-mail (mock ou SMTP)
  views.js             # páginas HTML
render.yaml            # configuração de deploy
```

| Variável      | Descrição |
|---------------|-----------|
| `DATABASE_URL`| String de conexão do Supabase (PostgreSQL) |
| `DB_ENGINE`   | `sqlite` força o modo de teste local |
| `MAIL_MODE`   | `mock` (simulado) ou `smtp` (envio real) |
| `BASE_URL`    | URL pública (detectada automaticamente se omitida) |
