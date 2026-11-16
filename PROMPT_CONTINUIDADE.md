# 📋 Briefing de continuidade — Plataforma Stractton (Leads + Cotação)

> Documento para uma **nova sessão/conta da Kiro** assumir o projeto sem perder contexto.
> **Não contém senhas nem chaves.** Os valores secretos ficam apenas nas variáveis de ambiente do Render
> (e no painel do Supabase/Brevo). Nunca grave segredos neste repositório.

---

## 1. Prompt de abertura (cole na nova sessão)

```
Vou te passar a continuação de um projeto que já está no ar. O código está no GitHub
(repositório helenlins25-ux/cotacao-servicos, branch main). Antes de qualquer coisa, clone o
repositório e leia por inteiro o arquivo PROMPT_CONTINUIDADE.md e o README.md. Eles descrevem a
arquitetura, as regras de negócio, as armadilhas já encontradas e como testar.

Regras de trabalho:
- Responda sempre em português do Brasil, em linguagem simples (a usuária não é desenvolvedora).
- Em pedidos ambíguos, confirme as decisões antes de construir; em pedidos claros, implemente.
- Teste localmente antes de dizer que está pronto, faça commit e push na main e avise o que ela
  precisa conferir no Render (Ctrl+Shift+R após o deploy).
- Nunca coloque senhas/chaves no código ou no GitHub. Se ela colar uma credencial no chat,
  avise que vale trocá-la depois.
- Dados financeiros e de leads NUNCA podem aparecer para o parceiro.

Meu próximo pedido é: <escreva aqui o que você quer>
```

---

## 2. O que é o sistema

Plataforma web **interna da Stractton Group** (transporte/frete) com **login único** e dois módulos:

| Módulo | Para que serve |
|---|---|
| 🎯 **Leads** | Funil comercial: Novo → Em contato → Proposta enviada → Negociação → Ganho/Perdido; histórico de contatos; próximo contato (follow-up); painel por comercial. |
| 📦 **Cotação** | Cotar fretes com transportadoras parceiras por e-mail, fechar pelo menor valor, acompanhar a viagem e controlar o financeiro. |

Os dois se ligam: uma cotação pode nascer de um lead, e o painel de Leads mostra **quantos leads estão fechando negócio**.

**Quem usa**
- **ADM** (a dona do projeto): tudo + cadastro de usuários.
- **Comercial** (Carlos, Everton, Tiago): usa tudo, **inclusive vê faturamento**, mas não gerencia usuários.
- **Parceiro (transportadora)**: **sem login**; só acessa o link único que recebe por e-mail.

---

## 3. Stack, hospedagem e limites (importante)

- **Node.js 22**, `http` nativo (sem Express). Única dependência: `pg`. `type: module`.
- Início: `node --experimental-sqlite src/server.js` (o `node:sqlite` só serve para testes locais).
- **Render** (plano free): hiberna após ~15 min (tela "waking up" é do Render e não dá para remover); deploy automático a cada push na `main`; serviço "Blueprint managed" (`render.yaml`).
- **Supabase** (free, região São Paulo): PostgreSQL permanente. **Usar a string do Transaction Pooler** (host `aws-1-sa-east-1.pooler.supabase.com`, porta `6543`, usuário `postgres.<ref-do-projeto>`). A conexão direta (porta 5432) usa IPv6 e **falha no Render** (`ENETUNREACH`). Senha diferencia maiúscula/minúscula. Projeto free **pausa após ~1 semana sem uso** (Restore project).
- **Supabase Storage**: bucket público `comprovantes` (anexos de coleta/entrega). Chave nova no formato `sb_secret_...` funciona com `Authorization: Bearer` + `apikey`.
- **Brevo** (e-mail): enviar pela **API HTTP** (`MAIL_MODE=brevo`). **SMTP na porta 587 é bloqueado no Render.** Remetente verificado no Brevo: o e-mail em `MAIL_FROM`. Plano free = 300 e-mails/dia. Não ativar bloqueio de IP da API.
- **Fuso**: a empresa usa Brasília (UTC-3). O servidor roda em UTC → todas as datas/horas são convertidas (`TZ_OFFSET_HORAS`, padrão -3).

