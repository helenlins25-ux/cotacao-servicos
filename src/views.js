// Funcoes que geram as paginas HTML do sistema.

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { --azul:#1d4ed8; --cinza:#64748b; --borda:#e2e8f0; --bg:#f8fafc; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:var(--bg); color:#0f172a; }
    header { background:#0f172a; color:#fff; padding:16px 24px; }
    header a { color:#cbd5e1; text-decoration:none; margin-right:16px; font-size:14px; }
    header a:hover { color:#fff; }
    .container { max-width:960px; margin:24px auto; padding:0 16px; }
    h1 { font-size:22px; } h2 { font-size:18px; }
    .card { background:#fff; border:1px solid var(--borda); border-radius:10px; padding:20px; margin-bottom:20px; }
    label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
    input, select, textarea { width:100%; padding:9px 10px; border:1px solid var(--borda); border-radius:8px; font-size:14px; }
    textarea { min-height:70px; resize:vertical; }
    .row { display:flex; gap:16px; flex-wrap:wrap; }
    .row > div { flex:1; min-width:180px; }
    button, .btn { background:var(--azul); color:#fff; border:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
    button:hover, .btn:hover { opacity:.9; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; padding:10px; border-bottom:1px solid var(--borda); }
    th { color:var(--cinza); font-size:12px; text-transform:uppercase; }
    .tag { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
    .tag.aberta { background:#dcfce7; color:#166534; }
    .tag.encerrada { background:#fee2e2; color:#991b1b; }
    .muted { color:var(--cinza); font-size:13px; }
    .check { display:flex; align-items:center; gap:8px; margin:6px 0; }
    .check input { width:auto; }
    .ok { background:#dcfce7; color:#166534; padding:14px; border-radius:8px; }
    .warn { background:#fef3c7; color:#92400e; padding:14px; border-radius:8px; }
    .big { font-size:20px; font-weight:700; }
  </style>
</head>
<body>
  <header>
    <strong>📦 Cotação de Serviços</strong>
    &nbsp;&nbsp;
    <a href="/">Cotações</a>
    <a href="/cotacoes/nova">Nova cotação</a>
    <a href="/parceiros">Parceiros</a>
  </header>
  <div class="container">${body}</div>
</body>
</html>`;
}

const fmtMoeda = (v) => Number(v).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-br', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function paginaParceiros(parceiros, msg) {
  const linhas = parceiros.map(p => `
    <tr>
      <td>${p.nome}</td>
      <td>${p.email}</td>
      <td class="muted">${fmtData(p.criado_em)}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="muted">Nenhum parceiro cadastrado.</td></tr>';

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
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Cadastrado em</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `);
}

export function paginaNovaCotacao(parceiros) {
  const checks = parceiros.map(p => `
    <label class="check"><input type="checkbox" name="parceiros" value="${p.id}"> ${p.nome} <span class="muted">(${p.email})</span></label>
  `).join('') || '<p class="muted">Nenhum parceiro cadastrado. <a href="/parceiros">Cadastre um parceiro</a> antes de criar a cotação.</p>';

  const veiculos = ['Fiorino', 'VUC', 'Van', 'Caminhão 3/4', 'Caminhão Toco', 'Caminhão Truck', 'Carreta', 'Bitrem'];
  const opts = veiculos.map(v => `<option value="${v}">${v}</option>`).join('');

  return layout('Nova cotação', `
    <h1>Nova cotação</h1>
    <div class="card">
      <form method="post" action="/cotacoes">
        <div class="row">
          <div><label>Origem</label><input name="origem" required placeholder="São Paulo - SP"></div>
          <div><label>Destino</label><input name="destino" required placeholder="Rio de Janeiro - RJ"></div>
        </div>
        <div class="row">
          <div><label>Peso da carga (kg)</label><input name="peso_kg" type="number" step="0.01" min="0" required placeholder="1200"></div>
          <div><label>Valor da mercadoria (R$)</label><input name="valor_mercadoria" type="number" step="0.01" min="0" required placeholder="50000"></div>
        </div>
        <div class="row">
          <div><label>Tipo de veículo</label><select name="tipo_veiculo" required>${opts}</select></div>
          <div><label>Prazo para resposta</label><input name="prazo_resposta" type="datetime-local" required></div>
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

export function paginaListaCotacoes(cotacoes) {
  const linhas = cotacoes.map(c => `
    <tr>
      <td><a href="/cotacoes/${c.id}">#${c.id}</a></td>
      <td>${c.origem} → ${c.destino}</td>
      <td>${c.tipo_veiculo}</td>
      <td>${c.respondidas}/${c.convidados}</td>
      <td>${fmtData(c.prazo_resposta)}</td>
      <td><span class="tag ${c.status}">${c.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma cotação criada ainda.</td></tr>';

  return layout('Cotações', `
    <h1>Cotações</h1>
    <div class="card">
      <a class="btn" href="/cotacoes/nova">+ Nova cotação</a>
      <br><br>
      <table>
        <thead><tr><th>#</th><th>Trajeto</th><th>Veículo</th><th>Respostas</th><th>Prazo</th><th>Status</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `);
}

export function paginaDetalheCotacao(c, convites, expirada) {
  const linhas = convites.map(v => `
    <tr>
      <td>${v.nome}<br><span class="muted">${v.email}</span></td>
      <td>${v.respondido_em ? fmtMoeda(v.valor_cotado) : '<span class="muted">—</span>'}</td>
      <td>${v.prazo_entrega || '<span class="muted">—</span>'}</td>
      <td>${v.comentario || '<span class="muted">—</span>'}</td>
      <td>${v.respondido_em ? '✅ ' + fmtData(v.respondido_em) : '<span class="muted">aguardando</span>'}</td>
    </tr>`).join('');

  const menor = convites
    .filter(v => v.respondido_em && v.valor_cotado != null)
    .sort((a, b) => a.valor_cotado - b.valor_cotado)[0];

  return layout(`Cotação #${c.id}`, `
    <h1>Cotação #${c.id} <span class="tag ${expirada ? 'encerrada' : c.status}">${expirada ? 'encerrada' : c.status}</span></h1>
    <div class="card">
      <div class="row">
        <div><label>Trajeto</label>${c.origem} → ${c.destino}</div>
        <div><label>Tipo de veículo</label>${c.tipo_veiculo}</div>
      </div>
      <div class="row">
        <div><label>Peso da carga</label>${c.peso_kg} kg</div>
        <div><label>Valor da mercadoria</label>${fmtMoeda(c.valor_mercadoria)}</div>
        <div><label>Prazo para resposta</label>${fmtData(c.prazo_resposta)}</div>
      </div>
      ${c.observacoes ? `<label>Observações</label><div class="muted">${c.observacoes}</div>` : ''}
    </div>
    ${menor ? `<div class="card"><label>Melhor proposta até agora</label><span class="big">${fmtMoeda(menor.valor_cotado)}</span> — ${menor.nome}</div>` : ''}
    <div class="card">
      <h2>Respostas dos parceiros</h2>
      <table>
        <thead><tr><th>Parceiro</th><th>Valor cotado</th><th>Prazo entrega</th><th>Comentário</th><th>Status</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `);
}

export function paginaRespostaParceiro(c, convite, expirada) {
  const cabecalho = `
    <div class="card">
      <h1>Solicitação de cotação</h1>
      <p>Olá <strong>${convite.nome}</strong>, você recebeu uma solicitação de cotação:</p>
      <div class="row">
        <div><label>Trajeto</label>${c.origem} → ${c.destino}</div>
        <div><label>Tipo de veículo</label>${c.tipo_veiculo}</div>
      </div>
      <div class="row">
        <div><label>Peso da carga</label>${c.peso_kg} kg</div>
        <div><label>Valor da mercadoria</label>${fmtMoeda(c.valor_mercadoria)}</div>
        <div><label>Responder até</label>${fmtData(c.prazo_resposta)}</div>
      </div>
      ${c.observacoes ? `<label>Observações</label><div class="muted">${c.observacoes}</div>` : ''}
    </div>`;

  if (expirada) {
    return layout('Prazo encerrado', cabecalho + `
      <div class="card"><div class="warn">⏰ O prazo para responder esta cotação foi encerrado em ${fmtData(c.prazo_resposta)}. Não é mais possível enviar uma proposta.</div></div>
    `);
  }

  if (convite.respondido_em) {
    return layout('Resposta registrada', cabecalho + `
      <div class="card"><div class="ok">✅ Sua proposta de <strong>${fmtMoeda(convite.valor_cotado)}</strong> já foi registrada em ${fmtData(convite.respondido_em)}. Obrigado!</div></div>
    `);
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
  `);
}

export function paginaSimples(titulo, html) {
  return layout(titulo, `<div class="card">${html}</div>`);
}
