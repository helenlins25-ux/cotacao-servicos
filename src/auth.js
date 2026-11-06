// Autenticacao: hash de senha (scrypt nativo) e sessoes em memoria.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------- Hash de senha (scrypt, sem dependencias) ----------
export function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const derivado = scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${derivado}`;
}

export function verificarSenha(senha, hashArmazenado) {
  try {
    const [salt, derivadoHex] = String(hashArmazenado).split(':');
    if (!salt || !derivadoHex) return false;
    const derivado = Buffer.from(derivadoHex, 'hex');
    const teste = scryptSync(String(senha), salt, 64);
    return derivado.length === teste.length && timingSafeEqual(derivado, teste);
  } catch {
    return false;
  }
}

// ---------- Sessoes (em memoria) ----------
// Mapa: sessionId -> { usuarioId, nome, email, perfil, expira }
const sessoes = new Map();
const DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

export function criarSessao(usuario) {
  const sid = randomBytes(24).toString('hex');
  sessoes.set(sid, {
    usuarioId: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    expira: Date.now() + DURACAO_MS,
  });
  return sid;
}

export function obterSessao(sid) {
  if (!sid) return null;
  const s = sessoes.get(sid);
  if (!s) return null;
  if (s.expira < Date.now()) { sessoes.delete(sid); return null; }
  return s;
}

export function destruirSessao(sid) {
  if (sid) sessoes.delete(sid);
}

// ---------- Helpers de cookie ----------
export function lerCookie(req, nome) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieSessao(sid) {
  // HttpOnly (JS do navegador nao le), SameSite=Lax, 12h. Secure fica a cargo do proxy HTTPS.
  const maxAge = Math.floor(DURACAO_MS / 1000);
  return `sid=${sid}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function cookieLimpar() {
  return 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}