---

## 4. Estrutura do código

```
src/server.js            rotas HTTP, autenticação, e-mails de cotação/resultado, upload multipart, inicialização resiliente
src/db.js                tabelas + migrações idempotentes + consultas (parceiros, cotacoes, convites, usuarios, leads, lead_contatos)
src/database-adapter.js  Postgres em produção (DATABASE_URL) OU SQLite local (DB_ENGINE=sqlite) com a mesma interface
src/negocio.js           status, fechamento automático, faturamento, financeiro, dashboard
src/leads.js             etapas do funil, painel de Leads, indicadores do vínculo Lead×Cotação
src/views.js             TODAS as telas (HTML em template string), menu lateral, CSS
src/auth.js              hash de senha (scrypt), sessões em memória, cookies
src/mailer.js            envio: mock | brevo (API) | smtp
src/storage.js           upload ao Supabase Storage
public/logo.png          logo oficial · public/sw.js  service worker (PWA)
```

Tabelas: `parceiros`, `cotacoes`, `convites`, `usuarios`, `leads`, `lead_contatos`.
Rotas internas (exigem login): `/`, `/cotacoes`, `/cotacoes/nova`, `/cotacoes/:id`, `/financeiro`, `/parceiros`, `/usuarios`, `/leads`, `/leads/painel`, `/leads/novo`, `/leads/:id`.
Rotas **públicas**: `/responder/:token`, `/veiculo/:token`, `/login`, `/static/*`, `/manifest.webmanifest`, `/sw.js`.

---

## 5. Regras de negócio (já decididas com a usuária)

**Cotação**
- Campos: origem, destino, produto, peso, volume (texto livre), valor da mercadoria, tipo de veículo, comercial responsável (**Carlos, Everton, Tiago** — lista fixa em `negocio.js`), data da coleta, data da entrega (**vazia = "A combinar"**), prazo para resposta, observações, parceiros convidados, lead de origem (opcional).
- Cada parceiro recebe um **link único** por e-mail e responde valor, prazo de entrega e comentário. **Após o prazo, respostas são bloqueadas** (403).
- **Status automáticos:** Aberta (sem respostas) → Em andamento (≥1 resposta) → **Fechada** (prazo vencido: vence o **menor valor**). Cotação vencida sem proposta = "Encerrada (sem proposta)".
- O fechamento acontece quando alguém abre dashboard/lista/detalhe após o prazo (não há agendador).
- **Reenviar / Cancelar convite:** só para quem ainda não respondeu e dentro do prazo.
- **Notificação de resultado (automática ao fechar):** vencedor recebe "Você ganhou" + link `/veiculo/:token`; quem respondeu e perdeu recebe "não foi desta vez". Há botão para reenviar. Controle anti-duplicação em `resultado_notificado_em`.
- **Vencedor informa** placa (obrigatória), motorista, telefone; depois **coletou? / entregou? (Sim/Não)** e **anexo** (foto/print/PDF, até 8 MB) — tudo no mesmo link. A lista de cotações mostra a placa ou "⏳ Aguardando".

**Financeiro (interno)**
- Faturamento total = **2% do frete vencedor + comissão variável** (digitada no fechamento).
- **Bonificação ao parceiro** (digitada no fechamento) → **faturamento líquido = total − bonificação**.
- Aba **Financeiro**: marcar *recebido do parceiro* (com data) e *bonificação paga* (com data; só se houver bonificação). Indicadores: a receber, recebido, bonificações a pagar, pagas.
- **Dashboard**: abertas/em andamento/fechadas, faturamento total × líquido × bonificações, tempo médio de resposta, parceiro com mais fechamentos, desempenho por comercial.
- **Relatório da cotação** (`/cotacoes/:id/relatorio`): página compartilhável/imprimível **sem nada financeiro**.

