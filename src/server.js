// Servidor HTTP usando apenas a lib padrao do Node.js (sem express).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { inicializarBanco, parceiros, cotacoes, convites } from './db.js';
import { enviarEmail, mailMode } from './mailer.js';
import * as negocio from './negocio.js';
import * as views from './views.js';

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function baseUrlDe(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return BASE_URL;
}

const token = () => randomBytes(18).toString('hex');
const parsePrazo = (valor) => new Date(valor).toISOString();

function html(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
function lerBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const params = new URLSearchParams(data);
      const obj = {};
      for (const [k, v] of params.entries()) {
        if (obj[k] === undefined) obj[k] = v;
        else if (Array.isArray(obj[k])) obj[k].push(v);
        else obj[k] = [obj[k], v];
      }
      resolve(obj);
    });
  });
}

async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname;
  const metodo = req.method;

  try {
    // ---- Dashboard (home) ----
    if (metodo === 'GET' && path === '/') {
      const dash = await negocio.calcularDashboard();
      return html(res, views.paginaDashboard(dash));
    }

    // ---- Lista de cotacoes ----
    if (metodo === 'GET' && path === '/cotacoes') {
      const lista = await negocio.carregarCotacoesProcessadas();
      return html(res, views.paginaListaCotacoes(lista));
    }

    // ---- Parceiros ----
    if (metodo === 'GET' && path === '/parceiros') {
      return html(res, views.paginaParceiros(await parceiros.listar(), url.searchParams.get('ok') ? 'Parceiro cadastrado com sucesso!' : null));
    }
    if (metodo === 'POST' && path === '/parceiros') {
      const body = await lerBody(req);
      if (!body.nome || !body.email) return html(res, views.paginaSimples('Erro', 'Nome e e-mail são obrigatórios.'), 400);
      await parceiros.criar(body.nome.trim(), body.email.trim());
      return redirect(res, '/parceiros?ok=1');
    }

    // ---- Nova cotacao (form) ----
    if (metodo === 'GET' && path === '/cotacoes/nova') {
      return html(res, views.paginaNovaCotacao(await parceiros.listar(), negocio.COMERCIAIS));
    }

    // ---- Criar cotacao + disparar e-mails ----
    if (metodo === 'POST' && path === '/cotacoes') {
      const body = await lerBody(req);
      let selecionados = body.parceiros;
      if (!selecionados) {
        return html(res, views.paginaSimples('Erro', 'Selecione ao menos um parceiro. <a href="/cotacoes/nova">Voltar</a>'), 400);
      }
      if (!Array.isArray(selecionados)) selecionados = [selecionados];
      selecionados = selecionados.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);

      if (!negocio.COMERCIAIS.includes(body.comercial)) {
        return html(res, views.paginaSimples('Erro', 'Selecione um comercial responsável válido. <a href="/cotacoes/nova">Voltar</a>'), 400);
      }

      const c = await cotacoes.criar({
        origem: body.origem,
        destino: body.destino,
        peso_kg: Number(body.peso_kg),
        valor_mercadoria: Number(body.valor_mercadoria),
        tipo_veiculo: body.tipo_veiculo,
        comercial: body.comercial,
        observacoes: body.observacoes,
        prazo_resposta: parsePrazo(body.prazo_resposta),
      });

      for (const pid of selecionados) {
        const parceiro = await parceiros.obter(pid);
        if (!parceiro) continue;
        const t = token();
        await convites.criar(c.id, parceiro.id, t);
        const link = `${baseUrlDe(req)}/responder/${t}`;
        const prazoFmt = new Date(c.prazo_resposta).toLocaleString('pt-br');
        const corpoHtml = `
          <p>Olá ${parceiro.nome},</p>
          <p>Temos uma nova solicitação de cotação de transporte:</p>
          <ul>
            <li><strong>Origem → Destino:</strong> ${c.origem} → ${c.destino}</li>
            <li><strong>Peso da carga:</strong> ${c.peso_kg} kg</li>
            <li><strong>Valor da mercadoria:</strong> R$ ${c.valor_mercadoria}</li>
            <li><strong>Tipo de veículo:</strong> ${c.tipo_veiculo}</li>
          </ul>
          <p><strong>Responda até ${prazoFmt}</strong> clicando no link:</p>
          <p><a href="${link}">${link}</a></p>`;
        await enviarEmail({
          to: parceiro.email,
          subject: `Solicitação de cotação #${c.id}: ${c.origem} → ${c.destino}`,
          html: corpoHtml,
          text: `Nova cotacao #${c.id}\nTrajeto: ${c.origem} -> ${c.destino}\nPeso: ${c.peso_kg} kg\nValor mercadoria: R$ ${c.valor_mercadoria}\nVeiculo: ${c.tipo_veiculo}\nResponda ate ${prazoFmt}:\n${link}`,
        });
      }
      return redirect(res, `/cotacoes/${c.id}`);
    }

    // ---- Editar comissao variavel de uma cotacao fechada (INTERNO) ----
    let m = path.match(/^\/cotacoes\/(\d+)\/comissao$/);
    if (metodo === 'POST' && m) {
      const body = await lerBody(req);
      await cotacoes.atualizarComissao(m[1], Number(body.comissao_variavel || 0));
      return redirect(res, `/cotacoes/${m[1]}`);
    }

    // ---- Detalhe cotacao (INTERNO: mostra faturamento) ----
    m = path.match(/^\/cotacoes\/(\d+)$/);
    if (metodo === 'GET' && m) {
      let c = await cotacoes.obter(m[1]);
      if (!c) return html(res, views.paginaSimples('Não encontrada', 'Cotação não encontrada.'), 404);
      c = await negocio.fecharSeVencido(c); // fecha pelo menor valor se venceu
      const convs = await convites.porCotacao(c.id);
      const convComNome = [];
      for (const v of convs) {
        const p = await parceiros.obter(v.parceiro_id);
        convComNome.push({ ...v, nome: p?.nome || '?', email: p?.email || '' });
      }
      const status = negocio.statusDe(c, convs);
      const faturamento = negocio.faturamentoDe(c);
      const vencedorNome = c.parceiro_vencedor ? (await parceiros.obter(c.parceiro_vencedor))?.nome : null;
      return html(res, views.paginaDetalheCotacao(c, convComNome, { status, faturamento, vencedorNome, percFixo: negocio.PERC_FIXO }));
    }

    // ---- Pagina de resposta do parceiro (GET) ----
    // IMPORTANTE: parceiro NAO ve faturamento/comissao/vencedor.
    m = path.match(/^\/responder\/([a-f0-9]+)$/i);
    if (metodo === 'GET' && m) {
      const convite = await convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.'), 404);
      const c = await cotacoes.obter(convite.cotacao_id);
      const p = await parceiros.obter(convite.parceiro_id);
      return html(res, views.paginaRespostaParceiro(c, { ...convite, nome: p?.nome || '' }, negocio.expirada(c)));
    }

    // ---- Registrar resposta (POST) -- BLOQUEIA apos o prazo ----
    if (metodo === 'POST' && m) {
      const convite = await convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.'), 404);
      const c = await cotacoes.obter(convite.cotacao_id);

      if (negocio.expirada(c)) {
        return html(res, views.paginaSimples('Prazo encerrado', '⏰ O prazo para responder esta cotação já foi encerrado. Nenhuma resposta foi registrada.'), 403);
      }
      if (convite.respondido_em) {
        return html(res, views.paginaSimples('Já respondido', 'Você já enviou uma proposta para esta cotação.'));
      }

      const body = await lerBody(req);
      await convites.registrarResposta(m[1], {
        valor_cotado: Number(body.valor_cotado),
        prazo_entrega: body.prazo_entrega,
        comentario: body.comentario,
      });
      return html(res, views.paginaSimples('Proposta enviada', '✅ Sua proposta foi registrada com sucesso. Obrigado!'));
    }

    return html(res, views.paginaSimples('404', 'Página não encontrada.'), 404);
  } catch (err) {
    console.error('Erro:', err);
    return html(res, views.paginaSimples('Erro', 'Ocorreu um erro interno: ' + err.message), 500);
  }
}

// ---- Inicializacao ----
async function iniciar() {
  await inicializarBanco();
  if ((await parceiros.contar()) === 0) {
    await parceiros.criar('Transportadora Alfa', 'alfa@exemplo.com');
    await parceiros.criar('Rodoviário Beta', 'beta@exemplo.com');
    await parceiros.criar('Logística Gama', 'gama@exemplo.com');
    console.log('Parceiros de exemplo criados (Alfa, Beta, Gama).');
  }
  http.createServer(handler).listen(PORT, () => {
    console.log(`\nServidor rodando em ${BASE_URL}`);
    console.log(`Modo de e-mail: ${mailMode.toUpperCase()}${mailMode === 'mock' ? ' (simulado — links aparecem no log)' : ''}\n`);
  });
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
