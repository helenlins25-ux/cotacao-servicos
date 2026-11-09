// Servidor HTTP usando apenas a lib padrao do Node.js (sem express).
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inicializarBanco, parceiros, cotacoes, convites, usuarios, leads, leadContatos } from './db.js';
import * as leadsMod from './leads.js';
import { enviarEmail, mailMode } from './mailer.js';
import * as negocio from './negocio.js';
import * as views from './views.js';
import * as auth from './auth.js';
import * as storage from './storage.js';

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

// Notifica os parceiros do RESULTADO da cotacao fechada:
// - vencedor recebe "ganhou" + link para preencher dados do veiculo
// - demais recebem "nao foi desta vez"
// Marca a cotacao como notificada para nao reenviar automaticamente.
async function notificarResultado(req, c) {
  const convs = await convites.porCotacao(c.id);
  const base = baseUrlDe(req);
  for (const v of convs) {
    const p = await parceiros.obter(v.parceiro_id);
    if (!p) continue;
    const ehVencedor = c.parceiro_vencedor && v.parceiro_id === c.parceiro_vencedor;
    try {
      if (ehVencedor) {
        const link = `${base}/veiculo/${v.token}`;
        await enviarEmail({
          to: p.email,
          subject: `✅ Você ganhou a cotação #${c.id}: ${c.origem} → ${c.destino}`,
          html: `<p>Parabéns, ${p.nome}!</p>
            <p>Sua proposta foi <strong>selecionada</strong> para a cotação <strong>#${c.id}</strong> (${c.origem} → ${c.destino}).</p>
            <p>Para confirmar e darmos sequência, informe os <strong>dados do veículo e motorista</strong> que farão a viagem, no link abaixo:</p>
            <p><a href="${link}">${link}</a></p>
            <p>Obrigado por trabalhar com a Stractton Group!</p>`,
          text: `Parabens, ${p.nome}! Sua proposta foi selecionada para a cotacao #${c.id} (${c.origem} -> ${c.destino}).\nInforme os dados do veiculo/motorista no link:\n${link}`,
        });
      } else if (v.respondido_em) {
        // so avisa quem realmente enviou proposta
        await enviarEmail({
          to: p.email,
          subject: `Resultado da cotação #${c.id}: ${c.origem} → ${c.destino}`,
          html: `<p>Olá, ${p.nome}.</p>
            <p>Agradecemos sua proposta na cotação <strong>#${c.id}</strong> (${c.origem} → ${c.destino}).</p>
            <p>Desta vez a cotação foi fechada com outro parceiro. Contamos com você nas próximas oportunidades!</p>
            <p>Atenciosamente,<br>Stractton Group</p>`,
          text: `Ola, ${p.nome}. Agradecemos sua proposta na cotacao #${c.id}. Desta vez foi fechada com outro parceiro. Contamos com voce nas proximas!`,
        });
      }
    } catch (e) {
      console.error(`[EMAIL] Falha ao notificar resultado para ${p.email} (cotacao #${c.id}):`, e.message);
    }
  }
  await cotacoes.marcarNotificado(c.id);
}

// Varre as cotacoes e notifica automaticamente as que FECHARAM e ainda nao foram
// notificadas (tem vencedor e fechado_em, mas sem resultado_notificado_em).
async function notificarFechamentosPendentes(req) {
  try {
    const lista = await cotacoes.listar();
    for (const c of lista) {
      if (c.fechado_em && c.parceiro_vencedor && !c.resultado_notificado_em) {
        await notificarResultado(req, c);
      }
    }
  } catch (e) {
    console.error('[NOTIF] Erro ao notificar fechamentos pendentes:', e.message);
  }
}

