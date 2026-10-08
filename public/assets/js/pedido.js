/* Página do pedido (pedido-confirmado.html) e página de obrigado (obrigado.html).
   Depois do pagamento (fluxo desta aba, HBAPI.flow): pedido principal → oferta.html (mesmo
   plano 50% OFF + seguro) → entrega-prioritaria.html → obrigado.html do pedido principal. */
(function(){
  const {$, brl, esc, sup, img, user, ICON} = HB;
  $('#ckLogo').innerHTML = ICON.logo; $('#yr').textContent = new Date().getFullYear();
  const root = $('#root');
  const n = HB.qs('n') || '';
  const qsId = HB.qs('id') || '';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let timer = null, poll = null, remote = null, apiDown = false, purchaseSent = false;
  const EXPIRES = 30*60*1000;
  /* obrigado.html = página de obrigado, aberta assim que o pagamento é confirmado. */
  const THANKS = /obrigado(\.html)?$/.test(location.pathname);
  let leaving = false;
  const pageUrl = (page, o) => `${page}?n=${encodeURIComponent(o.number)}${orderId(o) ? `&id=${encodeURIComponent(orderId(o))}` : ""}`;
  function goTo(page, o, delay){
    if(leaving) return; leaving = true;
    // Pequena espera para o evento Purchase do pixel sair antes de trocar de página.
    setTimeout(() => location.replace(pageUrl(page, o)), delay || 0);
  }

  /* QR Code real do Pix copia e cola (biblioteca qrcode-generator via cdnjs). */
  function qrHTML(text){
    if(!text) return '';
    try{
      if(typeof window.qrcode !== 'function') throw new Error('qr lib');
      const q = window.qrcode(0, 'M'); q.addData(text); q.make();
      return q.createSvgTag({cellSize: 4, margin: 2, scalable: true}).replace('<svg ', '<svg role="img" aria-label="QR Code Pix" ');
    }catch(e){ return '<p class="lead" style="padding-top:80px">Use o código Pix copia e cola abaixo.</p>'; }
  }
  function addBusinessDays(ts, k){ const d = new Date(ts); while(k > 0){ d.setDate(d.getDate() + 1); const w = d.getDay(); if(w !== 0 && w !== 6) k--; } return d; }
  async function copyText(t){
    try{ if(navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(t); return true; } }catch(e){}
    try{ const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }catch(e){ return false; }
  }
  const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
  const needsRx = () => false; /* a finalização da compra não fala de receita */

  /* ---------- Linha do tempo ---------- */
  function timelineHTML(o){
    if(o.status === 'Cancelado') return '<div class="notice">Este pedido foi cancelado. Se o pagamento já tinha sido feito, o estorno é processado em até 7 dias úteis.</div>';
    const rx = needsRx(o);
    const steps = ['Pagamento', ...(rx ? ['Receita validada'] : []), 'Em preparação', 'Enviado', 'Entregue'];
    const curIdx = {'Pagamento pendente': 0, 'Receita em análise': 1, 'Em preparação': steps.indexOf('Em preparação'), 'Enviado': steps.indexOf('Enviado'), 'Entregue': steps.length}[o.status] ?? 0;
    return `<ol class="tl" aria-label="Andamento do pedido">${steps.map((s, i) => `<li class="${i < curIdx ? 'done' : i === curIdx ? 'cur' : ''}"${i === curIdx ? ' aria-current="step"' : ''}><i>${i < curIdx ? '✓' : i + 1}</i>${s}</li>`).join('')}</ol>`;
  }

  const COPY_IC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const howTo = (pix) => `<div class="how"><h2>Como pagar o ${pix?'Pix':'boleto'}</h2><ol>${(pix ? [
      'Clique em <b>copiar o código</b>, logo acima',
      'Abra o <b>aplicativo</b> do seu banco',
      'Selecione a opção <b>Pix</b>',
      'Toque em <b>"Pix Copia e Cola"</b>',
      'Insira o código copiado e finalize seu pagamento'
    ] : [
      'Clique em <b>copiar o código</b>, logo acima',
      'Abra o <b>aplicativo</b> do seu banco',
      'Escolha <b>Pagar boleto</b>',
      'Cole a <b>linha digitável</b> copiada',
      'Confirme os dados e finalize o pagamento'
    ]).map((t,i)=>`<li><i>${i+1}</i><span>${t}</span></li>`).join('')}</ol></div>`;

  function detailsHTML(o){
    const t = o.totals || {}, a = o.address || {}, rxm = null, pay = o.payment || {};
    const extras = orderId(o) ? HB.store.get('orders', []).filter(x => x.upsellOf === orderId(o) && x.status !== 'Pagamento pendente' && x.status !== 'Cancelado') : [];
    const subs = HB.store.get('subs', []).filter(s => s.order === o.number && s.status !== 'cancelada');
    const next = [];
    if(rxm === 'depois') next.push(`Envie a foto ou o PDF da sua receita para <b>receitas@hubble.com.br</b> informando o número <b>${esc(o.number)}</b>.`);
    if(rxm === 'medico') next.push('Vamos entrar em contato com o consultório do seu oftalmologista para confirmar a receita.');
    if(rxm === 'upload') next.push(`Envie também a foto da receita para <b>receitas@hubble.com.br</b> com o número <b>${esc(o.number)}</b> — nossa equipe confere em até 1 dia útil.`);
    if(subs.length) next.push(`Sua assinatura está ativa: a próxima entrega será em ${fmtDate(Math.min(...subs.map(s => s.next)))}. Você pode alterar, pausar ou cancelar em Minha Conta.`);
    next.push(`Prazo de entrega: ${o.shipping ? esc(o.shipping.eta) : '7 a 10 dias úteis'} após a ${needsRx(o)?'validação da receita':'confirmação do pagamento'}.`);
    next.push(`Acompanhe a entrega em <a href="rastreio.html?pedido=${encodeURIComponent(o.number)}" class="link-u">Rastrear pedido</a>.`);
    return `
      <div class="card"><h3>Andamento</h3>${timelineHTML(o)}</div>
      <div class="card"><h3>Próximos passos</h3><ul class="next">${next.map(x=>`<li>${x}</li>`).join('')}</ul></div>
      <div class="card"><h3>Pedido ${esc(o.number)}</h3>
        ${(o.items||[]).map(it=>`<div class="it">${it.image?`<img src="${img(it.image,140)}" alt="">`:''}<div><div>${sup(it.name)}${it.qty>1?` × ${it.qty}`:''}</div><div class="m">${(it.meta||[]).map(esc).join('<br>')}</div></div><span class="v">${brl(it.price*it.qty)}</span></div>`).join('')}
        <div style="margin-top:8px">
          <div class="ln"><span>Produtos</span><span>${brl(t.sub)}</span></div>
          ${t.discount?`<div class="ln"><span>Cupom</span><span class="g">-${brl(t.discount)}</span></div>`:''}
          ${t.pix?`<div class="ln"><span>Desconto Pix</span><span class="g">-${brl(t.pix)}</span></div>`:''}
          <div class="ln"><span>Frete</span><span class="g">${t.shipping?brl(t.shipping):'Grátis'}</span></div>
          <div class="ln t"><span>Total</span><span>${brl(t.total)}</span></div>
          <div class="ln"><span>Pagamento</span><span>${pay.method === 'cartao' ? `Cartão${pay.inst && pay.inst.n > 1 ? ` · ${pay.inst.n}x de ${brl(pay.inst.value)}` : ' · à vista'}` : 'Pix'}</span></div>
        </div></div>
      ${extras.length ? `<div class="card"><h3>Adicionados ao seu pedido</h3>${extras.map(x => (x.items||[]).map(it=>`<div class="it">${it.image?`<img src="${img(it.image,140)}" alt="">`:''}<div><div>${sup(it.name)}</div><div class="m">${(it.meta||[]).map(esc).join('<br>')}</div></div><span class="v">${brl(it.price*it.qty)}</span></div>`).join('')).join('')}<p class="lead" style="text-align:left;margin-top:8px">Vão no mesmo envio do pedido ${esc(o.number)}.</p></div>` : ''}
      ${a.rua ? `<div class="card"><h3>Entrega</h3><p style="font-size:13px">${esc(o.name)}<br>${esc(a.rua)}, ${esc(a.numero)}${a.complemento?' - '+esc(a.complemento):''}<br>${esc(a.bairro)}, ${esc(a.cidade)}/${esc(a.uf)} ${esc(a.cep)}</p></div>` : ''}
      <div class="acts"><a href="conta.html#pedidos" class="btn block">Acompanhar em Minha Conta</a><a href="index.html" class="btn ghost block">Continuar comprando</a></div>`;
  }

  /* Pedido do servidor (outro navegador/dispositivo) no formato local. */
  function fromRemote(d){
    return {number:d.number, orderId:d.id, date:Date.parse(d.createdAt)||Date.now(), email:'', name:d.firstName||'',
      items:(d.items||[]).map(i=>({kind:i.kind, id:i.id, name:i.name, qty:i.qty, price:i.price, meta:i.meta, image:(i.kind==='acessorio' && HB.find.accessory(i.id)||{}).image||''})),
      totals:{sub:d.totals.sub, discount:d.totals.discount, pix:0, shipping:d.totals.shipping, total:d.totals.total},
      shipping:d.totals.frete, address:{}, rx:{method:d.rxMethod||'nao-precisa'},
      payment: d.method === 'card' ? {method:'cartao', brand:(d.card||{}).brand||'', last4:(d.card||{}).last4||'', inst: d.installments ? {n:d.installments, value:d.amount/d.installments} : null} : {method:'pix'},
      upsellOf: d.upsell ? d.upsell.of : undefined,
      status:'Pagamento pendente', qrcode:d.qrcode, pixExpires:Date.parse(d.expiresAt)||undefined, remoteOnly:true};
  }
  const orderId = o => (o && o.orderId) || (UUID.test(qsId) ? qsId : '');

  function apply(o, d){
    if(!d) return o;
    if(d.paid && o.status === 'Pagamento pendente'){
      o.status = needsRx(o) ? 'Receita em análise' : 'Em preparação';
      o.paidAt = Date.parse(d.paidAt) || Date.now();
      o.qrcode = null;
      if(!purchaseSent && window.HBAPI){ purchaseSent = true; HBAPI.metaPurchase(d.id, d.amount, (o.items||[]).map(i=>i.name).join(' + ').slice(0,120)); }
    }
    if(!d.paid && d.status === 'expired') o.pixExpired = true;
    if(!d.paid && d.status === 'refused') o.cardRefused = true;
    if(!d.paid && d.qrcode && !o.qrcode) o.qrcode = d.qrcode;
    if(d.expiresAt) o.pixExpires = Date.parse(d.expiresAt) || o.pixExpires;
    if(!o.remoteOnly) user.saveOrder(o);
    return o;
  }

  async function check(o){
    const id = orderId(o);
    if(!id || !window.HBAPI) return;
    const r = await HBAPI.order(id);
    if(!r.ok){
      if(r.status === 0 || r.status >= 500){ apiDown = true; const w = $('#apiWarn'); if(w) w.textContent = 'Não conseguimos verificar o pagamento agora. Vamos tentar de novo automaticamente.'; }
      return;
    }
    apiDown = false; const w = $('#apiWarn'); if(w) w.textContent = '';
    const before = o.status, hadQr = !!o.qrcode, wasExpired = !!o.pixExpired, wasRefused = !!o.cardRefused;
    remote = r.data; apply(o, r.data);
    if(o.status !== before || !!o.qrcode !== hadQr || !!o.pixExpired !== wasExpired || !!o.cardRefused !== wasRefused){ render(o); if(o.status !== before) window.scrollTo(0,0); }
  }
  function startPolling(o){
    clearInterval(poll);
    if(!orderId(o) || o.status !== 'Pagamento pendente') return;
    poll = setInterval(() => { if(o.status !== 'Pagamento pendente' || o.pixExpired || o.cardRefused){ clearInterval(poll); return; } check(o); }, 5000);
  }
  /** Compra pós-compra: pedido principal ({number, orderId}) e se é a etapa da entrega prioritária. */
  function upsellOf(o){
    const u = remote && remote.upsell;
    if(u) return {main: {number: u.number, orderId: u.of}, express: (u.products||[]).includes('expresso')};
    if(o && o.upsellOf){ const m = (HB.store.get('orders', []).find(x => x.orderId === o.upsellOf)) || {}; return {main: {number: m.number || '', orderId: o.upsellOf}, express: (o.upsellItems||[]).includes('expresso')}; }
    return null;
  }
  function redoOrder(o){
    // Pós-compra: volta para a oferta (com Pix, se o cartão falhou), não para o carrinho.
    const up = upsellOf(o);
    if(up){
      if(window.HBAPI) HBAPI.flow.set(up.main.orderId, {stage: up.express ? 'express' : 'offers', cardFailed: true});
      location.href = pageUrl(up.express ? 'entrega-prioritaria.html' : 'oferta.html', up.main); return;
    }
    (o.items||[]).filter(i => !(i.meta||[]).includes('Oferta do checkout')).forEach(i => { const {key, ...rest} = i; HB.cart.add(rest); });
    location.href = 'checkout.html';
  }
  /** Para onde ir depois do pagamento confirmado (fluxo pós-compra desta aba). */
  function nextAfterPaid(o){
    const F = window.HBAPI && HBAPI.flow, up = upsellOf(o);
    if(up){
      const f = F && F.get(up.main.orderId);
      if(f && !up.express && f.stage !== 'done'){ F.set(up.main.orderId, {stage:'express', upsellPaid:true}); return ['entrega-prioritaria.html', up.main]; }
      if(f) F.set(up.main.orderId, {stage:'done'});
      return ['obrigado.html', up.main];
    }
    const f = F && orderId(o) && F.get(orderId(o));
    if(f && f.stage === 'offers') return ['oferta.html', o];
    if(f && f.stage === 'express') return ['entrega-prioritaria.html', o];
    return ['obrigado.html', o];
  }

  function render(o){
    clearInterval(timer);
    if(!o){
      root.innerHTML = `<h1>Pedido não encontrado</h1><p class="lead">Não encontramos ${n ? `o pedido <b>${esc(n)}</b>` : 'um número de pedido'} neste navegador.</p><div class="acts"><a href="rastreio.html${n?`?pedido=${encodeURIComponent(n)}`:''}" class="btn block">Rastrear pedido</a><a href="conta.html" class="btn ghost block">Ir para Minha Conta</a></div>`;
      return;
    }
    document.title = `Pedido ${o.number} | Hubble`;
    const p = o.payment || {};
    const pending = o.status === 'Pagamento pendente';
    // Pago = confirmado pelo gateway (o servidor consulta a PixGate). O status salvo no navegador não vale.
    const paid = !!(remote && remote.paid);
    if(paid && !THANKS){ const [page, to] = nextAfterPaid(o); root.innerHTML = '<p class="lead">Pagamento confirmado! Abrindo…</p>'; goTo(page, to, purchaseSent ? 1200 : 0); return; }
    if(!paid && THANKS){ goTo('pedido-confirmado.html', o); return; }
    if(!paid && !pending && o.status !== 'Cancelado'){ o.status = 'Pagamento pendente'; return render(o); }
    if(THANKS) document.title = `Obrigado! Pedido ${o.number} | Hubble`;
    if(o.status === 'Cancelado'){
      root.innerHTML = `<h1>Pedido cancelado</h1><span class="pill no">Cancelado</span>${detailsHTML(o)}`; return;
    }
    if(pending && p.method === 'pix'){
      const exp = o.pixExpires || (o.date + EXPIRES);
      const code = o.qrcode || '';
      const expired = o.pixExpired || (code && exp <= Date.now() && !orderId(o));
      if(expired){
        root.innerHTML = `<h1>O código Pix expirou</h1>
          <p class="lead">O Pix do pedido <b>${esc(o.number)}</b> não foi pago dentro de 30 minutos. Se você já pagou, aguarde: a confirmação aparece aqui automaticamente.</p>
          <span class="pill no">Pix expirado</span>
          <div class="acts"><button type="button" class="btn block" id="redo">Refazer o pedido</button><a href="contato.html" class="btn ghost block">Falar com a equipe</a></div>
          <p class="lead" id="apiWarn" role="status" style="margin-top:12px"></p>`;
        $('#redo').onclick = () => redoOrder(o);
        return;
      }
      if(!code){
        root.innerHTML = `<h1>Quase lá...</h1>
          <p class="lead">Não conseguimos carregar o código Pix do pedido <b>${esc(o.number)}</b> agora.</p>
          <span class="pill wait">Aguardando pagamento</span>
          <p class="lead" style="margin-top:16px">Atualize a página em alguns instantes. Se o problema continuar, <a href="contato.html" class="link-u">fale com a nossa equipe</a> informando o número do pedido.</p>
          <p class="lead" id="apiWarn" role="status" style="margin-top:12px"></p>`;
        return;
      }
      root.innerHTML = `<h1>Quase lá...</h1>
        <p class="lead" id="pixLead">Pague via Pix em até <b id="mmss">30:00</b> para confirmar seu pedido.</p>
        <span class="pill wait">Aguardando pagamento</span>
        <div class="qr">${qrHTML(code)}</div>
        <p class="amt">Total via Pix: <b>${brl(o.totals.total)}</b></p>
        <div class="codebox" id="code">${esc(code)}</div>
        <button type="button" class="copy" id="copyBtn">${COPY_IC} <span>Copiar código</span></button>
        <p class="paid-link" id="apiWarn" role="status">${orderId(o) ? 'Assim que o pagamento for confirmado, esta página atualiza sozinha.' : ''}</p>
        ${howTo(true)}
        <p class="lead" style="margin-top:30px">Pedido <b>${esc(o.number)}</b>${o.email?` · confirmação enviada para <b>${esc(o.email)}</b>`:''}</p>`;
      const tick = () => { const left = Math.max(0, exp - Date.now()); const m = Math.floor(left/60000), s = Math.floor(left%60000/1000);
        if(left <= 0){ clearInterval(timer); $('#pixLead').innerHTML = 'O prazo do código Pix terminou. Se você já pagou, aguarde a confirmação.'; if(orderId(o)) check(o); else { o.pixExpired = true; render(o); } return; }
        $('#mmss').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; };
      tick(); timer = setInterval(tick, 1000);
      $('#copyBtn').onclick = async () => { const ok = await copyText(code); $('#copyBtn span').textContent = ok ? 'Código copiado!' : 'Não foi possível copiar'; setTimeout(()=>{ const s = $('#copyBtn span'); if(s) s.textContent = 'Copiar código'; }, 2500); };
      return;
    }
    if(pending && p.method === 'cartao'){
      const up = upsellOf(o);
      if(o.cardRefused){
        root.innerHTML = `<h1>Pagamento não aprovado</h1>
          <p class="lead">O banco não aprovou o pagamento do pedido <b>${esc(o.number)}</b> no cartão. Nenhum valor foi cobrado.</p>
          <span class="pill no">Cartão recusado</span>
          <div class="acts"><button type="button" class="btn block" id="redo">${up ? 'Voltar à oferta' : 'Tentar de novo'}</button><a href="contato.html" class="btn ghost block">Falar com a equipe</a></div>`;
        $('#redo').onclick = () => redoOrder(o);
        return;
      }
      const inst = p.inst && p.inst.n > 1 ? ` em ${p.inst.n}x de ${brl(p.inst.value)}` : '';
      root.innerHTML = `<h1>Pagamento em análise</h1>
        <p class="lead">Recebemos o pedido <b>${esc(o.number)}</b>. O banco está confirmando o pagamento no cartão — costuma levar só alguns segundos.</p>
        <span class="pill wait">Processando pagamento</span>
        <p class="amt">Total no cartão: <b>${brl(o.totals.total)}</b>${inst}</p>
        <p class="paid-link" id="apiWarn" role="status">${orderId(o) ? 'Esta página atualiza sozinha assim que o banco responder.' : ''}</p>
        <p class="lead" style="margin-top:30px">Pedido <b>${esc(o.number)}</b>${o.email?` · confirmação enviada para <b>${esc(o.email)}</b>`:''}</p>`;
      return;
    }
    if(pending && p.method === 'boleto'){
      const due = addBusinessDays(o.date, 3);
      root.innerHTML = `<h1>Quase lá...</h1>
        <p class="lead">Pague o boleto até <b>${due.toLocaleDateString('pt-BR')}</b> para confirmar seu pedido.</p>
        <span class="pill wait">Aguardando pagamento</span>
        <p class="lead" style="margin-top:16px">Pedido <b>${esc(o.number)}</b>. Em caso de dúvidas, <a href="contato.html" class="link-u">fale com a nossa equipe</a>.</p>`;
      return;
    }
    root.innerHTML = `<div class="okic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1>Obrigado${o.name?`, ${esc((o.name||'').split(' ')[0])}`:''}!</h1>
      <p class="lead">Seu pedido <b>${esc(o.number)}</b> foi confirmado.${o.email?` Enviamos os detalhes para <b>${esc(o.email)}</b>.`:''}</p>
      <span class="pill ok">Pagamento aprovado</span>
      ${detailsHTML(o)}`;
  }

  async function start(){
    let o = n ? user.getOrder(n) : null;
    if(o && !o.orderId && UUID.test(qsId)){ o.orderId = qsId; user.saveOrder(o); }
    const id = orderId(o) || (UUID.test(qsId) ? qsId : '');
    if(id && window.HBAPI){
      root.innerHTML = '<p class="lead">' + (THANKS ? 'Confirmando pagamento…' : 'Carregando pedido…') + '</p>';
      const r = await HBAPI.order(id);
      if(r.ok && (!n || r.data.number === n)){ remote = r.data; if(!o) o = fromRemote(r.data); apply(o, r.data); }
    }
    render(o);
    if(o && orderId(o) && o.status === 'Pagamento pendente'){ check(o); startPolling(o); }
  }
  start();
})();
