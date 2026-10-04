/* =========================================================
   Hubble Brasil — núcleo compartilhado (header, footer, carrinho,
   conta, busca, utilitários). Exposto em window.HB.
   ========================================================= */
(function(){
const D = window.HB_DATA || {lenses:[],glasses:[],accessories:[],prices:{glasses:274.90,sunglasses:329.90}};
/* Lentes à venda no momento (as demais ficam ocultas no site). */
const ACTIVE_LENSES = ['skyhy'];
D.allLenses = D.lenses; D.lenses = D.lenses.filter(l => ACTIVE_LENSES.includes(l.id));
const $ = (s,r=document) => r.querySelector(s);
const $$ = (s,r=document) => [...r.querySelectorAll(s)];
const store = {
  get(k,def){ try{ const v = localStorage.getItem('hubble-br-'+k); return v ? JSON.parse(v) : def; }catch(e){ return def; } },
  set(k,v){ try{ localStorage.setItem('hubble-br-'+k, JSON.stringify(v)); }catch(e){} }
};
const brl = v => (+v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img = (u,w=600) => !u ? '' : (u.includes('ctfassets.net') ? `${u.split('?')[0]}?w=${w}&q=80&fm=webp` : u);
const qs = k => new URLSearchParams(location.search).get(k);
const sup = s => esc(s).replace(/®/g,'<sup>®</sup>');
const TYPE_LABEL = {diaria:'Diária', semanal:'Quinzenal', mensal:'Mensal'};
const PIX_OFF = 0, MIN_INST = 30, MAX_INST = 12;
const installments = total => { const n = Math.max(1, Math.min(MAX_INST, Math.floor(total / MIN_INST))); return {n, value: total / n}; };

/* ---------- Ícones ---------- */
const ICON = {
  menu:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 5h16M2 10h16M2 15h16"/></svg>',
  user:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="6.5" r="3.5"/><path d="M3 18c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  bag:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h12l-1 11H5z"/><path d="M7 7V5.5a3 3 0 0 1 6 0V7"/></svg>',
  search:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>',
  prev:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7.5 2 3.5 6l4 4"/></svg>',
  next:'<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 2l4 4-4 4"/></svg>',
  flag:'<svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="11" fill="#009c3b"/><path d="M11 3.5 19 11l-8 7.5L3 11z" fill="#ffdf00"/><circle cx="11" cy="11" r="4" fill="#002776"/><path d="M7.2 10.2c2.6-.5 5.4 0 7.6 1.4" stroke="#fff" stroke-width=".8" fill="none"/></svg>',
  logo:'<svg viewBox="0 0 97 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M61.137 2.096a2.09 2.09 0 0 1-2.082 2.097 2.09 2.09 0 0 1-2.082-2.097A2.09 2.09 0 0 1 59.055 0a2.09 2.09 0 0 1 2.082 2.096zM8.834 17.963H2.587v-5.26H0v13.06h2.587v-5.375h6.247v5.374h2.587V12.698H8.834v5.265zM24.252 25.997c3.302 0 5.59-1.839 5.59-5.449v-7.846h-2.595v7.717c0 2.147-1.204 3.09-2.995 3.09-1.79 0-2.995-.943-2.995-3.09v-7.717h-2.595v7.846c0 3.61 2.288 5.449 5.59 5.449z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M42.39 12.702c3.023 0 4.923 1.13 4.923 3.622 0 1.314-.797 2.37-1.88 2.773 1.184.403 2.16 1.521 2.16 2.93 0 2.51-1.772 3.743-4.884 3.743h-5.617V12.702h5.299zm-2.715 2.296v3.05h2.65c1.29 0 2.288-.27 2.288-1.54 0-1.271-1.018-1.51-2.3-1.51h-2.638zm0 5.339v3.137l2.902.008c1.426 0 2.327-.337 2.327-1.588 0-1.252-.897-1.557-2.327-1.557h-2.901zM64.59 16.324c0-2.492-1.9-3.622-4.921-3.622h-5.3V25.77h5.618c3.112 0 4.883-1.232 4.883-3.743 0-1.409-.975-2.527-2.16-2.93 1.084-.403 1.88-1.459 1.88-2.773zm-7.637 1.725v-3.051h2.638c1.282 0 2.3.239 2.3 1.51 0 1.27-.999 1.54-2.288 1.54h-2.65zm0 5.425v-3.137h2.902c1.43 0 2.327.305 2.327 1.557 0 1.251-.901 1.588-2.327 1.588l-2.902-.008z" fill="currentColor"/><path d="M71.641 25.766V12.702h2.587v10.627h6.86v2.437h-9.447zM87.308 25.766H97V23.38h-7.109v-3.004H96.6v-2.39H89.89v-2.894h7.035v-2.39h-9.618v13.064zM24.256 40a2.853 2.853 0 0 0 2.843-2.863 2.853 2.853 0 0 0-2.843-2.863 2.853 2.853 0 0 0-2.844 2.863A2.853 2.853 0 0 0 24.256 40z" fill="currentColor"/></svg>',
  help:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/><path d="M10 9a2 2 0 1 1 2.6 1.9c-.4.1-.6.5-.6.9v.2" stroke-linecap="round"/><circle cx="12" cy="14" r=".5" fill="#fff"/></svg>',
  ig:'<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM21.9 7c-.1-1.6-.4-3-1.6-4.2S17.6 1.2 16 1.1C14.3 1 9.7 1 8 1.1 6.4 1.2 5 1.5 3.8 2.7S2.2 5.4 2.1 7C2 8.7 2 13.3 2.1 15c.1 1.6.4 3 1.6 4.2s2.6 1.6 4.2 1.7c1.7.1 6.3.1 8 0 1.6-.1 3-.4 4.2-1.7 1.2-1.2 1.6-2.6 1.7-4.2.1-1.7.1-6.3.1-8zm-2.4 10.6a3.3 3.3 0 0 1-1.8 1.8c-1.3.5-4.3.4-5.7.4s-4.4.1-5.7-.4a3.3 3.3 0 0 1-1.8-1.8c-.5-1.3-.4-4.3-.4-5.7s-.1-4.4.4-5.7a3.3 3.3 0 0 1 1.8-1.8C7.6 3.9 10.6 4 12 4s4.4-.1 5.7.4a3.3 3.3 0 0 1 1.8 1.8c.5 1.3.4 4.3.4 5.7s.1 4.4-.4 5.7z"/></svg>',
  fb:'<svg viewBox="0 0 24 24"><path d="M14 8V6c0-.9.6-1 1-1h3V1h-4c-3.9 0-5 2.9-5 4.8V8H6v4h3v11h5V12h3.6l.4-4z"/></svg>',
  yt:'<svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z"/></svg>'
};

/* ---------- Catálogo ---------- */
const find = {
  lens: id => D.lenses.find(l => l.id === id),
  glasses: id => D.glasses.find(g => g.id === id),
  accessory: id => D.accessories.find(a => a.id === id)
};
const url = {
  lens: l => `lente.html?id=${encodeURIComponent(l.id)}`,
  glasses: (g, sun, color) => `oculos-produto.html?id=${encodeURIComponent(g.id)}${sun?'&tipo=sol':''}${color?'&cor='+encodeURIComponent(color):''}`,
  accessory: a => `acessorio.html?id=${encodeURIComponent(a.id)}`
};

/* ---------- Renderizadores de card ---------- */
const card = {
  hubbleLens(l){
    const p = l.packs[0], pm = Array.isArray(p.perMonth) ? p.perMonth : null;
    if(p.total){
      const last = l.packs[l.packs.length-1];
      return `<a class="lens" href="${url.lens(l)}">
      <div class="tag" style="background:${l.tagColor}">${esc(l.tag)}</div>
      <div class="pic"><img class="main" src="${img(l.image,500)}" alt="${esc(l.name)}" loading="lazy"><img class="alt" src="${img(l.hover,500)}" alt="" loading="lazy"></div>
      <div class="body">
        <div class="sub">${esc(l.sub)}</div>
        <h3>${sup(l.name)}</h3>
        <div class="pk">Planos de ${l.packs.map(x=>x.months).join(', ').replace(/, (\d+)$/,' ou $1')} meses</div>
        <div class="pr"><b>A partir de ${brl(last.perMonth)}/mês</b></div>
        <div class="note">${l.packs.map(x=>`${x.label}: ${brl(x.total)}`).join(' · ')}</div>
      </div></a>`;
    }
    return `<a class="lens" href="${url.lens(l)}">
      <div class="tag" style="background:${l.tagColor}">${esc(l.tag)}</div>
      <div class="pic"><img class="main" src="${img(l.image,500)}" alt="${esc(l.name)}" loading="lazy"><img class="alt" src="${img(l.hover,500)}" alt="" loading="lazy">${l.best?'<span class="best">Melhor<br>Custo</span>':''}</div>
      <div class="body">
        <div class="sub">${esc(l.sub)}</div>
        <h3>${sup(l.name)}</h3>
        <div class="pk">${esc(p.label)}</div>
        <div class="pr"><s>${brl(pm?pm[0]:p.price)}/olho</s><b>${brl(pm?pm[1]:p.sale)}/olho${pm?'*':''}</b></div>
        ${p.off?`<div class="off">${p.off}</div>`:''}${p.note?`<div class="note">${esc(p.note)}</div>`:''}
      </div></a>`;
  },
  brandLens(l){
    const p = l.packs[0];
    return `<a class="prod" href="${url.lens(l)}">
      <div class="pic"><img class="main" src="${img(l.image,500)}" alt="${esc(l.name)}" loading="lazy">${l.hover?`<img class="alt" src="${img(l.hover,500)}" alt="" loading="lazy">`:''}</div>
      <h3>${sup(l.name)}</h3>
      <div class="pk">${esc(p.label)}</div>
      <div class="pr"><s>${brl(p.price)}/olho</s> <b>${brl(p.sale)}/olho</b></div>
      ${p.off?`<div class="off">${p.off}</div>`:''}</a>`;
  },
  lens(l){ return l.kind === 'hubble' ? card.hubbleLens(l) : card.brandLens(l); },
  frame(g, sun){
    const c = g.colors[0], price = sun ? D.prices.sunglasses : D.prices.glasses;
    const life = g.lifestyle && g.lifestyle[0];
    return `<div class="frame ${sun?'sun':''}" data-id="${g.id}">
      <a class="pic" href="${url.glasses(g,sun,c.name)}"><img class="fimg" src="${sun?(c.sunCard||c.card):c.card}" alt="${esc(g.name)}" loading="lazy">${life && !sun?`<img class="life" src="${life}" alt="" loading="lazy">`:''}</a>
      <div class="row"><a href="${url.glasses(g,sun,c.name)}"><h3>${esc(g.name)}</h3></a><span class="price">${brl(price)}</span></div>
      <div class="swatches">${g.colors.map((c,i)=>`<button class="${i?'':'on'}" title="${esc(c.label||c.name)}" data-i="${i}" aria-label="Cor ${esc(c.label||c.name)}"><img src="${img(c.swatch,60)}" alt=""></button>`).join('')}</div>
    </div>`;
  },
  accessory(a){
    return `<a class="prod" href="${url.accessory(a)}">
      <div class="pic"><img class="main" src="${a.image}" alt="${esc(a.name)}" loading="lazy"></div>
      <h3>${sup(a.name)}</h3>
      <div class="pr"><b>${brl(a.price)}</b></div></a>`;
  }
};
/* Liga troca de cor nos cards de armação */
function bindFrameCards(root=document){
  $$('.frame', root).forEach(el => {
    if(el._bound) return; el._bound = true;
    const g = find.glasses(el.dataset.id), sun = el.classList.contains('sun');
    $$('.swatches button', el).forEach(b => b.onclick = e => {
      e.preventDefault();
      const c = g.colors[+b.dataset.i];
      $('.fimg', el).src = sun ? (c.sunCard||c.card) : c.card;
      $$('a', el).forEach(a => a.href = url.glasses(g, sun, c.name));
      $$('.swatches button', el).forEach(x => x.classList.toggle('on', x === b));
    });
  });
}

/* ---------- Carrinho ---------- */
const cart = {
  items(){ return store.get('cart', []); },
  save(list){ store.set('cart', list); renderCartUI(); },
  add(item){
    const list = cart.items();
    item.key = item.key || (Date.now().toString(36) + Math.random().toString(36).slice(2,6));
    item.qty = item.qty || 1;
    const same = list.find(x => x.sig && x.sig === item.sig);
    if(same) same.qty += item.qty; else list.push(item);
    cart.save(list);
    toast(`${item.name} adicionado ao carrinho`);
    return item;
  },
  update(key, patch){ const list = cart.items(); const it = list.find(x => x.key === key); if(it){ Object.assign(it, patch); if(it.qty < 1) return cart.remove(key); } cart.save(list); },
  remove(key){ cart.save(cart.items().filter(x => x.key !== key)); },
  clear(){ cart.save([]); store.set('coupon', null); },
  count(){ return cart.items().reduce((s,x) => s + x.qty, 0); },
  subtotal(){ return cart.items().reduce((s,x) => s + x.price * x.qty, 0); },
  coupon(){ return null; }, // loja sem cupons (ignora cupom salvo de visitas antigas)
  applyCoupon(code){
    const c = String(code||'').trim().toUpperCase();
    const map = {}; // loja sem cupons
    const cp = map[c];
    if(!cp) return {ok:false, msg:'Cupom inválido.'};
    if(cp.min && cart.subtotal() < cp.min) return {ok:false, msg:`Cupom válido para compras acima de ${brl(cp.min)}.`};
    store.set('coupon', cp); renderCartUI(); return {ok:true, msg:`Cupom ${cp.code} aplicado: ${cp.label}.`};
  },
  removeCoupon(){ store.set('coupon', null); renderCartUI(); },
  totals(method){
    const sub = cart.subtotal(), cp = cart.coupon();
    const discount = cp ? +(sub * cp.pct).toFixed(2) : 0;
    const afterCoupon = sub - discount;
    const pix = method === 'pix' ? +(afterCoupon * PIX_OFF).toFixed(2) : 0;
    const total = +(afterCoupon - pix).toFixed(2);
    return {sub, discount, coupon:cp, pix, shipping:0, total, inst: installments(afterCoupon)};
  },
  hasRx(){ return cart.items().some(x => x.kind === 'lente' || (x.kind === 'oculos' && x.details && x.details.uso === 'visao-simples')); }
};

/* ---------- Usuário / pedidos (armazenamento local) ---------- */
const hash = s => { let h = 0; for(const c of String(s)) h = (h*31 + c.charCodeAt(0)) | 0; return 'h' + (h>>>0).toString(36); };
const user = {
  current(){ return store.get('user', null); },
  all(){ return store.get('users', {}); },
  register({name, email, password, phone, cpf}){
    email = String(email||'').trim().toLowerCase();
    const users = user.all();
    if(users[email]) return {ok:false, msg:'Já existe uma conta com este e-mail.'};
    users[email] = {name, email, phone:phone||'', cpf:cpf||'', pass:hash(password), created:Date.now(), addresses:[]};
    store.set('users', users); store.set('user', {name, email});
    return {ok:true};
  },
  login(email, password){
    email = String(email||'').trim().toLowerCase();
    const u = user.all()[email];
    if(!u || u.pass !== hash(password)) return {ok:false, msg:'E-mail ou senha incorretos.'};
    store.set('user', {name:u.name, email}); return {ok:true};
  },
  logout(){ store.set('user', null); },
  profile(){ const c = user.current(); return c ? user.all()[c.email] : null; },
  saveProfile(patch){ const c = user.current(); if(!c) return; const users = user.all(); Object.assign(users[c.email], patch); store.set('users', users); if(patch.name) store.set('user', {...c, name:patch.name}); },
  orders(){ const c = user.current(); return store.get('orders', []).filter(o => !c || o.email === c.email).sort((a,b)=>b.date-a.date); },
  allOrders(){ return store.get('orders', []); },
  saveOrder(o){ const list = store.get('orders', []); const i = list.findIndex(x => x.number === o.number); if(i>=0) list[i] = o; else list.push(o); store.set('orders', list); },
  getOrder(n){ return store.get('orders', []).find(o => o.number === n); }
};

/* ---------- Toast ---------- */
function toast(m){ let t = $('#hb-toast'); if(!t){ t = document.createElement('div'); t.id='hb-toast'; t.className='toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('on'), 2600); }

/* ---------- Header / drawers / footer ---------- */
const NAV = [
  ['Lentes de Contato','lente.html?id=skyhy'],['Óculos de Grau','oculos.html'],['Óculos de Sol','oculos.html?tipo=sol'],['Acessórios','acessorios.html']
];
function headerHTML(){
  return `<header class="hb-header"><div class="nav">
    <div class="nav-l">
      <button class="icon" aria-label="Abrir menu" data-drawer="menu">${ICON.menu}</button>
      <a href="index.html" class="logo" aria-label="Hubble — página inicial">${ICON.logo}</a>
      <nav class="nav-links">${NAV.map(n=>`<a href="${n[1]}">${n[0]}</a>`).join('')}</nav>
    </div>
    <div class="nav-r">
      <a class="icon" aria-label="Minha conta" href="conta.html">${ICON.user}</a>
      <button class="icon" aria-label="Carrinho" data-drawer="cart">${ICON.bag}<span class="cart-n" id="cartN">0</span></button>
      <button class="icon" aria-label="Buscar" data-drawer="busca">${ICON.search}</button>
      <span class="flag" title="Brasil">${ICON.flag}</span>
    </div></div></header>
  <div class="scrim" data-close></div>
  <aside class="drawer left" id="d-menu" aria-label="Menu">
    <div class="drawer-top"><a href="index.html" class="logo" style="width:78px">${ICON.logo}</a><button class="icon" data-close aria-label="Fechar">✕</button></div>
    <h4>Lentes de contato</h4>
    <ul><li><a href="lente.html?id=skyhy">SkyHy by Hubble® Diária</a></li><li><a href="lente.html?id=skyhy">Lentes para miopia</a></li><li><a href="lente.html?id=skyhy">Lentes para hipermetropia</a></li></ul>
    <h4>Óculos</h4>
    <ul><li><a href="oculos.html">Óculos de grau</a></li><li><a href="oculos.html?tipo=sol">Óculos de sol</a></li><li><a href="acessorios.html">Acessórios</a></li></ul>
    <h4>Hubble</h4>
    <ul><li><a href="como-funciona.html">Como funciona</a></li><li><a href="testes-de-visao.html">Testes de visão</a></li><li><a href="sobre.html">Sobre a Hubble</a></li><li><a href="faq.html">Perguntas frequentes</a></li><li><a href="contato.html">Fale conosco</a></li><li><a href="conta.html">Minha conta</a></li></ul>
  </aside>
  <aside class="drawer right" id="d-cart" aria-label="Carrinho"><div class="drawer-top"><strong>Seu carrinho</strong><button class="icon" data-close aria-label="Fechar">✕</button></div><div id="miniCart"></div></aside>
  <aside class="drawer right" id="d-busca" aria-label="Buscar"><div class="drawer-top"><strong>Buscar</strong><button class="icon" data-close aria-label="Fechar">✕</button></div>
    <form action="busca.html"><input class="input" name="q" id="hbQ" placeholder="Buscar lentes, óculos, acessórios…" autocomplete="off"></form>
    <ul id="hbQres" style="margin-top:10px"></ul></aside>`;
}
function footerHTML(){
  const col = (t, links) => `<section><h4>${t}</h4><ul>${links.map(l=>`<li><a href="${l[1]}">${l[0]}</a></li>`).join('')}</ul></section>`;
  return `<footer class="hb-footer"><div class="wrap foot">
    <div style="display:flex;flex-direction:column;justify-content:space-between;gap:40px">
      <div class="news"><h3>Fique por dentro</h3>
        <form id="newsForm"><input type="email" required placeholder="Seu e-mail" aria-label="E-mail"><button>Enviar</button></form>
        <div class="ok" id="newsOk"></div>
        <div class="socials"><a href="https://www.instagram.com/hubblecontacts/" target="_blank" rel="noopener" aria-label="Instagram">${ICON.ig}</a><a href="https://www.facebook.com/hubblecontacts" target="_blank" rel="noopener" aria-label="Facebook">${ICON.fb}</a><a href="https://www.youtube.com/@hubblecontacts" target="_blank" rel="noopener" aria-label="YouTube">${ICON.yt}</a></div>
      </div>
      <div><div class="copy">©${new Date().getFullYear()} Hubble - Todos os direitos reservados</div>
        <div class="legal">Lentes de contato são produtos para a saúde. Use somente com prescrição de um oftalmologista e siga as instruções de uso. Preços e condições válidos para compras no site, sujeitos a alteração.</div></div>
    </div>
    <div class="cols">
      ${col('Comprar',[['Lentes de Contato','lente.html?id=skyhy'],['Óculos de Grau','oculos.html'],['Óculos de Sol','oculos.html?tipo=sol'],['Acessórios','acessorios.html']])}
      ${col('Lentes de Contato',[['SkyHy by Hubble® Diária','lente.html?id=skyhy'],['Lentes para Miopia','lente.html?id=skyhy'],['Lentes para Hipermetropia','lente.html?id=skyhy']])}
      ${col('Comprar por Formato de Armação',[['Ver Todas','oculos.html'],['Armações Quadradas','oculos.html?formato=Quadrado'],['Armações Redondas','oculos.html?formato=Redondo'],['Armações Retangulares','oculos.html?formato=Retangular'],['Armações Gatinho','oculos.html?formato=Gatinho']])}
      ${col('Sobre Nós',[['Sobre a Hubble','sobre.html'],['Política de Privacidade','legal.html?doc=privacidade'],['Termos de Serviço','legal.html?doc=termos'],['Trocas e Devoluções','legal.html?doc=trocas'],['Acessibilidade','legal.html?doc=acessibilidade']])}
      ${col('Recursos',[['Rastrear Pedido','rastreio.html'],['Como Funciona','como-funciona.html'],['Testes de Visão','testes-de-visao.html'],['Perguntas Frequentes','faq.html'],['Minha Conta','conta.html'],['Fale Conosco','contato.html']])}
    </div></div></footer>
  <div class="help-panel" id="helpPanel"><h4>Como podemos ajudar?</h4><p>Nossa equipe responde de segunda a sexta, das 9h às 18h, e aos sábados, das 9h às 13h.</p>
    <a href="como-funciona.html">Como funcionam os planos?</a><a href="conta.html#recomprar">Comprar novamente</a><a href="conta.html#receitas">Atualizar minha receita</a><a href="faq.html">Ver todas as perguntas frequentes</a><a href="contato.html">Falar com a equipe</a></div>
  <button class="help" aria-label="Ajuda" id="helpBtn">${ICON.help}</button>`;
}
function openDrawer(id){ closeDrawers(); document.body.classList.add('d-open'); const d = $('#d-'+id); if(d){ d.classList.add('on'); if(id==='busca') setTimeout(()=>$('#hbQ')&&$('#hbQ').focus(), 280); } }
function closeDrawers(){ document.body.classList.remove('d-open'); $$('.drawer').forEach(d => d.classList.remove('on')); }

function itemMeta(it){ return (it.meta||[]).map(esc).join(' · '); }
function renderCartUI(){
  const n = cart.count(), el = $('#cartN');
  if(el){ el.textContent = n; el.classList.toggle('on', n > 0); }
  const box = $('#miniCart'); if(!box) return;
  const list = cart.items();
  if(!list.length){ box.innerHTML = `<div class="cart-empty">Seu carrinho está vazio.<br><br><a href="lente.html?id=skyhy" class="btn">Comprar Lentes</a><br><br><a href="oculos.html" class="link-u">Ver óculos</a></div>`; return; }
  const t = cart.totals();
  box.innerHTML = list.map(it => `<div class="mini-item"><img src="${img(it.image,200)}" alt=""><div><div class="nm">${sup(it.name)}${it.qty>1?` <span style="color:var(--muted);font-weight:400">× ${it.qty}</span>`:''}</div><div class="meta">${itemMeta(it)}</div><div class="pr">${brl(it.price*it.qty)}</div></div><button class="x" data-rm="${it.key}" aria-label="Remover">×</button></div>`).join('')
    + `<div class="mini-total"><span>Subtotal</span><span>${brl(t.sub - t.discount)}</span></div>
       <div class="mini-note">Frete grátis acima de R$ 100 · pagamento via Pix</div>
       <a href="checkout.html" class="btn block">Finalizar Compra</a><div style="text-align:center;margin-top:12px"><a href="carrinho.html" class="link-u">Ver carrinho</a></div>`;
  $$('[data-rm]', box).forEach(b => b.onclick = () => cart.remove(b.dataset.rm));
}

/* ---------- Busca ---------- */
function searchIndex(){
  return [
    ...D.lenses.map(l => ({t:l.name, s:`Lente ${TYPE_LABEL[l.type]||''}${l.toric?' · Astigmatismo':''} · ${l.brand}`, u:url.lens(l), i:l.image, k:`${l.name} ${l.brand} miopia hipermetropia lente lentes contato ${TYPE_LABEL[l.type]} ${l.toric?'astigmatismo torica tórica':''}`})),
    ...D.glasses.map(g => ({t:`Óculos ${g.name}`, s:`${g.shape} · ${g.size}`, u:url.glasses(g), i:g.colors[0].card, k:`${g.name} oculos óculos grau armacao armação ${g.shape} ${g.size} ${g.colors.map(c=>c.label||c.name).join(' ')}`})),
    ...D.glasses.filter(g=>g.sun).map(g => ({t:`Óculos de Sol ${g.name}`, s:`${g.shape} · Polarizado`, u:url.glasses(g,true), i:g.colors[0].sunCard||g.colors[0].card, k:`${g.name} sol solar polarizado`})),
    ...D.accessories.map(a => ({t:a.name, s:'Acessório', u:url.accessory(a), i:a.image, k:`${a.name} acessorio acessório ${a.category||''} ${a.description||''}`})),
    {t:'Como funciona', s:'Página', u:'como-funciona.html', k:'como funciona planos pix'},
    {t:'Perguntas frequentes', s:'Página', u:'faq.html', k:'faq duvidas dúvidas perguntas ajuda'},
    {t:'Fale conosco', s:'Página', u:'contato.html', k:'contato atendimento ajuda whatsapp email'},
    {t:'Testes de visão', s:'Página', u:'testes-de-visao.html', k:'teste visao visão exame'}
  ];
}
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
function search(q){ const t = norm(q).trim().split(/\s+/).filter(Boolean); if(!t.length) return []; return searchIndex().filter(x => { const k = norm(x.t+' '+x.k); return t.every(w => k.includes(w)); }); }

/* ---------- Carrossel genérico ---------- */
function carousel({rail, prev, next, idx, pages, loop, auto}){
  let i = 0, t;
  const count = () => typeof pages === 'function' ? pages() : pages;
  const P = typeof prev === 'string' ? $(prev) : prev, N = typeof next === 'string' ? $(next) : next, I = typeof idx === 'string' ? $(idx) : idx;
  const go = n => { const c = count(); i = loop ? (n + c) % c : Math.max(0, Math.min(c-1, n)); rail(i); if(I) I.textContent = `${i+1}/${c}`; if(!loop){ if(P) P.disabled = i===0; if(N) N.disabled = i===c-1; } };
  const reset = () => { if(!auto) return; clearInterval(t); t = setInterval(()=>go(i+1), auto); };
  if(P) P.onclick = () => { go(i-1); reset(); };
  if(N) N.onclick = () => { go(i+1); reset(); };
  addEventListener('resize', () => go(i));
  go(0); reset();
  return {go, get i(){ return i; }};
}

/* ---------- Validações BR ---------- */
const valid = {
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()),
  cpf(v){ const c = String(v).replace(/\D/g,''); if(c.length!==11 || /^(\d)\1+$/.test(c)) return false; let s=0; for(let i=0;i<9;i++) s+= +c[i]*(10-i); let d=(s*10)%11%10; if(d!==+c[9]) return false; s=0; for(let i=0;i<10;i++) s+= +c[i]*(11-i); d=(s*10)%11%10; return d===+c[10]; },
  cep: v => /^\d{5}-?\d{3}$/.test(String(v).trim()),
  phone: v => String(v).replace(/\D/g,'').length >= 10,
  card(v){ const n = String(v).replace(/\D/g,''); if(n.length<13||n.length>19) return false; let s=0, alt=false; for(let i=n.length-1;i>=0;i--){ let d=+n[i]; if(alt){ d*=2; if(d>9) d-=9; } s+=d; alt=!alt; } return s%10===0; },
  expiry(v){ const m = String(v).match(/^(\d{2})\s*\/\s*(\d{2})$/); if(!m) return false; const mo=+m[1], y=2000+ +m[2]; if(mo<1||mo>12) return false; const now=new Date(); return y>now.getFullYear() || (y===now.getFullYear() && mo>=now.getMonth()+1); }
};
const mask = {
  cpf: v => v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'),
  cep: v => v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d)/,'$1-$2'),
  phone: v => { const d = v.replace(/\D/g,'').slice(0,11); return d.length>10 ? d.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3') : d.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3').replace(/[-\s(]+$/,''); },
  card: v => v.replace(/\D/g,'').slice(0,19).replace(/(\d{4})(?=\d)/g,'$1 '),
  expiry: v => v.replace(/\D/g,'').slice(0,4).replace(/(\d{2})(\d)/,'$1/$2')
};
function bindMasks(root=document){ $$('[data-mask]', root).forEach(el => { if(el._m) return; el._m = true; el.addEventListener('input', () => { el.value = mask[el.dataset.mask](el.value); }); }); }
async function lookupCep(cep){
  const c = String(cep).replace(/\D/g,''); if(c.length !== 8) return null;
  try{ const r = await fetch(`https://viacep.com.br/ws/${c}/json/`); const j = await r.json(); return j.erro ? null : j; }catch(e){ return null; }
}

/* ---------- Opções de grau ---------- */
const rx = {
  sph(){ const o=[]; for(let v=-12; v<=8.001; v+= (Math.abs(v)>=6?0.5:0.25)){ const x=+v.toFixed(2); if(x===0) o.push('0.00'); else o.push((x>0?'+':'')+x.toFixed(2)); } return o; },
  cyl(){ return ['-0.75','-1.25','-1.75','-2.25','-2.75']; },
  axis(){ const o=[]; for(let a=10;a<=180;a+=10) o.push(String(a)); return o; },
  options(list, ph='Selecionar'){ return `<option value="">${ph}</option>` + list.map(v=>`<option value="${v}">${v}</option>`).join(''); }
};

/* ---------- Inicialização ---------- */
function init(){
  if(!document.body.dataset.noChrome){
    document.body.insertAdjacentHTML('afterbegin', headerHTML());
    document.body.insertAdjacentHTML('beforeend', footerHTML());
  }
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-drawer]'); if(d){ e.preventDefault(); openDrawer(d.dataset.drawer); return; }
    if(e.target.closest('[data-close]')) closeDrawers();
  });
  addEventListener('keydown', e => { if(e.key==='Escape'){ closeDrawers(); $('#helpPanel')&&$('#helpPanel').classList.remove('on'); $$('.modal.on').forEach(m=>m.classList.remove('on')); } });
  const hb = $('#helpBtn'); if(hb) hb.onclick = () => $('#helpPanel').classList.toggle('on');
  const nf = $('#newsForm'); if(nf) nf.onsubmit = e => { e.preventDefault(); const em = nf.querySelector('input').value; const l = store.get('newsletter', []); if(!l.includes(em)) l.push(em); store.set('newsletter', l); $('#newsOk').textContent = 'Obrigado! Use o cupom BEMVINDO10 na sua primeira compra.'; nf.reset(); };
  const q = $('#hbQ'); if(q) q.addEventListener('input', () => { const r = search(q.value).slice(0,8); $('#hbQres').innerHTML = !q.value.trim() ? '' : (r.map(x=>`<li><a href="${x.u}" style="display:flex;gap:12px;align-items:center;font-size:15px">${x.i?`<img src="${img(x.i,120)}" style="width:48px;height:40px;object-fit:contain;background:var(--lav-solid);border-radius:4px" alt="">`:''}<span>${sup(x.t)}<br><small style="color:var(--muted);font-weight:400">${esc(x.s)}</small></span></a></li>`).join('') + (r.length?`<li><a href="busca.html?q=${encodeURIComponent(q.value)}" style="font-size:14px;color:var(--indigo)">Ver todos os resultados →</a></li>`:'<li style="color:var(--muted);padding:10px 0">Nenhum resultado encontrado.</li>')); });
  renderCartUI();
  bindFrameCards();
  bindMasks();
  addEventListener('storage', e => { if(e.key === 'hubble-br-cart') renderCartUI(); });
}

window.HB = {D, $, $$, store, brl, esc, img, qs, sup, ICON, TYPE_LABEL, PIX_OFF, installments, find, url, card, bindFrameCards, cart, user, toast, openDrawer, closeDrawers, renderCartUI, search, carousel, valid, mask, bindMasks, lookupCep, rx};
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
