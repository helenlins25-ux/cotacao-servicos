// Servidor HTTP usando apenas a lib padrao do Node.js (sem express).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { parceiros, cotacoes, convites } from './db.js';
import { enviarEmail, mailMode } from './mailer.js';
import * as views from './views.js';

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Descobre a URL publica para montar os links dos e-mails.
// Prioridade: BASE_URL (env) > cabecalhos da requisicao (proxy do host) > localhost.
function baseUrlDe(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return BASE_URL;
}

// ------- Helpers -------
const token = () => randomBytes(18).toString('hex'); // 36 chars
const agora = () => new Date();

function cotacaoExpirada(c) {
  if (c.status === 'encerrada') return true;
  return new Date(c.prazo_resposta) < agora();
}

function parsePrazo(valor) {
  // input datetime-local ex: "2026-11-10T18:00"
  return new Date(valor).toISOString();
}

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

// ------- Rotas -------
async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname;
  const metodo = req.method;

  try {
    // Lista de cotacoes (home)
    if (metodo === 'GET' && path === '/') {
      const lista = cotacoes.listar().map((c) => {
        const convs = convites.porCotacao(c.id);
        return {
          ...c,
          status: cotacaoExpirada(c) ? 'encerrada' : c.status,
          convidados: convs.length,
          respondidas: convs.filter((v) => v.respondido_em).length,
        };
      });
      return html(res, views.paginaListaCotacoes(lista));
    }

    // Parceiros
    if (metodo === 'GET' && path === '/parceiros') {
      return html(res, views.paginaParceiros(parceiros.listar(), url.searchParams.get('ok') ? 'Parceiro cadastrado com sucesso!' : null));
    }
    if (metodo === 'POST' && path === '/parceiros') {
      const body = await lerBody(req);
      if (!body.nome || !body.email) return html(res, views.paginaSimples('Erro', 'Nome e e-mail são obrigatórios.'), 400);
      parceiros.criar(body.nome.trim(), body.email.trim());
      return redirect(res, '/parceiros?ok=1');
    }

    // Nova cotacao (form)
    if (metodo === 'GET' && path === '/cotacoes/nova') {
      return html(res, views.paginaNovaCotacao(parceiros.listar()));
    }

    // Criar cotacao + disparar e-mails
    if (metodo === 'POST' && path === '/cotacoes') {
      const body = await lerBody(req);
      let selecionados = body.parceiros;
      if (!selecionados) {
        return html(res, views.paginaSimples('Erro', 'Selecione ao menos um parceiro. <a href="/cotacoes/nova">Voltar</a>'), 400);
      }
      if (!Array.isArray(selecionados)) selecionados = [selecionados];
      // tolera valores separados por virgula ("1,2") alem de parametros repetidos
      selecionados = selecionados.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);

      const c = cotacoes.criar({
        origem: body.origem,
        destino: body.destino,
        peso_kg: Number(body.peso_kg),
        valor_mercadoria: Number(body.valor_mercadoria),
        tipo_veiculo: body.tipo_veiculo,
        observacoes: body.observacoes,
        prazo_resposta: parsePrazo(body.prazo_resposta),
      });

      for (const pid of selecionados) {
        const parceiro = parceiros.obter(pid);
        if (!parceiro) continue;
        const t = token();
        convites.criar(c.id, parceiro.id, t);
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

    // Detalhe cotacao (match /cotacoes/:id)
    let m = path.match(/^\/cotacoes\/(\d+)$/);
    if (metodo === 'GET' && m) {
      const c = cotacoes.obter(m[1]);
      if (!c) return html(res, views.paginaSimples('Não encontrada', 'Cotação não encontrada.'), 404);
      const convs = convites.porCotacao(c.id).map((v) => {
        const p = parceiros.obter(v.parceiro_id);
        return { ...v, nome: p?.nome || '?', email: p?.email || '' };
      });
      return html(res, views.paginaDetalheCotacao(c, convs, cotacaoExpirada(c)));
    }

    // Pagina de resposta do parceiro (GET)
    m = path.match(/^\/responder\/([a-f0-9]+)$/i);
    if (metodo === 'GET' && m) {
      const convite = convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.'), 404);
      const c = cotacoes.obter(convite.cotacao_id);
      const p = parceiros.obter(convite.parceiro_id);
      return html(res, views.paginaRespostaParceiro(c, { ...convite, nome: p?.nome || '' }, cotacaoExpirada(c)));
    }

    // Registrar resposta (POST) -- BLOQUEIA apos o prazo
    if (metodo === 'POST' && m) {
      const convite = convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.'), 404);
      const c = cotacoes.obter(convite.cotacao_id);

      if (cotacaoExpirada(c)) {
        return html(res, views.paginaSimples('Prazo encerrado', '⏰ O prazo para responder esta cotação já foi encerrado. Nenhuma resposta foi registrada.'), 403);
      }
      if (convite.respondido_em) {
        return html(res, views.paginaSimples('Já respondido', 'Você já enviou uma proposta para esta cotação.'));
      }

      const body = await lerBody(req);
      convites.registrarResposta(m[1], {
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

// ------- Seed de parceiros de exemplo -------
if (parceiros.contar() === 0) {
  parceiros.criar('Transportadora Alfa', 'alfa@exemplo.com');
  parceiros.criar('Rodoviário Beta', 'beta@exemplo.com');
  parceiros.criar('Logística Gama', 'gama@exemplo.com');
  console.log('Parceiros de exemplo criados (Alfa, Beta, Gama).');
}

http.createServer(handler).listen(PORT, () => {
  console.log(`\nServidor rodando em ${BASE_URL}`);
  console.log(`Modo de e-mail: ${mailMode.toUpperCase()}${mailMode === 'mock' ? ' (simulado — links aparecem no log)' : ''}\n`);
});
