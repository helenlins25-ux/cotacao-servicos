// Servidor HTTP usando apenas a lib padrao do Node.js (sem express).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inicializarBanco, parceiros, cotacoes, convites } from './db.js';
import { enviarEmail, mailMode } from './mailer.js';
import * as negocio from './negocio.js';
import * as views from './views.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gif': 'image/gif', '.webp': 'image/webp' };

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

// Fuso horario da empresa (Brasilia = UTC-3). Configuravel via TZ_OFFSET_HORAS.
const TZ_OFFSET_HORAS = Number(process.env.TZ_OFFSET_HORAS ?? -3);

// O input datetime-local (ex: "2026-11-06T20:00") NAO traz fuso. O navegador
// envia no horario LOCAL do usuario. Interpretamos como horario de Brasilia
// (UTC-3) e convertemos para o instante UTC correto, para armazenar/comparar.
function parsePrazo(valor) {
  // valor: "YYYY-MM-DDTHH:MM" (sem timezone)
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(valor).toISOString(); // fallback
  const [, ano, mes, dia, hora, min] = m.map(Number);
  // Date.UTC monta o instante como se fosse UTC; subtraindo o offset local,
  // obtemos o UTC real. Ex: 20:00 em UTC-3 => 23:00 UTC.
  const ms = Date.UTC(ano, mes - 1, dia, hora, min) - TZ_OFFSET_HORAS * 3600 * 1000;
  return new Date(ms).toISOString();
}