**Leads**
- Cadastro (empresa, contato, telefone, e-mail, origem, comercial, etapa, próximo contato, observações), busca e filtros, histórico de contatos (quem registrou e quando), follow-ups atrasados/hoje, painel com funil e conversão.
- **Vínculo Lead×Cotação:** escolher o lead ao criar a cotação, botão "Gerar cotação" no lead (já pré-seleciona lead e comercial), vincular/desvincular depois no detalhe da cotação. **"Negócio fechado" = lead com ≥1 cotação fechada.** O painel mostra leads com cotação, leads com negócio fechado (%), cotações fechadas/geradas, faturamento gerado.
- A etapa do lead **nunca muda sozinha**: o detalhe sugere "Marcar lead como Ganho" (ação manual).
- Excluir lead **não apaga** as cotações (`lead_id` vira nulo).

---

## 6. Segurança (regras que não podem quebrar)

1. Parceiro **nunca** vê: faturamento, comissão, bonificação, vencedor/valores de outros parceiros, dados de leads, menu interno. Páginas externas usam `layout(..., externo=true)`.
2. **Todo texto digitado** é escapado com `esc()` em `views.js` (proteção contra injeção de HTML). Ao criar tela nova, escape tudo que vier de usuário/parceiro.
3. Estado do usuário/módulo é **por requisição** (`AsyncLocalStorage` em `views.contexto`) — nunca usar variável global para isso.
4. Senhas com scrypt; cookie `sid` HttpOnly; **sessões ficam em memória** (reiniciar o app desloga todos).
5. `/usuarios` só para ADM. O primeiro ADM é criado a partir de `ADMIN_EMAIL/ADMIN_SENHA` **apenas se o e-mail ainda não existir** (mudar `ADMIN_SENHA` depois não altera a senha existente).
6. `.env` está no `.gitignore`. Nunca versionar segredos.

---

## 7. Variáveis de ambiente (só nomes — valores ficam no Render)

| Variável | Função |
|---|---|
| `DATABASE_URL` | String do Transaction Pooler do Supabase |
| `MAIL_MODE` | `brevo` (produção) · `mock` (testes, imprime no log) · `smtp` |
| `BREVO_API_KEY` | Chave da API do Brevo (`xkeysib-...`) — colar **inteira**, sem texto sobrando |
| `MAIL_FROM` | Remetente, ex.: `Stractton Cotações <carlos.costa@stractton.com.br>` |
| `ADMIN_EMAIL` `ADMIN_SENHA` `ADMIN_NOME` | Cria o 1º administrador |
| `SUPABASE_URL` `SUPABASE_SERVICE_KEY` `SUPABASE_BUCKET` | Upload de anexos (bucket `comprovantes`) |
| `BASE_URL` | Opcional; o app detecta a URL pública sozinho |
| `TZ_OFFSET_HORAS` | Padrão `-3` |
| `DB_RETRY_MS` | Intervalo de nova tentativa do banco (padrão 10000) |
| `NODE_VERSION` | `22` |
| `DB_ENGINE=sqlite`, `DATA_DIR`, `PORT` | Só para testes locais |

Variáveis do SMTP (`SMTP_*`) existem no código, mas **não são usadas** em produção.

⚠️ **Cuidado com o `render.yaml`:** ele define `MAIL_MODE: mock`. Como o serviço é "Blueprint managed", ao **editar o `render.yaml`** confira em *Environment* se `MAIL_MODE` continua `brevo` (se voltar para `mock`, os e-mails deixam de sair). Não coloque valores secretos nesse arquivo.

---

## 8. Como rodar e testar localmente

```bash
# servidor de teste (SQLite local, e-mails só no log)
DB_ENGINE=sqlite DATABASE_URL= MAIL_MODE=mock ADMIN_EMAIL=h@x.com ADMIN_SENHA=x \
  node --experimental-sqlite src/server.js
```

