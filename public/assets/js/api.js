/* =========================================================
   Hubble Brasil — ponte com o backend (/api/public/*).
   - fetch com timeout (mesma origem, JSON)
   - UTMs da 1ª visita com UTM + id de sessão (localStorage)
   - funil (visitas/produto/checkout) para o /admin
   - Pixel do Meta (ID vindo de /api/public/settings) + espelho na API de Conversões
   Exposto em window.HBAPI. Carregar em toda página DEPOIS de app.js.
   ========================================================= */
(function(){
'use strict';
const LS = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, v); }catch(e){} }
};
const SS = {
  get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ sessionStorage.setItem(k, v); }catch(e){} }
};

/* ---------- HTTP ---------- */
async function request(method, path, body, timeoutMs, keepalive){
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 20000) : null;
  try{
    const res = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? {'Content-Type':'application/json', 'Accept':'application/json'} : {'Accept':'application/json'},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive: !!keepalive,
      signal: ctrl ? ctrl.signal : undefined
    });
    let data = null; try{ data = await res.json(); }catch(e){}
    if(!res.ok || !data || data.ok === false){
      return {ok:false, status:res.status, data, error:(data && data.error) || (res.status >= 500 ? 'Serviço indisponível no momento. Tente novamente em instantes.' : 'Não foi possível concluir. Tente novamente.')};
    }
    return {ok:true, status:res.status, data};
  }catch(e){
    return {ok:false, status:0, data:null, error:'Sem conexão com o servidor. Verifique sua internet e tente novamente.'};
  }finally{ if(t) clearTimeout(t); }
}
const get = (path, timeoutMs) => request('GET', path, undefined, timeoutMs);
const post = (path, body, timeoutMs, keepalive) => request('POST', path, body, timeoutMs, keepalive);
/** Envio "dispare e esqueça" que não é cancelado quando a página troca (keepalive). */
const beacon = (path, body) => { post(path, body, 8000, true); };