// Monta e envia (tolerante a falha) o e-mail de uma cotacao para um parceiro.
// Retorna true se enviou, false se falhou (sem derrubar a requisicao).
async function enviarCotacaoAoParceiro(req, c, parceiro, tokenConvite) {
  const link = `${baseUrlDe(req)}/responder/${tokenConvite}`;
  const prazoFmt = new Date(c.prazo_resposta).toLocaleString('pt-br', { timeZone: 'America/Sao_Paulo' });
  // formata data (dia) em dd/mm/aaaa, aceitando string ("2026-11-09") OU objeto Date (Postgres)
  const fmtDia = (d) => {
    if (!d) return null;
    let iso;
    if (d instanceof Date) iso = d.toISOString().slice(0, 10);
    else {
      const s = String(d);
      iso = s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
    }
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const coletaFmt = fmtDia(c.data_coleta);
  const entregaFmt = c.data_entrega ? fmtDia(c.data_entrega) : 'A combinar';
  const corpoHtml = `
    <p>Olá ${parceiro.nome},</p>
    <p>Temos uma solicitação de cotação de transporte:</p>
    <ul>
      <li><strong>Origem → Destino:</strong> ${c.origem} → ${c.destino}</li>
      ${c.produto ? `<li><strong>Produto:</strong> ${c.produto}</li>` : ''}
      <li><strong>Peso da carga:</strong> ${c.peso_kg} kg</li>
      ${c.volume ? `<li><strong>Volume:</strong> ${c.volume}</li>` : ''}
      <li><strong>Valor da mercadoria:</strong> R$ ${c.valor_mercadoria}</li>
      <li><strong>Tipo de veículo:</strong> ${c.tipo_veiculo}</li>
      ${coletaFmt ? `<li><strong>Data da coleta:</strong> ${coletaFmt}</li>` : ''}
      <li><strong>Data da entrega:</strong> ${entregaFmt}</li>
    </ul>
    <p><strong>Responda até ${prazoFmt}</strong> clicando no link:</p>
    <p><a href="${link}">${link}</a></p>`;
  try {
    await enviarEmail({
      to: parceiro.email,
      subject: `Solicitação de cotação #${c.id}: ${c.origem} → ${c.destino}`,
      html: corpoHtml,
      text: `Cotacao #${c.id}\nTrajeto: ${c.origem} -> ${c.destino}${c.produto ? `\nProduto: ${c.produto}` : ''}\nPeso: ${c.peso_kg} kg${c.volume ? `\nVolume: ${c.volume}` : ''}\nValor mercadoria: R$ ${c.valor_mercadoria}\nVeiculo: ${c.tipo_veiculo}${coletaFmt ? `\nColeta: ${coletaFmt}` : ''}\nEntrega: ${entregaFmt}\nResponda ate ${prazoFmt}:\n${link}`,
    });
    return true;
  } catch (errMail) {
    console.error(`[EMAIL] Falha ao enviar para ${parceiro.email} (cotacao #${c.id}):`, errMail.message);
    return false;
  }
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

async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname;
  const metodo = req.method;

  try {
    // ---- Service worker (na raiz, necessario para instalar como PWA) ----
    if (metodo === 'GET' && path === '/sw.js') {
      const swFile = join(PUBLIC_DIR, 'sw.js');
      if (existsSync(swFile)) {
        const dados = await readFile(swFile);
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(dados);
      }
      res.writeHead(404); return res.end('not found');
    }

    // ---- Manifest PWA (permite instalar como app no celular) ----
    if (metodo === 'GET' && path === '/manifest.webmanifest') {
      const manifest = {
        name: 'Stractton Cotações',
        short_name: 'Cotações',
        description: 'Sistema de Cotação de Serviços de Transporte - Stractton Group',
        start_url: '/',
        display: 'standalone',
        background_color: '#111317',
        theme_color: '#111317',
        icons: [
          { src: '/static/logo.png', sizes: '497x480', type: 'image/png', purpose: 'any' },
          { src: '/static/logo.png', sizes: '192x192', type: 'image/png' },
          { src: '/static/logo.png', sizes: '512x512', type: 'image/png' },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      return res.end(JSON.stringify(manifest));
    }

    // ---- Arquivos estaticos (logo, imagens) ----
    if (metodo === 'GET' && path.startsWith('/static/')) {
      const nome = path.replace('/static/', '').replace(/\.\./g, ''); // evita path traversal
      const arquivo = join(PUBLIC_DIR, nome);
      if (existsSync(arquivo)) {
        const dados = await readFile(arquivo);
        res.writeHead(200, {
          'Content-Type': MIME[extname(arquivo).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end(dados);
      }
      res.writeHead(404);
      return res.end('not found');
    }

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
      const msg = url.searchParams.get('ok') ? 'Parceiro cadastrado com sucesso!'
        : url.searchParams.get('excluido') ? 'Parceiro excluído com sucesso!' : null;
      return html(res, views.paginaParceiros(await parceiros.listar(), msg));
    }
    if (metodo === 'POST' && path === '/parceiros') {
      const body = await lerBody(req);
      if (!body.nome || !body.email) return html(res, views.paginaSimples('Erro', 'Nome e e-mail são obrigatórios.'), 400);
      await parceiros.criar(body.nome.trim(), body.email.trim());
      return redirect(res, '/parceiros?ok=1');
    }

    // ---- Excluir parceiro ----
    let mDel = path.match(/^\/parceiros\/(\d+)\/excluir$/);
    if (metodo === 'POST' && mDel) {
      const id = mDel[1];
      const usos = await parceiros.usos(id);
      if (usos > 0) {
        // parceiro ja participou de cotacoes: nao excluir (manteria historico/faturamento)
        return html(res, views.paginaSimples('Não é possível excluir',
          `Este parceiro já participou de ${usos} cotação(ões) e não pode ser excluído, para preservar o histórico e os indicadores. <a href="/parceiros">Voltar</a>`), 409);
      }
      await parceiros.excluir(id);
      return redirect(res, '/parceiros?excluido=1');
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
        produto: body.produto,
        volume: body.volume,
        valor_mercadoria: Number(body.valor_mercadoria),
        tipo_veiculo: body.tipo_veiculo,
        comercial: body.comercial,
        data_coleta: body.data_coleta || null,
        data_entrega: body.data_entrega || null,
        observacoes: body.observacoes,
        prazo_resposta: parsePrazo(body.prazo_resposta),
      });

      for (const pid of selecionados) {
        const parceiro = await parceiros.obter(pid);
        if (!parceiro) continue;
        const t = token();
        await convites.criar(c.id, parceiro.id, t);
        await enviarCotacaoAoParceiro(req, c, parceiro, t);
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

    // ---- Reenviar cotacao a um parceiro (reenvia o mesmo link por e-mail) ----
    let mReenv = path.match(/^\/cotacoes\/(\d+)\/convites\/(\d+)\/reenviar$/);
    if (metodo === 'POST' && mReenv) {
      const [, cotId, convId] = mReenv;
      const c = await cotacoes.obter(cotId);
      const convite = await convites.porId(convId);
      if (!c || !convite || convite.cotacao_id !== Number(cotId)) {
        return html(res, views.paginaSimples('Erro', 'Convite não encontrado. <a href="/cotacoes">Voltar</a>'), 404);
      }
      if (negocio.expirada(c)) {
        return html(res, views.paginaSimples('Prazo encerrado', 'Não é possível reenviar: o prazo desta cotação já encerrou. <a href="/cotacoes/' + cotId + '">Voltar</a>'), 409);
      }
      if (convite.respondido_em) {
        return html(res, views.paginaSimples('Já respondido', 'Este parceiro já respondeu — não é necessário reenviar. <a href="/cotacoes/' + cotId + '">Voltar</a>'), 409);
      }
      const parceiro = await parceiros.obter(convite.parceiro_id);
      const enviado = await enviarCotacaoAoParceiro(req, c, parceiro, convite.token);
      return redirect(res, `/cotacoes/${cotId}?reenviado=${enviado ? '1' : 'falha'}`);
    }

    // ---- Cancelar convite de um parceiro (so se ainda nao respondeu) ----
    let mCanc = path.match(/^\/cotacoes\/(\d+)\/convites\/(\d+)\/cancelar$/);
    if (metodo === 'POST' && mCanc) {
      const [, cotId, convId] = mCanc;
      const convite = await convites.porId(convId);
      if (!convite || convite.cotacao_id !== Number(cotId)) {
        return html(res, views.paginaSimples('Erro', 'Convite não encontrado. <a href="/cotacoes">Voltar</a>'), 404);
      }
      if (convite.respondido_em) {
        return html(res, views.paginaSimples('Não é possível cancelar', 'Este parceiro já enviou uma proposta; não é possível cancelar o convite dele. <a href="/cotacoes/' + cotId + '">Voltar</a>'), 409);
      }
      await convites.excluir(convId);
      return redirect(res, `/cotacoes/${cotId}?cancelado=1`);
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
      // mensagens de feedback (reenvio/cancelamento)
      let aviso = null;
      if (url.searchParams.get('reenviado') === '1') aviso = { tipo: 'ok', texto: '✅ Cotação reenviada ao parceiro por e-mail.' };
      else if (url.searchParams.get('reenviado') === 'falha') aviso = { tipo: 'warn', texto: '⚠️ Não foi possível enviar o e-mail (o link continua válido no painel).' };
      else if (url.searchParams.get('cancelado') === '1') aviso = { tipo: 'ok', texto: '✅ Convite do parceiro cancelado.' };
      return html(res, views.paginaDetalheCotacao(c, convComNome, { status, faturamento, vencedorNome, percFixo: negocio.PERC_FIXO, expirada: negocio.expirada(c), aviso }));
    }

    // ---- Pagina de resposta do parceiro (GET) ----
    // IMPORTANTE: parceiro NAO ve faturamento/comissao/vencedor.
    m = path.match(/^\/responder\/([a-f0-9]+)$/i);
    if (metodo === 'GET' && m) {
      const convite = await convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.', true), 404);
      const c = await cotacoes.obter(convite.cotacao_id);
      const p = await parceiros.obter(convite.parceiro_id);
      return html(res, views.paginaRespostaParceiro(c, { ...convite, nome: p?.nome || '' }, negocio.expirada(c)));
    }

    // ---- Registrar resposta (POST) -- BLOQUEIA apos o prazo ----
    if (metodo === 'POST' && m) {
      const convite = await convites.porToken(m[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link de cotação não existe.', true), 404);
      const c = await cotacoes.obter(convite.cotacao_id);

      if (negocio.expirada(c)) {
        return html(res, views.paginaSimples('Prazo encerrado', '⏰ O prazo para responder esta cotação já foi encerrado. Nenhuma resposta foi registrada.', true), 403);
      }
      if (convite.respondido_em) {
        return html(res, views.paginaSimples('Já respondido', 'Você já enviou uma proposta para esta cotação.', true));
      }

      const body = await lerBody(req);
      await convites.registrarResposta(m[1], {
        valor_cotado: Number(body.valor_cotado),
        prazo_entrega: body.prazo_entrega,
        comentario: body.comentario,
      });
      return html(res, views.paginaSimples('Proposta enviada', '✅ Sua proposta foi registrada com sucesso. Obrigado!', true));
    }

    return html(res, views.paginaSimples('404', 'Página não encontrada.', true), 404);
  } catch (err) {
    console.error('Erro:', err);
    return html(res, views.paginaSimples('Erro', 'Ocorreu um erro interno: ' + err.message, true), 500);
  }
}

// ---- Inicializacao ----
async function iniciar() {
  await inicializarBanco();
  // (sem parceiros de exemplo: o cadastro e feito pela tela de Parceiros)
  http.createServer(handler).listen(PORT, () => {
    console.log(`\nServidor rodando em ${BASE_URL}`);
    console.log(`Modo de e-mail: ${mailMode.toUpperCase()}${mailMode === 'mock' ? ' (simulado — links aparecem no log)' : ''}\n`);
  });
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