Armadilhas de teste já encontradas:
- **O sandbox da Kiro não tem internet nem npm** (HTTP 403): não dá para instalar pacotes nem testar Brevo/Supabase de lá. Teste a lógica com SQLite e confirme integrações no Render.
- **Processos em segundo plano e `/tmp` não persistem entre chamadas** do terminal: suba o servidor, rode o teste e encerre **no mesmo comando**; guarde scripts auxiliares dentro do projeto e apague depois. Não use `pkill -f` com texto que apareça no próprio comando (mata o comando); use o PID (`kill $!`).
- **Prazos**: o campo de prazo é interpretado como horário de Brasília. Para simular vencimento em teste, **atualize `prazo_resposta` direto no banco** (ex.: `2020-01-01T00:00:00.000Z`) e abra a cotação.
- **Postgres devolve `DATE` como objeto `Date`** (SQLite devolve texto): use os helpers `fmtDataSimples` / `isoDia` / `paraInputData`.
- O adaptador SQLite traduz SQL de Postgres (`$1`→`?` com reordenação, `RETURNING *`, `ALTER ... ADD COLUMN IF NOT EXISTS`, `SERIAL`, `TIMESTAMPTZ`, `now()`). Se criar SQL novo, rode no SQLite **e** pense no Postgres (não é possível testar Postgres no sandbox).
- Em template strings JS, **não** coloque comentário SQL `--` fora da crase (vira erro de sintaxe).
- Migrações novas: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` dentro de `inicializarBanco()` (rodam a cada start; bancos existentes não podem perder dados). Teste a migração subindo a versão nova sobre um banco criado pela versão anterior.
- Capturas de tela: há Chrome em `/inner_container/opt/playwright/chromium_headless_shell-1232/chrome-headless-shell-linux64/chrome-headless-shell` (use `--no-sandbox --disable-breakpad` e o protocolo DevTools; não há biblioteca Playwright instalada).

---

## 9. Estado atual (último commit conhecido: `d08d89e`)

**Entregue e testado:** cotações completas, e-mail via Brevo, fechamento automático, notificação de resultado, placa/motorista, coleta/entrega com anexo, financeiro, bonificação/líquido, relatório, login ADM/Comercial, módulo Leads, vínculo Lead×Cotação, menu lateral responsivo + PWA, e **estabilidade** (o app sobe mesmo com o banco fora, responde 503 claro e reconecta sozinho; requisições malformadas não derrubam mais o servidor).

**Último problema em investigação:** o Render mostrou *"Instance failed — Exited with status 1"*. Foram corrigidas as causas de código (banco indisponível ao iniciar, erro em conexão ociosa, requisição malformada). **Verificar** se o projeto do Supabase não está **pausado** ("Restore project") e ler as últimas linhas do *Logs* do Render (`[DB] Banco indisponivel` / `[ERRO]`).

**Pendências / ideias não feitas:**
- Trocar credenciais que foram coladas no chat durante o desenvolvimento: senha do banco, senha do ADM, chave do Brevo, secret key do Supabase.
- Tela "trocar minha senha" (hoje só o ADM mexe via Render/usuários).
- Botões Aceitar/Recusar proposta (ficou pendente decidir se o faturamento conta só o "aceito").
- Aviso por e-mail quando o parceiro marcar coleta/entrega; e-mail diário de follow-up de leads.
- Coluna "Lead de origem" na lista de cotações; abrir o sistema direto no Painel de Leads (hoje `/` é o Dashboard de Cotação).
- Autenticar o domínio no Brevo (DKIM/DMARC) para melhorar a entrega; avaliar planos pagos (Render ~US$7/mês evita hibernar; Supabase Pro evita pausa).
- Documento de proposta comercial para a Stractton (funcionalidades + custos).
- Sessões em memória: se algum dia houver mais de uma instância, mover para o banco.

---

## 10. Como a usuária gosta de trabalhar

- Português do Brasil, passo a passo simples, com **prints** quando precisar configurar algo no Render/Supabase/Brevo (ela envia capturas de tela).
- Ela decide por **respostas curtas** ("pode seguir", "opção A"): ofereça uma recomendação clara e liste só as decisões que realmente mudam o resultado.
- Identidade visual: **dourado e preto** (logo da Stractton Group em `public/logo.png`).
- Sempre dizer **o que ela precisa fazer** (ex.: "aguarde o deploy e dê Ctrl+Shift+R") e **o que não foi possível verificar**.