/* ---------- Sessão + UTMs (port de tracking.ts) ---------- */
const SESSION_KEY = 'hubble-br-session', UTM_KEY = 'hubble-br-utms';
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c === 'x' ? r : (r&3|8)).toString(16); });
function sessionId(){
  let id = LS.get(SESSION_KEY);
  if(!id || !/^[\w-]{8,64}$/.test(id)){ id = uuid(); LS.set(SESSION_KEY, id); }
  return id;
}
const UTM_KEYS = ['src','sck','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
/** Guarda as UTMs da última visita que chegou com UTM, para enviá-las na venda. */
function utms(){
  const p = new URLSearchParams(location.search), fromUrl = {};
  UTM_KEYS.forEach(k => { const v = p.get(k); if(v) fromUrl[k] = v.slice(0,300); });
  if(Object.keys(fromUrl).length){ LS.set(UTM_KEY, JSON.stringify(fromUrl)); return fromUrl; }
  try{ return JSON.parse(LS.get(UTM_KEY) || '{}') || {}; }catch(e){ return {}; }
}

/* ---------- Funil (/admin) ---------- */
function track(type, extra){
  const e = extra || {};
  beacon('/api/public/event', {
    sessionId: sessionId(), type, path: location.pathname + location.search.slice(0, 200),
    productId: e.productId, productName: e.productName, value: e.value,
    referrer: document.referrer ? document.referrer.slice(0, 500) : undefined, utm: utms()
  });
}
const sentSteps = new Set();
/** Etapa concluída do checkout (checkouts abandonados). Envia cada etapa uma vez por página. */
function checkoutStep(step, data){
  if(sentSteps.has(step)) return; sentSteps.add(step);
  beacon('/api/public/checkout-step', Object.assign({sessionId: sessionId(), step, utm: utms()}, data || {}));
}

/* ---------- Meta Pixel (port de meta-pixel.ts) ---------- */
let pixelId = null, pixelReady = false, noPixel = false;
const pending = [];
/* Eventos (menos PageView) disparados antes do pixel carregar ficam guardados nesta aba e saem
   quando ele carregar — nesta página ou na próxima. Assim o AddToCart do "Comprar agora", que já
   troca de página para o checkout, não se perde. */
const QKEY = 'hb-meta-queue', QTTL = 30*60*1000;
function readQ(){ try{ return (JSON.parse(SS.get(QKEY) || '[]') || []).filter(e => Date.now() - e.at < QTTL); }catch(e){ return []; } }
function writeQ(q){ try{ if(q.length) sessionStorage.setItem(QKEY, JSON.stringify(q.slice(-20))); else sessionStorage.removeItem(QKEY); }catch(e){} }
function cookie(name){ const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
/** fbc a partir do fbclid da URL quando o cookie ainda não existe. */
function getFbc(){ const c = cookie('_fbc'); if(c) return c; const id = new URLSearchParams(location.search).get('fbclid'); return id ? `fb.1.${Date.now()}.${id}` : null; }
function metaCookies(){ return {fbp: cookie('_fbp'), fbc: getFbc()}; }
function loadPixel(id){
  if(pixelReady || !id) return;
  if(!window.fbq){
    const n = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    window.fbq = n; window._fbq = n;
    const s = document.createElement('script'); s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  window.fbq('init', id);
  pixelId = id; pixelReady = true;
  // PageView desta página primeiro; depois os eventos guardados (desta página ou da anterior).
  const queued = readQ(); writeQ([]);
  pending.splice(0).forEach(fn => fn());
  queued.forEach(sendMeta);
}
/** Evento no navegador + espelho no servidor (CAPI) com o mesmo event_id (deduplicação). */
function sendMeta(ev){
  const d = ev.data || {};
  const custom = d.value !== undefined ? {value: d.value, currency:'BRL', content_name: d.contentName, content_ids: d.contentIds, content_type:'product'} : {};
  // trackSingle: o evento vai só para o pixel da loja, nunca para outro pixel carregado na página
  // (ex.: o que a UTMify inicializa), que de outro modo receberia uma cópia.
  window.fbq('trackSingle', pixelId, ev.eventName, custom, {eventID: ev.eventId});
  const c = metaCookies();
  beacon('/api/public/meta-event', {eventName: ev.eventName, eventId: ev.eventId, url: ev.url, fbp: c.fbp, fbc: c.fbc, value: d.value, contentName: d.contentName, contentIds: d.contentIds});
}
function metaTrack(eventName, data){
  if(noPixel) return;
  const ev = {eventName, data: data || {}, eventId: `${eventName}-${uuid()}`, url: location.href.slice(0, 1000), at: Date.now()};
  if(pixelReady) return sendMeta(ev);
  if(eventName === 'PageView'){ pending.push(() => sendMeta(ev)); return; }
  const q = readQ(); q.push(ev); writeQ(q);
}
/** Mesmo evento uma vez só nesta aba para a mesma chave (ex.: recarregar o checkout não repete). */
function metaOnce(key, eventName, data){
  const k = 'hb-meta-once:' + eventName + ':' + key;
  if(SS.get(k)) return;
  SS.set(k, '1');
  metaTrack(eventName, data);
}
/** Purchase no navegador com o mesmo event_id usado no servidor (purchase-<orderId>).
 *  Uma vez por pedido neste navegador: recarregar a página do pedido/obrigado não reenvia. */
function metaPurchase(orderId, value, contentName){
  if(noPixel) return;
  if(!pixelReady){ pending.push(() => metaPurchase(orderId, value, contentName)); return; }
  const k = 'hb-meta-purchase:' + orderId;
  if(LS.get(k)) return;
  LS.set(k, '1');
  window.fbq('trackSingle', pixelId, 'Purchase', {value, currency:'BRL', content_name: contentName, content_type:'product'}, {eventID: `purchase-${orderId}`});
}
/** Assinatura do carrinho atual (para eventos de checkout uma vez por carrinho). */
const cartKey = () => ((window.HB && HB.cart && HB.cart.items()) || []).map(i => `${i.id}:${i.qty}:${i.price}`).join('|').slice(0, 300);
async function settings(){
  const cached = SS.get('hubble-br-settings');
  if(cached){ try{ return JSON.parse(cached); }catch(e){} }
  const r = await get('/api/public/settings', 8000);
  if(r.ok){ if(r.data && r.data.metaPixelId) SS.set('hubble-br-settings', JSON.stringify(r.data)); return r.data; }
  return {};
}

/* ---------- Carrinho → itens da API ---------- */
/** Converte HB.cart.items() no formato validado pelo servidor (sem preços: o servidor calcula). */
function cartItems(items){
  return (items || []).map(it => {
    const d = it.details || {}, qty = Math.max(1, Math.min(10, +it.qty || 1));
    if(it.kind === 'lente'){
      const months = d.months || (String(d.plan||'').match(/\d+/) || [1])[0];
      const eye = e => e && e.kind && e.sph !== '' && e.sph != null ? {kind: e.kind, sph: String(e.sph)} : null;
      return {kind:'lente', id: it.id, planId: `${months}m`, od: eye(d.od), oe: eye(d.oe), qty};
    }
    if(it.kind === 'oculos'){
      const eye = e => e ? {sph: String(e.sph ?? ''), cyl: e.cyl != null ? String(e.cyl) : null, axis: e.axis != null ? String(e.axis) : null} : null;
      const o = {kind:'oculos', id: it.id, tipo: d.tipo === 'sol' ? 'sol' : 'grau', color: d.color, uso: d.uso || 'sem-grau',
        lente: d.lente || 'policarbonato', filtroAzul: !!d.filtroAzul, rx: d.rx || null, qty};
      if(d.leitura) o.leitura = String(d.leitura);
      if(d.od) o.od = eye(d.od);
      if(d.oe) o.oe = eye(d.oe);
      if(d.dp) o.dp = String(d.dp);
      return o;
    }
    return {kind:'acessorio', id: it.id, qty};
  });
}

/** Senha do /admin salva nesta aba (login no admin): libera o cartão para teste mesmo desligado. */
const adminPassword = () => SS.get('hubble_admin_pwd') || undefined;

/** POST /api/public/checkout com UTMs, sessão e cookies do Meta. */
function checkout(body){
  const c = metaCookies();
  return post('/api/public/checkout', Object.assign({}, body, {utm: utms(), sessionId: sessionId(), fbp: c.fbp, fbc: c.fbc, url: location.href.slice(0, 1000), adminPassword: adminPassword()}), 45000);
}
/** Cartão (HyperCash) disponível no checkout + chave pública do SDK. */
const cardConfig = () => post('/api/public/card-config', {adminPassword: adminPassword()}, 10000);
/** Ofertas pós-compra do pedido (preços do servidor) e cobrança da etapa escolhida. */
const upsellOffers = id => get('/api/public/upsell?' + new URLSearchParams({id}).toString(), 15000);
const upsell = body => post('/api/public/upsell', Object.assign({}, body, {adminPassword: adminPassword()}), 45000);
/**
 * Fluxo pós-compra desta aba (sessionStorage — nunca vai para o servidor): etapa atual
 * (offers → express → done) e, na compra no cartão, o token do cartão gerado pelo SDK
 * (expira em ~15 min) para cobrar as ofertas no mesmo cartão com um clique.
 */
const flow = {
  get(id){ try{ return JSON.parse(SS.get('hb-flow:' + id) || 'null'); }catch(e){ return null; } },
  set(id, patch){ const cur = Object.assign(flow.get(id) || {}, patch); SS.set('hb-flow:' + id, JSON.stringify(cur)); return cur; }
};
/** GET /api/public/order — status do pedido (repassa fbp/fbc para o Purchase do servidor). */
function order(id){
  const c = metaCookies(), q = new URLSearchParams({id});
  if(c.fbp) q.set('fbp', c.fbp); if(c.fbc) q.set('fbc', c.fbc);
  return get('/api/public/order?' + q.toString(), 15000);
}
const rastreio = (pedido, cpf) => get('/api/public/rastreio?' + new URLSearchParams({pedido, cpf}).toString(), 15000);

window.HBAPI = {get, post, sessionId, utms, track, checkoutStep, metaTrack, metaOnce, cartKey, metaPurchase, metaCookies, cartItems, checkout, cardConfig, upsellOffers, upsell, flow, order, rastreio};

/* ---------- Pixel da UTMify (todas as páginas da loja) ---------- */
(function utmifyPixel(){
  if(document.querySelector('script[src*="cdn.utmify.com.br/scripts/pixel/pixel.js"]')) return; // nunca carrega duplicado
  window.pixelId = '6ac5b73aa1f25dc60b97fbf0';
  const s = document.createElement('script');
  s.src = 'https://cdn.utmify.com.br/scripts/pixel/pixel.js';
  s.async = true; s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();

/* ---------- Inicialização por página ---------- */
const page =(location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
utms(); // captura as UTMs já na entrada
track('page_view');
const qsId = new URLSearchParams(location.search).get('id');
if(page === 'lente' || page === 'oculos-produto' || page === 'acessorio'){
  const HB = window.HB || {}, f = HB.find || {};
  const p = page === 'lente' ? (f.lens && f.lens(qsId)) : page === 'acessorio' ? (f.accessory && f.accessory(qsId)) : (f.glasses && f.glasses(qsId));
  if(p) track('product_view', {productId: p.id, productName: p.name});
}
settings().then(s => {
  if(s && s.metaPixelId) loadPixel(String(s.metaPixelId));
  else if(s && s.ok){ noPixel = true; pending.length = 0; writeQ([]); } // loja sem pixel do Meta
});
metaTrack('PageView');
if(page === 'lente'){
  const l = window.HB && HB.find && HB.find.lens(qsId);
  if(l) metaTrack('ViewContent', {value: (l.packs && l.packs[0] && (l.packs[0].total || l.packs[0].sale)) || undefined, contentName: l.name, contentIds: [l.id]});
}
/* AddToCart: envolve HB.cart.add (vale para lente, óculos e acessórios) */
if(window.HB && HB.cart && !HB.cart._metaWrapped){
  const add = HB.cart.add.bind(HB.cart);
  HB.cart.add = function(item){
    const r = add(item);
    try{ metaTrack('AddToCart', {value: +(item.price * (item.qty || 1)).toFixed(2), contentName: item.name, contentIds: [item.id]}); }catch(e){}
    return r;
  };
  HB.cart._metaWrapped = true;
}
if(page === 'checkout' && window.HB && HB.cart && HB.cart.items().length){
  track('checkout_click', {value: HB.cart.subtotal()});
  // Uma vez por carrinho nesta aba (recarregar ou voltar ao checkout não conta outro início).
  metaOnce(cartKey(), 'InitiateCheckout', {value: +HB.cart.subtotal().toFixed(2), contentIds: HB.cart.items().map(i => i.id)});
}
})();
