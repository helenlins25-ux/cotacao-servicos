// Upload de arquivos para o Supabase Storage via API HTTP (sem dependencias).
// Usa SUPABASE_URL + SUPABASE_SERVICE_KEY (service_role) e o bucket "comprovantes".
const BUCKET = process.env.SUPABASE_BUCKET || 'comprovantes';

export const storageConfigurado = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

// Envia um arquivo (Buffer) e retorna a URL publica.
// nome: caminho/arquivo dentro do bucket (ex: "cotacao-5/comprovante-123.jpg")
export async function enviarArquivo(nome, buffer, contentType) {
  const base = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  const url = `${base}/storage/v1/object/${BUCKET}/${encodeURI(nome)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Supabase Storage ${resp.status}: ${txt.slice(0, 300)}`);
  }
  // URL publica (bucket precisa estar marcado como "Public")
  return `${base}/storage/v1/object/public/${BUCKET}/${encodeURI(nome)}`;
}

// Extensao a partir do content-type (para nomear o arquivo)
export function extDeTipo(contentType) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf',
  };
  return map[contentType] || 'bin';
}
