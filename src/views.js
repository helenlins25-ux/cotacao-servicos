// Funcoes que geram as paginas HTML do sistema.

// Logo oficial da Stractton Group (imagem servida de /static/logo.png).
function logoSvg() {
  return `<img src="/static/logo.png" alt="Stractton Group" height="46" style="display:block;border-radius:6px;" />`;
}

// externo=true -> pagina vista pelo PARCEIRO (sem menu interno de navegacao).
function layout(title, body, externo = false) {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#111317" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Stractton Cotações" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/static/logo.png" />
  <link rel="icon" href="/static/logo.png" />
  <title>${title}</title>
  <style>
    :root {
      --ouro:#d4af37; --ouro-claro:#f0d87a; --preto:#111317; --grafite:#1c1f26;
      --cinza:#64748b; --borda:#e2e8f0; --bg:#f6f7f9;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:var(--bg); color:#0f172a; }
    header {
      background: linear-gradient(135deg, var(--preto) 0%, var(--grafite) 100%);
      color:#fff; padding:14px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
      border-bottom:3px solid var(--ouro);
      padding-left: max(20px, env(safe-area-inset-left));
      padding-right: max(20px, env(safe-area-inset-right));
    }
    header .marca { display:flex; align-items:center; gap:12px; margin-right:12px; }
    header .marca .nome { line-height:1.05; }
    header .marca .nome b { font-size:18px; color:var(--ouro-claro); letter-spacing:.5px; }
    header .marca .nome span { display:block; font-size:10px; letter-spacing:4px; color:#cbd5e1; }
    header nav { display:flex; gap:4px; flex-wrap:wrap; }
    header a { color:#d8dce3; text-decoration:none; font-size:15px; padding:8px 12px; border-radius:6px; }
    header a:hover, header a:active { color:#fff; background:rgba(212,175,55,.15); }
    /* largura ampla (quase tela inteira), com um respiro nas laterais */
    .container { max-width:1400px; margin:20px auto; padding:0 24px; }
    h1 { font-size:22px; } h2 { font-size:18px; }
    .card { background:#fff; border:1px solid var(--borda); border-radius:10px; padding:20px; margin-bottom:20px; }
    label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
    input, select, textarea { width:100%; padding:11px 12px; border:1px solid var(--borda); border-radius:8px; font-size:16px; }
    textarea { min-height:70px; resize:vertical; }
    .row { display:flex; gap:16px; flex-wrap:wrap; }
    .row > div { flex:1; min-width:180px; }
    button, .btn { background:var(--preto); color:var(--ouro-claro); border:1px solid var(--ouro); padding:11px 18px; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; text-decoration:none; display:inline-block; }
    button:hover, .btn:hover { background:var(--grafite); }
    /* tabelas rolam horizontalmente no celular sem quebrar o layout */
    .tabela-wrap { width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; padding:10px; border-bottom:1px solid var(--borda); }
    th { color:var(--cinza); font-size:12px; text-transform:uppercase; }
    .tag { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
    .tag.aberta { background:#dbeafe; color:#1e40af; }
    .tag.em_andamento { background:#fef3c7; color:#92400e; }
    .tag.fechada { background:#dcfce7; color:#166534; }
    .tag.encerrada_sem_proposta { background:#fee2e2; color:#991b1b; }
    .muted { color:var(--cinza); font-size:13px; }
    .check { display:flex; align-items:center; gap:8px; margin:6px 0; }
    .check input { width:auto; }
    .ok { background:#dcfce7; color:#166534; padding:14px; border-radius:8px; }
    .warn { background:#fef3c7; color:#92400e; padding:14px; border-radius:8px; }
    .big { font-size:20px; font-weight:700; }
    .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; }
    .kpi { background:#fff; border:1px solid var(--borda); border-radius:10px; padding:16px; }
    .kpi .n { font-size:26px; font-weight:800; }
    .kpi .l { font-size:12px; color:var(--cinza); text-transform:uppercase; letter-spacing:.03em; }
    .kpi.azul { border-top:3px solid #3b82f6; }
    .kpi.amar { border-top:3px solid #f59e0b; }
    .kpi.verd { border-top:3px solid #22c55e; }
    .kpi.roxo { border-top:3px solid var(--ouro); }
    a { color:#b8860b; }
    footer { text-align:center; color:var(--cinza); font-size:12px; padding:24px; }

    /* ===== Responsivo para CELULAR ===== */
    @media (max-width: 640px) {
      header { padding:12px 16px; gap:10px; }
      header .marca img { height:38px !important; }
      header nav { width:100%; gap:2px; }
      header nav a { flex:1 1 auto; text-align:center; font-size:14px; padding:10px 6px; background:rgba(255,255,255,.06); }
      .container { padding:0 12px; margin:14px auto; }
      .card { padding:16px; border-radius:12px; }
      h1 { font-size:20px; }
      /* cada campo ocupa a linha inteira no celular */
      .row { gap:10px; }
      .row > div { flex:1 1 100%; min-width:0; }
      /* botoes ocupam a largura toda (mais faceis de tocar) */
      button, .btn { width:100%; padding:13px 18px; text-align:center; }
      /* acoes da tabela (reenviar/cancelar) empilhadas */
      table { font-size:13px; }
      th, td { padding:8px 6px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="marca">
      ${logoSvg()}
    </div>
    ${externo ? '' : `<nav>
      <a href="/">Dashboard</a>
      <a href="/cotacoes">Cotações</a>
      <a href="/cotacoes/nova">Nova cotação</a>
      <a href="/parceiros">Parceiros</a>
    </nav>`}
  </header>
  <div class="container">${body}</div>
  <footer>Stractton Group · Sistema de Cotação de Serviços de Transporte</footer>
  <script>
    // registra o service worker (habilita "Instalar app" no celular)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  </script>
</body>
</html>`;
}

const fmtMoeda = (v) => Number(v || 0).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => {
  if (!iso) return '-';
  const s = typeof iso === 'string' ? iso : new Date(iso).toISOString();
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  // Sempre exibe no fuso de Brasilia, independente do fuso do servidor (Render=UTC).
  return d.toLocaleString('pt-br', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
};
// Formata uma data (so dia) tipo "2026-11-20" como "20/11/2026".
// Aceita string (SQLite) ou objeto Date (Postgres/Supabase).
const fmtDataSimples = (d) => {
  if (!d) return '-';
  let iso;
  if (d instanceof Date) iso = d.toISOString().slice(0, 10);
  else iso = String(d).slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const fmtEntrega = (d) => (d ? fmtDataSimples(d) : 'A combinar');

const rotuloStatus = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  fechada: 'Fechada',
  encerrada_sem_proposta: 'Encerrada (sem proposta)',
};

// ---------------- DASHBOARD ----------------
export function paginaDashboard(d) {
  const tempoMedio = d.qtdRespostas
    ? (d.tempoMedioHoras < 1
        ? `${Math.round(d.tempoMedioHoras * 60)} min`
        : `${d.tempoMedioHoras.toFixed(1)} h`)
    : '—';

  const linhasComercial = Object.entries(d.porComercial).map(([nome, m]) => `
    <tr>
      <td><strong>${nome}</strong></td>
      <td>${m.total}</td>
      <td>${m.fechadas}</td>
      <td>${fmtMoeda(m.faturamento)}</td>
    </tr>`).join('');

  return layout('Dashboard', `
    <h1>📊 Dashboard de Indicadores</h1>

    <div class="kpis">
      <div class="kpi azul"><div class="n">${d.contagem.aberta || 0}</div><div class="l">Abertas</div></div>
      <div class="kpi amar"><div class="n">${d.contagem.em_andamento || 0}</div><div class="l">Em andamento</div></div>
      <div class="kpi verd"><div class="n">${d.contagem.fechada || 0}</div><div class="l">Fechadas</div></div>
      <div class="kpi roxo"><div class="n">${fmtMoeda(d.faturamentoTotal)}</div><div class="l">Faturamento total</div></div>
    </div>
    <br>
    <div class="row">
      <div class="card">
        <div class="l muted">TEMPO MÉDIO DE RESPOSTA</div>
        <div class="big">${tempoMedio}</div>
        <div class="muted">${d.qtdRespostas} resposta(s) de parceiros</div>
      </div>
      <div class="card">
        <div class="l muted">PARCEIRO COM MAIS FECHAMENTOS</div>
        <div class="big">${d.parceiroTop ? d.parceiroTop.nome : '—'}</div>
        <div class="muted">${d.parceiroTop ? d.parceiroTop.fechamentos + ' fechamento(s)' : 'nenhum fechamento ainda'}</div>
      </div>
    </div>

    <div class="card">
      <h2>Desempenho por comercial</h2>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Comercial</th><th>Cotações</th><th>Fechadas</th><th>Faturamento</th></tr></thead>
        <tbody>${linhasComercial}</tbody>
      </table></div>
    </div>

    <div class="card">
      <a class="btn" href="/cotacoes/nova">+ Nova cotação</a>
      &nbsp;<a class="btn" style="background:#475569" href="/cotacoes">Ver todas as cotações</a>
    </div>
  `);
}

// ---------------- PARCEIROS ----------------
export function paginaParceiros(parceiros, msg) {
  const linhas = parceiros.map(p => `
    <tr>
      <td>${p.nome}</td>
      <td>${p.email}</td>
      <td class="muted">${fmtData(p.criado_em)}</td>
      <td style="text-align:right">
        <form method="post" action="/parceiros/${p.id}/excluir" style="margin:0"
              onsubmit="return confirm('Excluir o parceiro ${String(p.nome).replace(/'/g, "\\'")}?');">
          <button type="submit" style="background:#fff;color:#b91c1c;border-color:#fca5a5;padding:5px 12px;font-size:13px">🗑️ Excluir</button>
        </form>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum parceiro cadastrado.</td></tr>';

  return layout('Parceiros', `
    <h1>Parceiros</h1>
    ${msg ? `<div class="ok">${msg}</div><br>` : ''}
    <div class="card">
      <h2>Cadastrar parceiro</h2>
      <form method="post" action="/parceiros">
        <div class="row">
          <div><label>Nome</label><input name="nome" required placeholder="Transportadora XYZ"></div>
          <div><label>E-mail</label><input name="email" type="email" required placeholder="contato@xyz.com"></div>
        </div>
        <br><button type="submit">Salvar parceiro</button>
      </form>
    </div>
    <div class="card">
      <h2>Lista de parceiros</h2>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Cadastrado em</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
    </div>
  `);
}

// ---------------- NOVA COTACAO ----------------
export function paginaNovaCotacao(parceiros, comerciais) {
  const checks = parceiros.map(p => `
    <label class="check"><input type="checkbox" name="parceiros" value="${p.id}"> ${p.nome} <span class="muted">(${p.email})</span></label>
  `).join('') || '<p class="muted">Nenhum parceiro cadastrado. <a href="/parceiros">Cadastre um parceiro</a> antes de criar a cotação.</p>';

  const veiculos = ['Fiorino', 'VUC', 'Van', 'Caminhão 3/4', 'Caminhão Toco', 'Caminhão Truck', 'Carreta', 'Bitrem'];
  const optsVeic = veiculos.map(v => `<option value="${v}">${v}</option>`).join('');
  const optsCom = comerciais.map(c => `<option value="${c}">${c}</option>`).join('');

  return layout('Nova cotação', `
    <h1>Nova cotação</h1>
    <div class="card">
      <form method="post" action="/cotacoes">
        <div class="row">
          <div><label>Origem</label><input name="origem" required placeholder="São Paulo - SP"></div>
          <div><label>Destino</label><input name="destino" required placeholder="Rio de Janeiro - RJ"></div>
        </div>
        <label>Produto</label>
        <input name="produto" placeholder="Ex: Eletrônicos, alimentos, peças...">
        <div class="row">
          <div><label>Peso da carga (kg)</label><input name="peso_kg" type="number" step="0.01" min="0" required placeholder="1200"></div>
          <div><label>Volume</label><input name="volume" placeholder="Ex: 15 m³ ou 20 volumes"></div>
          <div><label>Valor da mercadoria (R$)</label><input name="valor_mercadoria" type="number" step="0.01" min="0" required placeholder="50000"></div>
        </div>
        <div class="row">
          <div><label>Tipo de veículo</label><select name="tipo_veiculo" required>${optsVeic}</select></div>
          <div><label>Comercial responsável</label><select name="comercial" required><option value="">Selecione...</option>${optsCom}</select></div>
        </div>
        <div class="row">
          <div><label>Data da coleta</label><input name="data_coleta" type="date"></div>
          <div><label>Data da entrega <span class="muted">(vazio = a combinar)</span></label><input name="data_entrega" type="date"></div>
        </div>
        <div class="row">
          <div><label>Prazo para resposta</label><input name="prazo_resposta" type="datetime-local" required></div>
          <div></div>
        </div>
        <label>Observações (opcional)</label>
        <textarea name="observacoes" placeholder="Informações adicionais para os parceiros..."></textarea>
        <label>Enviar para os parceiros:</label>
        ${checks}
        <br><button type="submit">Criar e enviar cotação</button>
      </form>
    </div>
  `);
}

// ---------------- LISTA DE COTACOES ----------------
export function paginaListaCotacoes(cotacoes) {
  const linhas = cotacoes.map(c => `
    <tr>
      <td><a href="/cotacoes/${c.id}">#${c.id}</a></td>
      <td>${c.origem} → ${c.destino}</td>
      <td>${c.comercial || '—'}</td>
      <td>${c.respondidas}/${c.convidados}</td>
      <td>${fmtData(c.prazo_resposta)}</td>
      <td><span class="tag ${c.status}">${rotuloStatus[c.status] || c.status}</span></td>
      <td>${c.status === 'fechada' ? fmtMoeda(c.faturamento) : '<span class="muted">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma cotação criada ainda.</td></tr>';

  return layout('Cotações', `
    <h1>Cotações</h1>
    <div class="card">
      <a class="btn" href="/cotacoes/nova">+ Nova cotação</a>
      <br><br>
      <div class="tabela-wrap"><table>
        <thead><tr><th>#</th><th>Trajeto</th><th>Comercial</th><th>Respostas</th><th>Prazo</th><th>Status</th><th>Faturamento</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
    </div>
  `);
}

// ---------------- DETALHE (INTERNO) ----------------
export function paginaDetalheCotacao(c, convites, info) {
  const { status, faturamento, vencedorNome, percFixo, expirada, aviso } = info;

  const linhas = convites.map(v => {
    const ehVencedor = c.parceiro_vencedor && v.parceiro_id === c.parceiro_vencedor;
    // acoes: so para quem ainda NAO respondeu e enquanto a cotacao esta no prazo
    let acoes = '<span class="muted">—</span>';
    if (!v.respondido_em && !expirada && status !== 'fechada') {
      acoes = `
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <form method="post" action="/cotacoes/${c.id}/convites/${v.id}/reenviar" style="margin:0">
            <button type="submit" style="padding:5px 10px;font-size:13px">🔄 Reenviar</button>
          </form>
          <form method="post" action="/cotacoes/${c.id}/convites/${v.id}/cancelar" style="margin:0"
                onsubmit="return confirm('Cancelar o convite de ${String(v.nome).replace(/'/g, "\\'")}?');">
            <button type="submit" style="background:#fff;color:#b91c1c;border-color:#fca5a5;padding:5px 10px;font-size:13px">❌ Cancelar</button>
          </form>
        </div>`;
    }
    return `
    <tr${ehVencedor ? ' style="background:#f0fdf4"' : ''}>
      <td>${v.nome} ${ehVencedor ? '🏆' : ''}<br><span class="muted">${v.email}</span></td>
      <td>${v.respondido_em ? fmtMoeda(v.valor_cotado) : '<span class="muted">—</span>'}</td>
      <td>${v.prazo_entrega || '<span class="muted">—</span>'}</td>
      <td>${v.comentario || '<span class="muted">—</span>'}</td>
      <td>${v.respondido_em ? '✅ ' + fmtData(v.respondido_em) : '<span class="muted">aguardando</span>'}</td>
      <td style="text-align:right">${acoes}</td>
    </tr>`;
  }).join('');

  // bloco de fechamento/faturamento (INTERNO - nunca exibido ao parceiro)
  let blocoFechamento = '';
  if (status === 'fechada') {
    const fixo = Number(c.valor_fechado || 0) * percFixo;
    blocoFechamento = `
    <div class="card">
      <h2>💰 Fechamento (interno)</h2>
      <div class="row">
        <div><label>Vencedor (menor valor)</label>🏆 ${vencedorNome || '—'}</div>
        <div><label>Valor do frete fechado</label>${fmtMoeda(c.valor_fechado)}</div>
      </div>
      <div class="row">
        <div><label>Taxa fixa (2%)</label>${fmtMoeda(fixo)}</div>
        <div><label>Comissão variável</label>${fmtMoeda(c.comissao_variavel)}</div>
        <div><label>Faturamento total</label><span class="big">${fmtMoeda(faturamento)}</span></div>
      </div>
      <form method="post" action="/cotacoes/${c.id}/comissao">
        <label>Atualizar comissão variável (R$)</label>
        <div class="row">
          <div><input name="comissao_variavel" type="number" step="0.01" min="0" value="${Number(c.comissao_variavel || 0)}"></div>
          <div style="flex:0"><br><button type="submit">Salvar comissão</button></div>
        </div>
      </form>
    </div>`;
  }

  return layout(`Cotação #${c.id}`, `
    <h1>Cotação #${c.id} <span class="tag ${status}">${rotuloStatus[status] || status}</span></h1>
    ${aviso ? `<div class="${aviso.tipo}">${aviso.texto}</div><br>` : ''}
    <div class="card">
      <div class="row">
        <div><label>Trajeto</label>${c.origem} → ${c.destino}</div>
        <div><label>Produto</label>${c.produto || '—'}</div>
        <div><label>Tipo de veículo</label>${c.tipo_veiculo}</div>
        <div><label>Comercial responsável</label>${c.comercial || '—'}</div>
      </div>
      <div class="row">
        <div><label>Peso da carga</label>${c.peso_kg} kg</div>
        <div><label>Volume</label>${c.volume || '—'}</div>
        <div><label>Valor da mercadoria</label>${fmtMoeda(c.valor_mercadoria)}</div>
      </div>
      <div class="row">
        <div><label>Data da coleta</label>${fmtDataSimples(c.data_coleta)}</div>
        <div><label>Data da entrega</label>${fmtEntrega(c.data_entrega)}</div>
        <div><label>Prazo para resposta</label>${fmtData(c.prazo_resposta)}</div>
      </div>
      ${c.observacoes ? `<label>Observações</label><div class="muted">${c.observacoes}</div>` : ''}
    </div>
    ${blocoFechamento}
    <div class="card">
      <h2>Respostas dos parceiros</h2>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Parceiro</th><th>Valor cotado</th><th>Prazo entrega</th><th>Comentário</th><th>Status</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
    </div>
  `);
}

// ---------------- RESPOSTA DO PARCEIRO (EXTERNO) ----------------
// NUNCA exibir faturamento, comissao, vencedor ou valores de outros parceiros.
export function paginaRespostaParceiro(c, convite, expirada) {
  const cabecalho = `
    <div class="card">
      <h1>Solicitação de cotação</h1>
      <p>Olá <strong>${convite.nome}</strong>, você recebeu uma solicitação de cotação:</p>
      <div class="row">
        <div><label>Trajeto</label>${c.origem} → ${c.destino}</div>
        <div><label>Produto</label>${c.produto || '—'}</div>
        <div><label>Tipo de veículo</label>${c.tipo_veiculo}</div>
      </div>
      <div class="row">
        <div><label>Peso da carga</label>${c.peso_kg} kg</div>
        <div><label>Volume</label>${c.volume || '—'}</div>
        <div><label>Valor da mercadoria</label>${fmtMoeda(c.valor_mercadoria)}</div>
      </div>
      <div class="row">
        <div><label>Data da coleta</label>${fmtDataSimples(c.data_coleta)}</div>
        <div><label>Data da entrega</label>${fmtEntrega(c.data_entrega)}</div>
        <div><label>Responder até</label>${fmtData(c.prazo_resposta)}</div>
      </div>
      ${c.observacoes ? `<label>Observações</label><div class="muted">${c.observacoes}</div>` : ''}
    </div>`;

  if (expirada) {
    return layout('Prazo encerrado', cabecalho + `
      <div class="card"><div class="warn">⏰ O prazo para responder esta cotação foi encerrado em ${fmtData(c.prazo_resposta)}. Não é mais possível enviar uma proposta.</div></div>
    `, true);
  }

  if (convite.respondido_em) {
    return layout('Resposta registrada', cabecalho + `
      <div class="card"><div class="ok">✅ Sua proposta de <strong>${fmtMoeda(convite.valor_cotado)}</strong> já foi registrada em ${fmtData(convite.respondido_em)}. Obrigado!</div></div>
    `, true);
  }

  return layout('Responder cotação', cabecalho + `
    <div class="card">
      <h2>Enviar sua proposta</h2>
      <form method="post" action="/responder/${convite.token}">
        <div class="row">
          <div><label>Valor do frete (R$)</label><input name="valor_cotado" type="number" step="0.01" min="0" required placeholder="2500"></div>
          <div><label>Prazo de entrega</label><input name="prazo_entrega" placeholder="Ex: 3 dias úteis"></div>
        </div>
        <label>Comentário (opcional)</label>
        <textarea name="comentario" placeholder="Condições, restrições, etc."></textarea>
        <br><button type="submit">Enviar proposta</button>
      </form>
    </div>
  `, true);
}

export function paginaSimples(titulo, html, externo = false) {
  return layout(titulo, `<div class="card">${html}</div>`, externo);
}
