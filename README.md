# 📦 App de Cotação de Serviços de Transporte

Aplicação para solicitar cotações de frete a parceiros (transportadoras). O usuário interno
cria uma cotação, o sistema **dispara e-mails** para os parceiros selecionados, e cada parceiro
responde a proposta clicando num **link exclusivo**. Há um **prazo limite** e, após ele,
**novas respostas são bloqueadas**.

> Feito com **zero dependências externas** — usa apenas a biblioteca padrão do Node.js
> (incluindo o **SQLite embutido** do Node 22+). Não precisa de `npm install`.

---

## ✨ Funcionalidades

- **Formulário de cotação** com os campos solicitados:
  - Origem → Destino
  - Peso da carga (kg)
  - Valor da mercadoria (R$)
  - Tipo de veículo (Fiorino, VUC, Van, 3/4, Toco, Truck, Carreta, Bitrem)
  - Observações (opcional)
  - **Prazo para resposta** (data/hora limite)
- **Disparo de e-mail** para os parceiros selecionados, cada um com um link único.
- **Página de resposta do parceiro**: valor do frete, prazo de entrega e comentário.
- **Bloqueio por prazo**: após o prazo, o parceiro vê "prazo encerrado" e o servidor
  **rejeita qualquer tentativa de envio** (HTTP 403) — nada é salvo.
- **Painel de respostas** que destaca a **melhor (menor) proposta**.
- **Cadastro de parceiros** (nome + e-mail). Já vem com 3 de exemplo no primeiro uso.
- **Dados persistentes** em SQLite — sobrevivem a reinícios.

---

## ▶️ Rodar localmente

Requer **Node.js 22+**.

```bash
npm start
# equivale a: node --experimental-sqlite src/server.js
```

Abra: **http://localhost:3000**

> O aviso `ExperimentalWarning: SQLite is an experimental feature` é normal e inofensivo.

---

## 🚀 Publicar online (deploy no Render) — grátis

O projeto já vem com `render.yaml` configurado, incluindo **disco persistente** (os dados
não somem entre deploys).

1. Suba este repositório no **GitHub** (já feito, se você está lendo isto lá).
2. Crie uma conta grátis em **https://render.com** (pode entrar com o GitHub).
3. No painel do Render: **New +** → **Blueprint** → conecte sua conta GitHub e selecione este repositório.
4. O Render lê o `render.yaml` automaticamente e cria o serviço. Clique em **Apply**.
5. Aguarde o build/deploy. Ao final, você recebe uma URL pública, ex:
   **`https://cotacao-servicos.onrender.com`**
6. Pronto! Acesse essa URL no navegador.

> **Plano grátis:** o serviço "hiberna" após ~15 min sem uso e acorda na próxima visita
> (a primeira abertura pode levar ~30s). Os dados ficam salvos no disco persistente.

---

## ✉️ Ativar envio de e-mail REAL

Por padrão roda em **modo simulado** (`MAIL_MODE=mock`): os e-mails aparecem no log do serviço,
com o link de resposta. Para enviar de verdade, configure as variáveis de ambiente no Render
(aba **Environment** do serviço):

```
MAIL_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-de-app        # no Gmail, gere uma "Senha de app"
MAIL_FROM=Cotações <seu-email@gmail.com>
```

Os links nos e-mails usam automaticamente a URL pública do serviço.

---

## 🗂️ Estrutura

```
src/
  server.js    # servidor HTTP + rotas (lib padrão, sem express)
  db.js        # banco SQLite embutido (node:sqlite)
  mailer.js    # envio de e-mail: modo mock ou SMTP nativo
  views.js     # geração das páginas HTML
render.yaml    # configuração de deploy (Render) com disco persistente
```

Variáveis de ambiente úteis:

| Variável    | Default                 | Descrição                                   |
|-------------|-------------------------|---------------------------------------------|
| `PORT`      | `3000`                  | Porta do servidor (o Render define sozinho) |
| `DATA_DIR`  | `./data`                | Pasta do arquivo SQLite (disco persistente) |
| `BASE_URL`  | detectado da requisição | URL pública usada nos links dos e-mails     |
| `MAIL_MODE` | `mock`                  | `mock` (simulado) ou `smtp` (envio real)    |
