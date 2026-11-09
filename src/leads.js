// Regras de negocio do modulo LEADS: funil, painel e follow-ups.
import { leads } from './db.js';
import { COMERCIAIS, carregarCotacoesProcessadas } from './negocio.js';

export const ETAPAS = [
  { id: 'novo', nome: 'Novo' },
  { id: 'em_contato', nome: 'Em contato' },
  { id: 'proposta', nome: 'Proposta enviada' },
  { id: 'negociacao', nome: 'Negociação' },
  { id: 'ganho', nome: 'Ganho' },
  { id: 'perdido', nome: 'Perdido' },
];
export const ETAPAS_FINAIS = ['ganho', 'perdido'];
export const nomeEtapa = (id) => ETAPAS.find((e) => e.id === id)?.nome || id;
export const etapaValida = (id) => ETAPAS.some((e) => e.id === id);

export const ORIGENS = ['Indicação', 'Site', 'WhatsApp', 'Ligação', 'E-mail', 'Redes sociais', 'Evento', 'Outro'];
export const TIPOS_CONTATO = ['Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Visita', 'Outro'];

// "YYYY-MM-DD" a partir de string (SQLite) ou Date (Postgres)
export const isoDia = (d) => {
  if (!d) return null;
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// Data de hoje (YYYY-MM-DD) no fuso da empresa
export const hojeISO = (tzOffsetHoras = -3) =>
  new Date(Date.now() + tzOffsetHoras * 3600 * 1000).toISOString().slice(0, 10);

// Um lead esta "atrasado" se tem proximo contato no passado e ainda nao foi encerrado.
export function statusFollowUp(lead, hoje) {
  if (ETAPAS_FINAIS.includes(lead.etapa)) return 'encerrado';
  const prox = isoDia(lead.proximo_contato);
  if (!prox) return 'sem_data';
  if (prox < hoje) return 'atrasado';
  if (prox === hoje) return 'hoje';
  return 'futuro';
}

// Dados do painel (dashboard) do modulo Leads.
export async function calcularPainelLeads(tzOffsetHoras = -3) {
  const lista = await leads.listar();
  const hoje = hojeISO(tzOffsetHoras);

  const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e.id, 0]));
  for (const l of lista) porEtapa[l.etapa] = (porEtapa[l.etapa] || 0) + 1;

  const ganhos = porEtapa.ganho || 0;
  const perdidos = porEtapa.perdido || 0;
  const emAberto = lista.length - ganhos - perdidos;
  const conversao = lista.length ? (ganhos / lista.length) * 100 : 0;

  const atrasados = [];
  const paraHoje = [];
  for (const l of lista) {
    const s = statusFollowUp(l, hoje);
    if (s === 'atrasado') atrasados.push(l);
    else if (s === 'hoje') paraHoje.push(l);
  }
  const porData = (a, b) => (isoDia(a.proximo_contato) || '').localeCompare(isoDia(b.proximo_contato) || '');
  atrasados.sort(porData);
  paraHoje.sort(porData);

  // ----- Vinculo Lead x Cotacao -----
  // "Fechando negocio" = lead com pelo menos uma cotacao FECHADA (parceiro vencedor definido).
  const cotsVinculadas = (await carregarCotacoesProcessadas()).filter((c) => c.lead_id != null);
  const cotsPorLead = new Map();
  for (const c of cotsVinculadas) {
    const k = Number(c.lead_id);
    if (!cotsPorLead.has(k)) cotsPorLead.set(k, []);
    cotsPorLead.get(k).push(c);
  }

  const novoComercial = () => ({ total: 0, emAberto: 0, ganhos: 0, perdidos: 0, comCotacao: 0, comNegocio: 0 });
  const porComercial = {};
  for (const nome of COMERCIAIS) porComercial[nome] = novoComercial();

  const vinculo = { leadsComCotacao: 0, leadsComNegocio: 0, cotacoes: 0, cotacoesFechadas: 0, faturamento: 0, liquido: 0, leadsFechados: [] };
  for (const l of lista) {
    const m = (porComercial[l.comercial] ||= novoComercial());
    m.total++;
    if (l.etapa === 'ganho') m.ganhos++;
    else if (l.etapa === 'perdido') m.perdidos++;
    else m.emAberto++;

    const cs = cotsPorLead.get(Number(l.id)) || [];
    if (cs.length) {
      vinculo.leadsComCotacao++; m.comCotacao++;
      vinculo.cotacoes += cs.length;
      const fechadas = cs.filter((c) => c.status === 'fechada');
      if (fechadas.length) {
        vinculo.leadsComNegocio++; m.comNegocio++;
        vinculo.cotacoesFechadas += fechadas.length;
        const fat = fechadas.reduce((s, c) => s + c.faturamento, 0);
        const liq = fechadas.reduce((s, c) => s + c.faturamento - Number(c.bonificacao || 0), 0);
        vinculo.faturamento += fat;
        vinculo.liquido += liq;
        vinculo.leadsFechados.push({ lead: l, cotacoes: cs.length, fechadas: fechadas.length, faturamento: fat });
      }
    }
  }
  vinculo.leadsFechados.sort((a, b) => b.faturamento - a.faturamento);
  vinculo.pctComCotacao = lista.length ? (vinculo.leadsComCotacao / lista.length) * 100 : 0;
  vinculo.pctNegocio = lista.length ? (vinculo.leadsComNegocio / lista.length) * 100 : 0;

  for (const m of Object.values(porComercial)) m.conversao = m.total ? (m.ganhos / m.total) * 100 : 0;

  return { total: lista.length, porEtapa, emAberto, ganhos, perdidos, conversao, atrasados, paraHoje, porComercial, hoje, vinculo };
}
