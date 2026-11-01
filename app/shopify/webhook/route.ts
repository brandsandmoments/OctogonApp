import { codDupaDomeniu, hmacWebhookValid, primesteWebhook } from '../../lib/shopify';

/**
 * Webhook-urile Shopify: comenzi noi sau schimbate, stoc mișcat, produse, dezinstalare
 * și cererile de confidențialitate (customers/data_request, customers/redact,
 * shop/redact). Doar cu semnătura secretului aplicației; altfel 401, fără nimic scris.
 */
export async function POST(req: Request) {
  const corp = await req.text();
  const domeniu = req.headers.get('x-shopify-shop-domain') ?? '';
  // Secretul e al aplicației magazinului: întâi aflăm magazinul, apoi verificăm semnătura.
  const cod = await codDupaDomeniu(domeniu);
  if (!cod || !hmacWebhookValid(corp, req.headers.get('x-shopify-hmac-sha256'), cod)) return new Response('Semnătură greșită', { status: 401 });
  const subiect = req.headers.get('x-shopify-topic') ?? '';
  try {
    await primesteWebhook(domeniu, subiect, JSON.parse(corp || '{}'));
  } catch (e) {
    // 500: Shopify reîncearcă webhook-ul mai târziu; sincronizarea de noapte prinde oricum restul.
    console.error(`webhook ${subiect} ${domeniu}:`, e);
    return new Response('Eroare', { status: 500 });
  }
  return new Response('ok');
}
