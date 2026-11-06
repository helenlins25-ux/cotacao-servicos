// Regras de negocio: status, fechamento automatico, faturamento, dashboard.
import { parceiros, cotacoes, convites } from './db.js';

export const COMERCIAIS = ['Carlos', 'Everton', 'Tiago'];
export const PERC_FIXO = 0.02; // 2% sobre o valor do frete vencedor

export function expirada(cotacao) {
  return new Date(cotacao.prazo_resposta) < new Date();
}

// Determina o status de uma cotacao a partir dos seus dados + convites.
//  - 'fechada'     : ja tem fechado_em (vencedor definido)
//  - 'em_andamento': ainda no prazo e com >=1 proposta
//  - 'aberta'      : ainda no prazo e sem propostas
//  Quando o prazo expira sem fechamento, deve ser fechada (ver fecharSeVencido).
export function statusDe(cotacao, listaConvites) {
  if (cotacao.fechado_em) return 'fechada';
  const temResposta = listaConvites.some((v) => v.respondido_em);
  if (expirada(cotacao)) {
    // expirou: sera fechada (se houver proposta) na proxima carga; aqui rotulamos
    return temResposta ? 'fechada' : 'encerrada_sem_proposta';
  }
  return temResposta ? 'em_andamento' : 'aberta';
}

// Faturamento de uma cotacao fechada = 2% do valor fechado + comissao variavel.
export function faturamentoDe(cotacao) {
  if (!cotacao.fechado_em || cotacao.valor_fechado == null) return 0;
  const fixo = Number(cotacao.valor_fechado) * PERC_FIXO;
  const comissao = Number(cotacao.comissao_variavel || 0);
  return fixo + comissao;
}

// Fecha automaticamente a cotacao pelo MENOR valor, se o prazo venceu e ainda
// nao foi fechada. Retorna a cotacao (possivelmente atualizada).
export async function fecharSeVencido(cotacao) {
  if (cotacao.fechado_em) return cotacao;          // ja fechada
  if (!expirada(cotacao)) return cotacao;          // ainda no prazo

  const convs = await convites.porCotacao(cotacao.id);
  const respostas = convs
    .filter((v) => v.respondido_em && v.valor_cotado != null)
    .sort((a, b) => Number(a.valor_cotado) - Number(b.valor_cotado));

  if (respostas.length === 0) return cotacao;      // expirou sem propostas -> nao fecha

  const vencedor = respostas[0];                   // menor valor
  return await cotacoes.fechar(cotacao.id, {
    parceiro_vencedor: vencedor.parceiro_id,
    valor_fechado: Number(vencedor.valor_cotado),
    comissao_variavel: cotacao.comissao_variavel || 0,
  });
}

// Processa todas as cotacoes vencidas (fecha as que precisam) e retorna a lista
// com status e faturamento calculados. Usado na home e no dashboard.
export async function carregarCotacoesProcessadas() {
  let lista = await cotacoes.listar();
  const resultado = [];
  for (let c of lista) {
    c = await fecharSeVencido(c);
    const convs = await convites.porCotacao(c.id);
    resultado.push({
      ...c,
      _convites: convs,
      status: statusDe(c, convs),
      convidados: convs.length,
      respondidas: convs.filter((v) => v.respondido_em).length,
      faturamento: faturamentoDe(c),
    });
  }
  return resultado;
}

// Monta os indicadores do dashboard.
export async function calcularDashboard() {
  const lista = await carregarCotacoesProcessadas();
  const todosParceiros = await parceiros.listar();
  const nomeParceiro = (id) => todosParceiros.find((p) => p.id === id)?.nome || '—';

  const contagem = { aberta: 0, em_andamento: 0, fechada: 0, encerrada_sem_proposta: 0 };
  for (const c of lista) contagem[c.status] = (contagem[c.status] || 0) + 1;

  // Tempo medio de resposta (em horas): media de (respondido_em - criado da cotacao)
  let somaHoras = 0, qtdRespostas = 0;
  for (const c of lista) {
    for (const v of c._convites) {
      if (v.respondido_em) {
        const base = new Date(c.criado_em).getTime();
        const resp = new Date(v.respondido_em).getTime();
        const horas = (resp - base) / 36e5;
        if (horas >= 0) { somaHoras += horas; qtdRespostas++; }
      }
    }
  }
  const tempoMedioHoras = qtdRespostas ? somaHoras / qtdRespostas : 0;

  // Parceiro com mais fechamentos (vitorias)
  const fechamentosPorParceiro = {};
  let faturamentoTotal = 0;
  for (const c of lista) {
    if (c.status === 'fechada' && c.parceiro_vencedor) {
      fechamentosPorParceiro[c.parceiro_vencedor] = (fechamentosPorParceiro[c.parceiro_vencedor] || 0) + 1;
      faturamentoTotal += c.faturamento;
    }
  }
  let parceiroTop = null, maxFech = 0;
  for (const [pid, n] of Object.entries(fechamentosPorParceiro)) {
    if (n > maxFech) { maxFech = n; parceiroTop = Number(pid); }
  }

  // Metricas por comercial
  const porComercial = {};
  for (const nome of COMERCIAIS) porComercial[nome] = { total: 0, fechadas: 0, faturamento: 0 };
  for (const c of lista) {
    const com = c.comercial;
    if (!porComercial[com]) porComercial[com] = { total: 0, fechadas: 0, faturamento: 0 };
    porComercial[com].total++;
    if (c.status === 'fechada') {
      porComercial[com].fechadas++;
      porComercial[com].faturamento += c.faturamento;
    }
  }

  return {
    total: lista.length,
    contagem,
    tempoMedioHoras,
    qtdRespostas,
    parceiroTop: parceiroTop ? { nome: nomeParceiro(parceiroTop), fechamentos: maxFech } : null,
    faturamentoTotal,
    porComercial,
    lista,
  };
}