// ---- Helpers do modulo Leads ----
function lerDadosLead(b) {
  const t = (s) => String(s ?? '').trim();
  const dia = t(b.proximo_contato);
  return {
    empresa: t(b.empresa), contato: t(b.contato), telefone: t(b.telefone), email: t(b.email),
    origem: t(b.origem), comercial: t(b.comercial),
    etapa: leadsMod.etapaValida(t(b.etapa)) ? t(b.etapa) : null,
    proximo_contato: /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
    observacoes: t(b.observacoes),
  };
}
function validarLead(d) {
  if (!d.empresa) return 'Informe o nome da empresa.';
  if (!negocio.COMERCIAIS.includes(d.comercial)) return 'Selecione o comercial responsável.';
  return null;
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

// Le body multipart/form-data (para upload de arquivo). Retorna { campos, arquivo }.
// arquivo = { nome, contentType, buffer } ou null. Limite de 8MB.
function lerMultipart(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = ct.match(/boundary=(.+)$/);
    if (!m) return resolve({ campos: {}, arquivo: null });
    const boundary = '--' + m[1];
    const chunks = [];
    let tamanho = 0;
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > 8 * 1024 * 1024) { reject(new Error('Arquivo muito grande (máx 8MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const campos = {};
        let arquivo = null;
        const sep = Buffer.from('\r\n\r\n');
        const partes = dividirBuffer(buf, Buffer.from(boundary));
        for (const parte of partes) {
          if (parte.length < 4) continue;
          const idx = parte.indexOf(sep);
          if (idx < 0) continue;
          const header = parte.slice(0, idx).toString('utf8');
          let corpo = parte.slice(idx + sep.length);
          // remove o \r\n final da parte
          if (corpo.slice(-2).toString() === '\r\n') corpo = corpo.slice(0, -2);
          const nomeCampo = (header.match(/name="([^"]*)"/) || [])[1];
          const filename = (header.match(/filename="([^"]*)"/) || [])[1];
          if (!nomeCampo) continue;
          if (filename) {
            if (filename.trim() !== '') {
              const tipo = (header.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
              arquivo = { nome: filename, contentType: tipo.trim(), buffer: corpo };
            }
          } else {
            campos[nomeCampo] = corpo.toString('utf8');
          }
        }
        resolve({ campos, arquivo });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function dividirBuffer(buf, sep) {
  const partes = [];
  let ini = 0;
  while (true) {
    const idx = buf.indexOf(sep, ini);
    if (idx < 0) { partes.push(buf.slice(ini)); break; }
    partes.push(buf.slice(ini, idx));
    ini = idx + sep.length;
  }
  return partes;
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

    // ======== AUTENTICACAO ========
    // Rotas publicas (sem login): link do parceiro (responder + veiculo) e a tela de login.
    const ehRotaParceiro = /^\/responder\//.test(path) || /^\/veiculo\//.test(path);
    const ehLogin = (path === '/login');

    // Sessao atual (se houver)
    const sessao = auth.obterSessao(auth.lerCookie(req, 'sid'));
    views.definirUsuarioAtual(sessao ? { nome: sessao.nome, perfil: sessao.perfil, email: sessao.email } : null);
    views.definirModulo(path.startsWith('/leads') ? 'leads' : 'cotacao');
    views.definirCaminho(path);

    // ---- GET /login : mostra a tela de login ----
    if (metodo === 'GET' && ehLogin) {
      if (sessao) return redirect(res, '/');
      return html(res, views.paginaLogin(url.searchParams.get('erro') ? 'E-mail ou senha incorretos.' : null));
    }
    // ---- POST /login : autentica ----
    if (metodo === 'POST' && ehLogin) {
      const body = await lerBody(req);
      const u = await usuarios.porEmail(body.email || '');
      if (!u || !auth.verificarSenha(body.senha || '', u.senha_hash)) {
        return redirect(res, '/login?erro=1');
      }
      const sid = auth.criarSessao(u);
      res.writeHead(302, { 'Set-Cookie': auth.cookieSessao(sid), Location: '/' });
      return res.end();
    }
    // ---- GET /logout ----
    if (metodo === 'GET' && path === '/logout') {
      auth.destruirSessao(auth.lerCookie(req, 'sid'));
      res.writeHead(302, { 'Set-Cookie': auth.cookieLimpar(), Location: '/login' });
      return res.end();
    }

    // Proteção: tudo que NAO for rota do parceiro exige login.
    if (!ehRotaParceiro && !sessao) {
      return redirect(res, '/login');
    }
    // So ADM acessa a area de usuarios.
    if (path.startsWith('/usuarios') && sessao && sessao.perfil !== 'adm') {
      return html(res, views.paginaSimples('Acesso negado', 'Apenas administradores podem gerenciar usuários. <a href="/">Voltar</a>'), 403);
    }
    // ======== FIM AUTENTICACAO ========

    // ---- Gestao de usuarios (so ADM) ----
    if (metodo === 'GET' && path === '/usuarios') {
      const msg = url.searchParams.get('ok') ? 'Acesso criado com sucesso!'
        : url.searchParams.get('removido') ? 'Acesso removido com sucesso!' : null;
      return html(res, views.paginaUsuarios(await usuarios.listar(), msg, null));
    }
    if (metodo === 'POST' && path === '/usuarios') {
      const body = await lerBody(req);
      if (!body.nome || !body.email || !body.senha) {
        return html(res, views.paginaUsuarios(await usuarios.listar(), null, 'Preencha nome, e-mail e senha.'), 400);
      }
      const perfil = body.perfil === 'adm' ? 'adm' : 'comercial';
      if (await usuarios.porEmail(body.email)) {
        return html(res, views.paginaUsuarios(await usuarios.listar(), null, 'Já existe um usuário com esse e-mail.'), 409);
      }
      await usuarios.criar(body.nome.trim(), body.email, auth.hashSenha(body.senha), perfil);
      return redirect(res, '/usuarios?ok=1');
    }
    let mUserDel = path.match(/^\/usuarios\/(\d+)\/excluir$/);
    if (metodo === 'POST' && mUserDel) {
      const alvo = Number(mUserDel[1]);
      if (alvo === sessao.usuarioId) {
        return html(res, views.paginaUsuarios(await usuarios.listar(), null, 'Você não pode remover o seu próprio acesso.'), 409);
      }
      await usuarios.excluir(alvo);
      return redirect(res, '/usuarios?removido=1');
    }

    // ---- Financeiro (interno: ADM + Comercial) ----
    if (metodo === 'GET' && path === '/financeiro') {
      const fin = await negocio.calcularFinanceiro();
      await notificarFechamentosPendentes(req);
      const msg = url.searchParams.get('ok') ? 'Controle financeiro atualizado com sucesso!' : null;
      return html(res, views.paginaFinanceiro(fin, msg));
    }
    let mFin = path.match(/^\/cotacoes\/(\d+)\/financeiro$/);
    if (metodo === 'POST' && mFin) {
      const c = await cotacoes.obter(mFin[1]);
      if (!c || !c.fechado_em) {
        return html(res, views.paginaSimples('Erro', 'Só é possível controlar o financeiro de cotações fechadas. <a href="/financeiro">Voltar</a>'), 409);
      }
      const body = await lerBody(req);
      // data de hoje no fuso de Brasilia (padrao quando marcar "Sim" sem informar a data)
      const hoje = new Date(Date.now() + TZ_OFFSET_HORAS * 3600 * 1000).toISOString().slice(0, 10);
      const dataValida = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
      const recebido_em = body.recebido === 'sim' ? (dataValida(body.recebido_em) || hoje) : null;
      // bonificacao so pode ser marcada como paga se existir valor de bonificacao
      const temBonif = Number(c.bonificacao || 0) > 0;
      const bonificacao_paga_em = (temBonif && body.bonif_paga === 'sim') ? (dataValida(body.bonif_paga_em) || hoje) : null;
      await cotacoes.atualizarFinanceiro(c.id, { recebido_em, bonificacao_paga_em });
      return redirect(res, '/financeiro?ok=1');
    }

    // ======== MODULO LEADS (interno: ADM + Comercial) ========
    if (metodo === 'GET' && path === '/leads/painel') {
      const painel = await leadsMod.calcularPainelLeads(TZ_OFFSET_HORAS); // fecha cotacoes vencidas
      await notificarFechamentosPendentes(req);                          // avisa os parceiros do resultado
      return html(res, views.paginaLeadsPainel(painel));
    }
    if (metodo === 'GET' && path === '/leads') {
      const filtros = {
        q: (url.searchParams.get('q') || '').trim(),
        etapa: url.searchParams.get('etapa') || '',
        comercial: url.searchParams.get('comercial') || '',
      };
      let lista = await leads.listar();
      if (filtros.etapa) lista = lista.filter((l) => l.etapa === filtros.etapa);
      if (filtros.comercial) lista = lista.filter((l) => l.comercial === filtros.comercial);
      if (filtros.q) {
        const q = filtros.q.toLowerCase();
        lista = lista.filter((l) => [l.empresa, l.contato, l.telefone, l.email].some((x) => String(x || '').toLowerCase().includes(q)));
      }
      const msg = url.searchParams.get('excluido') ? 'Lead excluído com sucesso.' : null;
      return html(res, views.paginaLeadsLista(lista, filtros, { comerciais: negocio.COMERCIAIS, hoje: leadsMod.hojeISO(TZ_OFFSET_HORAS), msg }));
    }
    if (metodo === 'GET' && path === '/leads/novo') {
      return html(res, views.paginaLeadNovo(negocio.COMERCIAIS, null, null));
    }
    if (metodo === 'POST' && path === '/leads') {
      const dados = lerDadosLead(await lerBody(req));
      const erro = validarLead(dados);
      if (erro) return html(res, views.paginaLeadNovo(negocio.COMERCIAIS, erro, dados), 400);
      const l = await leads.criar({ ...dados, etapa: dados.etapa || 'novo' });
      return redirect(res, `/leads/${l.id}?criado=1`);
    }

    let mLead = path.match(/^\/leads\/(\d+)$/);
    if (mLead) {
      const l = await leads.obter(mLead[1]);
      if (!l) return html(res, views.paginaSimples('Não encontrado', 'Lead não encontrado. <a href="/leads">Voltar</a>'), 404);
      const ctxLead = {
        comerciais: negocio.COMERCIAIS, hoje: leadsMod.hojeISO(TZ_OFFSET_HORAS),
        cotacoes: await negocio.cotacoesDoLead(l.id), // cotacoes vinculadas a este lead
      };

      if (metodo === 'GET') {
        await notificarFechamentosPendentes(req);
        const q = url.searchParams;
        const aviso = q.get('criado') ? 'Lead cadastrado com sucesso!'
          : q.get('atualizado') ? 'Dados do lead atualizados.'
          : q.get('ganho') ? 'Lead marcado como Ganho.'
          : q.get('contato') ? 'Contato registrado.' : null;
        return html(res, views.paginaLeadDetalhe(l, await leadContatos.porLead(l.id), { ...ctxLead, aviso }));
      }
      if (metodo === 'POST') { // editar dados
        const dados = lerDadosLead(await lerBody(req));
        const erro = validarLead(dados);
        if (erro) return html(res, views.paginaLeadDetalhe(l, await leadContatos.porLead(l.id), { ...ctxLead, erro }), 400);
        await leads.atualizar(l.id, { ...dados, etapa: dados.etapa || l.etapa });
        return redirect(res, `/leads/${l.id}?atualizado=1`);
      }
    }

    let mLeadCont = path.match(/^\/leads\/(\d+)\/contatos$/);
    if (metodo === 'POST' && mLeadCont) {
      const l = await leads.obter(mLeadCont[1]);
      if (!l) return html(res, views.paginaSimples('Não encontrado', 'Lead não encontrado. <a href="/leads">Voltar</a>'), 404);
      const b = await lerBody(req);
      const descricao = String(b.descricao || '').trim();
      if (!descricao) {
        return html(res, views.paginaLeadDetalhe(l, await leadContatos.porLead(l.id),
          { comerciais: negocio.COMERCIAIS, hoje: leadsMod.hojeISO(TZ_OFFSET_HORAS), cotacoes: await negocio.cotacoesDoLead(l.id), erro: 'Descreva o que foi conversado.' }), 400);
      }
      const tipo = leadsMod.TIPOS_CONTATO.includes(b.tipo) ? b.tipo : 'Outro';
      const etapa = leadsMod.etapaValida(b.etapa) ? b.etapa : l.etapa;
      const dia = String(b.proximo_contato || '').trim();
      const proximo = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
      await leadContatos.criar(l.id, tipo, descricao, sessao.nome);
      await leads.atualizarAndamento(l.id, etapa, proximo);
      return redirect(res, `/leads/${l.id}?contato=1`);
    }

    // Marca o lead como GANHO (acao manual, sugerida quando ha cotacao fechada vinculada)
    let mLeadGanho = path.match(/^\/leads\/(\d+)\/ganho$/);
    if (metodo === 'POST' && mLeadGanho) {
      const l = await leads.obter(mLeadGanho[1]);
      if (!l) return html(res, views.paginaSimples('Não encontrado', 'Lead não encontrado. <a href="/leads">Voltar</a>'), 404);
      const fechadas = (await negocio.cotacoesDoLead(l.id)).filter((c) => c.status === 'fechada');
      if (!fechadas.length) {
        return html(res, views.paginaSimples('Não é possível', 'Este lead ainda não tem cotação fechada. <a href="/leads/' + l.id + '">Voltar</a>'), 409);
      }
      await leads.atualizarAndamento(l.id, 'ganho', null);
      await leadContatos.criar(l.id, 'Outro', `Lead marcado como Ganho (cotação #${fechadas[0].id} fechada).`, sessao.nome);
      return redirect(res, `/leads/${l.id}?ganho=1`);
    }

    let mLeadDel = path.match(/^\/leads\/(\d+)\/excluir$/);
    if (metodo === 'POST' && mLeadDel) {
      await leads.excluir(mLeadDel[1]);
      return redirect(res, '/leads?excluido=1');
    }

    // ---- Dashboard (home) ----
    if (metodo === 'GET' && path === '/') {
      const dash = await negocio.calcularDashboard(); // fecha cotacoes vencidas
      await notificarFechamentosPendentes(req);       // notifica os resultados (auto)
      return html(res, views.paginaDashboard(dash));
    }

    // ---- Lista de cotacoes ----
    if (metodo === 'GET' && path === '/cotacoes') {
      const lista = await negocio.carregarCotacoesProcessadas();
      await notificarFechamentosPendentes(req);
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
      // ?lead=ID pre-seleciona o lead (e o comercial dele) — vindo do botao "Gerar cotacao" no lead
      const todosLeads = await leads.listar();
      const leadSel = todosLeads.find((l) => String(l.id) === String(url.searchParams.get('lead') || ''));
      return html(res, views.paginaNovaCotacao(await parceiros.listar(), negocio.COMERCIAIS, {
        leads: todosLeads, leadId: leadSel?.id, comercial: leadSel?.comercial,
      }));
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

      // lead de origem (opcional): so aceita se o lead existir
      const leadVinc = body.lead_id ? await leads.obter(body.lead_id) : null;

      const c = await cotacoes.criar({
        lead_id: leadVinc ? leadVinc.id : null,
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
      await cotacoes.atualizarComissao(m[1], Number(body.comissao_variavel || 0), Number(body.bonificacao || 0));
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
      // notifica o resultado automaticamente se acabou de fechar e ainda nao notificou
      if (c.fechado_em && c.parceiro_vencedor && !c.resultado_notificado_em) {
        await notificarResultado(req, c);
        c = await cotacoes.obter(m[1]); // recarrega com resultado_notificado_em
      }
      const convs = await convites.porCotacao(c.id);
      const convComNome = [];
      for (const v of convs) {
        const p = await parceiros.obter(v.parceiro_id);
        convComNome.push({ ...v, nome: p?.nome || '?', email: p?.email || '' });
      }
      const status = negocio.statusDe(c, convs);
      const faturamento = negocio.faturamentoDe(c);
      const vencedorNome = c.parceiro_vencedor ? (await parceiros.obter(c.parceiro_vencedor))?.nome : null;
      // mensagens de feedback (reenvio/cancelamento/notificacao)
      let aviso = null;
      if (url.searchParams.get('reenviado') === '1') aviso = { tipo: 'ok', texto: '✅ Cotação reenviada ao parceiro por e-mail.' };
      else if (url.searchParams.get('reenviado') === 'falha') aviso = { tipo: 'warn', texto: '⚠️ Não foi possível enviar o e-mail (o link continua válido no painel).' };
      else if (url.searchParams.get('cancelado') === '1') aviso = { tipo: 'ok', texto: '✅ Convite do parceiro cancelado.' };
      else if (url.searchParams.get('renotificado') === '1') aviso = { tipo: 'ok', texto: '✅ Notificação de resultado reenviada aos parceiros.' };
      else if (url.searchParams.get('lead_ok')) aviso = { tipo: 'ok', texto: '✅ Vínculo com o lead atualizado.' };
      const leadVinc = c.lead_id ? await leads.obter(c.lead_id) : null;
      return html(res, views.paginaDetalheCotacao(c, convComNome, {
        status, faturamento, vencedorNome, percFixo: negocio.PERC_FIXO, expirada: negocio.expirada(c), aviso,
        lead: leadVinc, leadsLista: await leads.listar(),
      }));
    }

    // ---- Vincular / desvincular a cotacao a um lead ----
    let mCotLead = path.match(/^\/cotacoes\/(\d+)\/lead$/);
    if (metodo === 'POST' && mCotLead) {
      const c = await cotacoes.obter(mCotLead[1]);
      if (!c) return html(res, views.paginaSimples('Não encontrada', 'Cotação não encontrada. <a href="/cotacoes">Voltar</a>'), 404);
      const b = await lerBody(req);
      const alvo = b.lead_id ? await leads.obter(b.lead_id) : null;
      if (b.lead_id && !alvo) {
        return html(res, views.paginaSimples('Erro', 'Lead não encontrado. <a href="/cotacoes/' + c.id + '">Voltar</a>'), 404);
      }
      await cotacoes.vincularLead(c.id, alvo ? alvo.id : null);
      return redirect(res, `/cotacoes/${c.id}?lead_ok=1`);
    }

    // ---- Relatorio da cotacao (SEM bloco financeiro) ----
    let mRel = path.match(/^\/cotacoes\/(\d+)\/relatorio$/);
    if (metodo === 'GET' && mRel) {
      let c = await cotacoes.obter(mRel[1]);
      if (!c) return html(res, views.paginaSimples('Não encontrada', 'Cotação não encontrada.'), 404);
      c = await negocio.fecharSeVencido(c);
      const convs = await convites.porCotacao(c.id);
      const convComNome = [];
      for (const v of convs) {
        const p = await parceiros.obter(v.parceiro_id);
        convComNome.push({ ...v, nome: p?.nome || '?' });
      }
      const status = negocio.statusDe(c, convs);
      const vencedorNome = c.parceiro_vencedor ? (await parceiros.obter(c.parceiro_vencedor))?.nome : null;
      return html(res, views.paginaRelatorio(c, convComNome, { status, vencedorNome }));
    }

    // ---- Reenviar notificacao de resultado aos parceiros (cotacao fechada) ----
    let mRenotif = path.match(/^\/cotacoes\/(\d+)\/notificar$/);
    if (metodo === 'POST' && mRenotif) {
      const c = await cotacoes.obter(mRenotif[1]);
      if (!c || !c.fechado_em) {
        return html(res, views.paginaSimples('Erro', 'Só é possível notificar cotações fechadas. <a href="/cotacoes">Voltar</a>'), 409);
      }
      await notificarResultado(req, c);
      return redirect(res, `/cotacoes/${mRenotif[1]}?renotificado=1`);
    }

    // ---- Pagina do vencedor: preencher dados do veiculo (EXTERNO, via token) ----
    let mVeicGet = path.match(/^\/veiculo\/([a-f0-9]+)$/i);
    if (metodo === 'GET' && mVeicGet) {
      const convite = await convites.porToken(mVeicGet[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link não existe.', true), 404);
      let c = await cotacoes.obter(convite.cotacao_id);
      c = await negocio.fecharSeVencido(c);
      // so o vencedor pode preencher
      if (!c.fechado_em || c.parceiro_vencedor !== convite.parceiro_id) {
        return html(res, views.paginaSimples('Indisponível', 'Esta cotação ainda não foi fechada com você, ou não está mais disponível.', true), 403);
      }
      const p = await parceiros.obter(convite.parceiro_id);
      let aviso = null;
      if (url.searchParams.get('veiculo_ok')) aviso = '✅ Dados do veículo registrados! Agora você pode atualizar o andamento da viagem abaixo.';
      else if (url.searchParams.get('andamento_ok')) aviso = '✅ Andamento da viagem atualizado. Obrigado!';
      return html(res, views.paginaVeiculo(c, { nome: p?.nome || '', token: convite.token, aviso, anexoAtivo: storage.storageConfigurado() }));
    }
    // ---- Salvar dados do veiculo (POST, EXTERNO) ----
    if (metodo === 'POST' && mVeicGet) {
      const convite = await convites.porToken(mVeicGet[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link não existe.', true), 404);
      let c = await cotacoes.obter(convite.cotacao_id);
      if (!c.fechado_em || c.parceiro_vencedor !== convite.parceiro_id) {
        return html(res, views.paginaSimples('Indisponível', 'Esta cotação não está disponível para preenchimento.', true), 403);
      }
      const body = await lerBody(req);
      if (!body.placa) {
        return html(res, views.paginaSimples('Erro', 'Informe ao menos a placa do veículo. <a href="/veiculo/' + convite.token + '">Voltar</a>', true), 400);
      }
      await cotacoes.salvarVeiculo(c.id, { placa: body.placa, motorista: body.motorista, telefone: body.telefone });
      return redirect(res, `/veiculo/${convite.token}?veiculo_ok=1`);
    }

    // ---- Atualizar andamento da viagem: coleta/entrega + anexo (POST, EXTERNO, multipart) ----
    let mAndamento = path.match(/^\/veiculo\/([a-f0-9]+)\/andamento$/i);
    if (metodo === 'POST' && mAndamento) {
      const convite = await convites.porToken(mAndamento[1]);
      if (!convite) return html(res, views.paginaSimples('Link inválido', 'Este link não existe.', true), 404);
      let c = await cotacoes.obter(convite.cotacao_id);
      if (!c.fechado_em || c.parceiro_vencedor !== convite.parceiro_id) {
        return html(res, views.paginaSimples('Indisponível', 'Esta cotação não está disponível.', true), 403);
      }
      let campos = {}, arquivo = null;
      try {
        const parsed = await lerMultipart(req);
        campos = parsed.campos; arquivo = parsed.arquivo;
      } catch (e) {
        return html(res, views.paginaSimples('Erro', 'Falha no envio: ' + e.message + ' <a href="/veiculo/' + convite.token + '">Voltar</a>', true), 400);
      }
      // upload do comprovante (se houver arquivo e storage configurado)
      let comprovanteUrl;
      if (arquivo && storage.storageConfigurado()) {
        try {
          const ext = storage.extDeTipo(arquivo.contentType);
          const nome = `cotacao-${c.id}/comprovante-${Date.now()}.${ext}`;
          comprovanteUrl = await storage.enviarArquivo(nome, arquivo.buffer, arquivo.contentType);
        } catch (e) {
          console.error('[STORAGE] Falha no upload:', e.message);
          return html(res, views.paginaSimples('Erro no anexo', 'Não foi possível enviar o anexo: ' + e.message + ' <a href="/veiculo/' + convite.token + '">Voltar</a>', true), 500);
        }
      } else if (arquivo && !storage.storageConfigurado()) {
        return html(res, views.paginaSimples('Anexo indisponível', 'O envio de anexos ainda não está configurado. <a href="/veiculo/' + convite.token + '">Voltar</a>', true), 400);
      }
      await cotacoes.salvarAndamento(c.id, {
        coletado: campos.coletado === 'sim' ? 'sim' : (campos.coletado === 'nao' ? 'nao' : undefined),
        entregue: campos.entregue === 'sim' ? 'sim' : (campos.entregue === 'nao' ? 'nao' : undefined),
        comprovante_url: comprovanteUrl,
      });
      return redirect(res, `/veiculo/${convite.token}?andamento_ok=1`);
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

  // Cria/garante o primeiro ADM a partir das variaveis de ambiente.
  // ADMIN_EMAIL + ADMIN_SENHA (defina no Render). Se o usuario ja existe, nao duplica.
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminSenha = process.env.ADMIN_SENHA;
  if (adminEmail && adminSenha) {
    const existente = await usuarios.porEmail(adminEmail);
    if (!existente) {
      await usuarios.criar(process.env.ADMIN_NOME || 'Administrador', adminEmail, auth.hashSenha(adminSenha), 'adm');
      console.log(`[AUTH] Administrador inicial criado: ${adminEmail}`);
    }
  } else if ((await usuarios.contar()) === 0) {
    console.warn('[AUTH] Nenhum usuario e nenhuma variavel ADMIN_EMAIL/ADMIN_SENHA definida. Defina-as para criar o primeiro acesso.');
  }

  // cada requisicao roda num contexto proprio (usuario/modulo nao se misturam entre pessoas)
  http.createServer((req, res) => views.contexto.run({ usuario: null, modulo: 'cotacao' }, () => handler(req, res))).listen(PORT, () => {
    console.log(`\nServidor rodando em ${BASE_URL}`);
    console.log(`Modo de e-mail: ${mailMode.toUpperCase()}${mailMode === 'mock' ? ' (simulado — links aparecem no log)' : ''}\n`);
  });
}

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
