/* Ofertas pós-compra (mesma lógica da AiDEX):
   - oferta.html: o mesmo plano/produto do pedido com 50% OFF e/ou seguro de entrega, numa cobrança só;
   - entrega-prioritaria.html: entrega prioritária, cobrança separada.
   Compra no cartão → no mesmo cartão, com um clique (token do SDK guardado só nesta aba);
   compra no Pix → um Pix novo. Os preços vêm do servidor (/api/public/upsell). */
(function(){
  const {$, brl, esc, sup, img, user, ICON} = HB;
  $('#ckLogo').innerHTML = ICON.logo; $('#yr').textContent = new Date().getFullYear();
  const root = $('#root');
  const id = HB.qs('id') || '', n = HB.qs('n') || '';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EXPRESS = /entrega-prioritaria(\.html)?$/.test(location.pathname);
  const main = n ? user.getOrder(n) : null;
  const F = window.HBAPI && HBAPI.flow;
  const flow = F && UUID.test(id) ? F.get(id) : null;

  const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SHIELD = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';
  const TRUCK = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 4h14v12H1zM15 8h4l4 4v4h-8"/><circle cx="5.5" cy="18.5" r="2.2"/><circle cx="18.5" cy="18.5" r="2.2"/></svg>';

  const go = (page, oid) => location.replace(`${page}?n=${encodeURIComponent(n)}&id=${encodeURIComponent(oid || id)}`);
  const thanks = () => { if(flow) F.set(id, {stage:'done'}); go('obrigado.html'); };
  const toExpress = () => { F.set(id, {stage:'express'}); go('entrega-prioritaria.html'); };

  let offers = null, chosen = [], busy = false, err = '', errCard = false;
  let usePix = !!(flow && flow.cardFailed);
  const isCard = () => !!(offers && offers.method === 'card' && flow && flow.method === 'card' && flow.cardHash && !usePix);
  const priceOf = p => p === 'kit' ? offers.kit.price : offers[p].price;
  const selected = () => EXPRESS ? ['expresso'] : chosen.slice();
  const imageFor = it => {
    const own = main && (main.items || []).find(x => x.id === it.id && x.image);
    if(own) return own.image;
    const acc = it.kind === 'acessorio' && HB.find.accessory(it.id);
    return (acc && acc.image) || '';
  };

  function offerBox(p, inner){
    const on = chosen.includes(p);
    return `<label class="up-offer ${on ? 'on' : ''}"><input type="checkbox" data-p="${p}" ${on ? 'checked' : ''}><div class="up-in">${inner}</div></label>`;
  }

  function render(){
    const card = isCard(), sel = selected();
    const total = sel.reduce((s, p) => s + priceOf(p), 0);
    const first = ((main && main.name) || '').trim().split(/\s+/)[0];
    const banner = `<div class="up-ok">${CHECK}<span>${EXPRESS && flow.upsellPaid ? 'Compra adicional aprovada! Já está no seu pedido.' : 'Pagamento aprovado! Seu pedido está confirmado.'}</span></div>`;
    let body;
    if(EXPRESS){
      body = `<p class="up-kicker">Última oferta${first ? `, ${esc(first)}` : ''}</p>
        <h1>Quer receber mais rápido?</h1>
        <div class="up-offer solo"><div class="up-row"><span class="up-ic">${TRUCK}</span><div>
          <p class="up-t">${esc(offers.expresso.name)}</p>
          <p class="up-d">Seu pedido sai na frente: <b>despachamos com prioridade</b>, por envio expresso, para chegar antes.</p>
          <p class="up-p">${brl(offers.expresso.price)}</p></div></div></div>`;
    } else {
      const k = offers.kit, off = Math.round(offers.discount * 100), kImg = k ? imageFor(k) : '';
      const lens = k && k.kind === 'lente';
      body = `<p class="up-kicker">Espere${first ? `, ${esc(first)}` : ''}! Ofertas únicas para você</p>
        <h1>Escolha o que adicionar ao seu pedido</h1>
        <p class="lead">Marque uma ou as duas ofertas. ${card ? 'Cobramos no mesmo cartão da sua compra, sem digitar nada.' : 'Você paga tudo num Pix só.'}</p>
        ${k ? offerBox('kit', `<div class="up-row">${kImg ? `<img src="${img(kImg, 160)}" alt="">` : ''}<div>
            <p class="up-tag">${lens ? 'Mais um plano igual' : 'Mais um igual'} com ${off}% OFF</p>
            <p class="up-t">${sup(k.name)}</p>
            <p class="up-m">${(k.meta || []).filter(m => !/^Oferta pós-compra/.test(m)).map(esc).join('<br>')}</p>
            <p class="up-pr"><s>${brl(k.compareAt)}</s><b>${brl(k.price)}</b></p></div></div>
          <p class="up-d">${lens ? 'Garanta <b>mais um plano igual ao seu, com o mesmo grau</b>, pela metade do preço.' : 'Leve <b>mais um igual</b> pela metade do preço.'} Vai no mesmo envio do seu pedido, sem frete extra.</p>`) : ''}
        ${offerBox('seguro', `<div class="up-row"><span class="up-ic">${SHIELD}</span><div>
            <p class="up-t">${esc(offers.seguro.name)}</p>
            <p class="up-d">Se o seu pedido for extraviado ou chegar danificado, você escolhe: <b>reenviamos sem custo</b> ou <b>devolvemos o valor integral</b>.</p>
            <p class="up-p">${brl(offers.seguro.price)}</p></div></div>`)}`;
    }
    root.innerHTML = banner + body
      + (err ? `<p class="up-err" role="alert">${esc(err)}${errCard ? ' <button type="button" id="usePix">Pagar com Pix</button>' : ''}</p>` : '')
      + `<button type="button" class="up-btn" id="buy" ${busy || !sel.length ? 'disabled' : ''}>
          <span>${busy ? 'Processando…' : card ? 'Comprar com um clique' : 'Gerar Pix'}</span>
          <small>${!sel.length ? 'Marque uma oferta acima' : `${brl(total)} ${card ? 'no mesmo cartão' : 'no Pix'}`}</small></button>
        <button type="button" class="up-no" id="no" ${busy ? 'disabled' : ''}>${EXPRESS ? 'Não, obrigado. Pode enviar no prazo normal.' : 'Não, obrigado. Prefiro pagar o preço cheio depois.'}</button>`;
    root.querySelectorAll('[data-p]').forEach(c => c.onchange = () => {
      const p = c.dataset.p; chosen = c.checked ? [...chosen, p] : chosen.filter(x => x !== p); err = ''; render();
    });
    $('#buy').onclick = buy;
    $('#no').onclick = () => EXPRESS || !offers.expresso ? thanks() : toExpress();
    const up = $('#usePix'); if(up) up.onclick = () => { usePix = true; err = ''; errCard = false; render(); };
  }

  async function buy(){
    const products = selected();
    if(busy || !products.length) return;
    const card = isCard();
    busy = true; err = ''; render();
    const r = await HBAPI.upsell({parentId: id, products, payment: card ? {method:'card', cardHash: flow.cardHash} : {method:'pix'}});
    busy = false;
    if(!r.ok){ err = r.error; errCard = card; render(); return; }
    const d = r.data, now = Date.now(), pay = (d.totals && d.totals.payment) || {};
    // Pedido da oferta neste navegador (Minha Conta e página do pedido).
    user.saveOrder({
      number: d.number, orderId: d.orderId, date: now,
      email: (main && main.email) || '', name: (main && main.name) || '', phone: main && main.phone, cpf: main && main.cpf,
      items: (d.items || []).map(i => ({...i, image: imageFor(i)})),
      totals: {sub: d.amount, discount: 0, pix: 0, shipping: 0, total: d.amount},
      shipping: {id: 'junto', name: `Junto com o pedido ${n}`, eta: (main && main.shipping && main.shipping.eta) || ''},
      address: main ? {...main.address} : {},
      payment: d.method === 'card'
        ? {method:'cartao', brand: (main && main.payment && main.payment.brand) || '', last4: (main && main.payment && main.payment.last4) || '', inst: {n: pay.installments || 1, value: d.amount / (pay.installments || 1)}}
        : {method:'pix'},
      rx: {method: 'nao-precisa'},
      status: 'Pagamento pendente', qrcode: d.qrcode || null, pixExpires: d.expiresAt ? Date.parse(d.expiresAt) : undefined,
      upsellOf: id, upsellItems: products
    });
    F.set(id, EXPRESS ? {expressId: d.orderId} : {upsellId: d.orderId});
    location.href = `pedido-confirmado.html?n=${encodeURIComponent(d.number)}&id=${encodeURIComponent(d.orderId)}`;
  }

  async function start(){
    // Sem o fluxo desta aba (outro dispositivo, página reaberta depois) ou etapa já concluída: obrigado.
    if(!flow || !UUID.test(id) || !window.HBAPI) return thanks();
    if(EXPRESS ? flow.stage === 'done' : flow.stage !== 'offers') return !EXPRESS && flow.stage === 'express' ? go('entrega-prioritaria.html') : thanks();
    root.innerHTML = '<p class="lead">Carregando…</p>';
    const r = await HBAPI.upsellOffers(id);
    if(!r.ok) return thanks();
    if(!r.data.paid) return go('pedido-confirmado.html');
    offers = r.data;
    if(EXPRESS && !offers.expresso) return thanks();
    document.title = (EXPRESS ? 'Entrega prioritária' : 'Oferta especial') + ' | Hubble';
    render();
  }
  start();
})();
