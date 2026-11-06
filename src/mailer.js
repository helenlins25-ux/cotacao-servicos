// Modulo de envio de e-mail SEM dependencias externas.
// - MAIL_MODE=mock  -> apenas imprime no log (ideal para testes)
// - MAIL_MODE=smtp  -> envia via SMTP usando net/tls nativos do Node
import net from 'node:net';
import tls from 'node:tls';

export const mailMode = process.env.MAIL_MODE || 'mock';

export async function enviarEmail({ to, subject, html, text }) {
  if (mailMode === 'mock') {
    console.log('\n==================== E-MAIL (SIMULADO) ====================');
    console.log('Para:    ', to);
    console.log('Assunto: ', subject);
    console.log('-----------------------------------------------------------');
    console.log(text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('===========================================================\n');
    return { mocked: true };
  }
  return enviarViaSmtp({ to, subject, html, text });
}

// --- Cliente SMTP minimalista (AUTH LOGIN + STARTTLS opcional) ---
function enviarViaSmtp({ to, subject, html, text }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || user;
  const secure = String(process.env.SMTP_SECURE) === 'true'; // true => TLS direto (porta 465)

  return new Promise((resolve, reject) => {
    let socket = secure
      ? tls.connect({ host, port })
      : net.connect({ host, port });

    let buffer = '';
    const fila = [];
    let etapa = 0;
    let upgraded = false;

    const comandos = [
      `EHLO cotacao-app`,
      `STARTTLS`,
      `EHLO cotacao-app`,
      `AUTH LOGIN`,
      Buffer.from(user).toString('base64'),
      Buffer.from(pass).toString('base64'),
      `MAIL FROM:<${extrairEmail(from)}>`,
      `RCPT TO:<${to}>`,
      `DATA`,
      montarMensagem({ from, to, subject, html, text }),
      `QUIT`,
    ];

    function escrever(cmd) {
      socket.write(cmd + '\r\n');
    }

    function proximo() {
      if (secure && (etapa === 1 || etapa === 2)) etapa = 3; // pula STARTTLS se ja seguro
      if (etapa >= comandos.length) return;
      const cmd = comandos[etapa++];
      escrever(cmd);
      if (!secure && cmd === 'STARTTLS') {
        // aguarda resposta 220 antes do upgrade (tratado em onData)
      }
    }

    function onData(data) {
      buffer += data.toString();
      const linhas = buffer.split('\r\n');
      buffer = linhas.pop();
      for (const linha of linhas) {
        if (!linha) continue;
        const code = Number(linha.slice(0, 3));
        if (code >= 400) {
          socket.destroy();
          return reject(new Error(`SMTP erro: ${linha}`));
        }
        // se acabamos de enviar STARTTLS e recebemos 220, fazemos upgrade TLS
        if (!secure && !upgraded && comandos[etapa - 1] === 'STARTTLS' && code === 220) {
          upgraded = true;
          const plain = socket;
          socket = tls.connect({ socket: plain, servername: host }, () => {
            proximo(); // envia EHLO novamente sobre TLS
          });
          socket.on('data', onData);
          socket.on('error', reject);
          continue;
        }
        if (code === 221) {
          socket.end();
          return resolve({ ok: true });
        }
        // avança para o proximo comando
        proximo();
      }
    }

    socket.on('connect', () => {}); // aguarda saudacao 220 do servidor via onData
    socket.on('secureConnect', () => {}); // idem para conexao direta TLS
    socket.on('data', onData);
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.setTimeout(12000);

    // timeout global: se nada resolver em 15s, desiste (evita travar a requisicao)
    const prazoGlobal = setTimeout(() => {
      try { socket.destroy(); } catch {}
      reject(new Error('SMTP timeout global (servidor inacessivel)'));
    }, 15000);
    const limpar = () => clearTimeout(prazoGlobal);
    socket.on('close', limpar);
    // a primeira acao (EHLO) sera disparada ao receber a saudacao 220 inicial
    // mas como o primeiro onData dispara proximo(), nao enviamos nada aqui.
  });
}

function extrairEmail(s) {
  const m = s.match(/<([^>]+)>/);
  return m ? m[1] : s;
}

function montarMensagem({ from, to, subject, html, text }) {
  const boundary = 'bnd_' + Math.random().toString(36).slice(2);
  const linhas = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    text || '',
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html || '',
    `--${boundary}--`,
    `.`,
  ];
  return linhas.join('\r\n');
}
