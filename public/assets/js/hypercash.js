/* =========================================================
   Hubble Brasil — cartão de crédito (HyperCash / FastSoft) no navegador.
   O SDK da HyperCash transforma o cartão em token (com 3DS quando disponível).
   Os dados do cartão vão direto do navegador para o gateway — nunca para o nosso servidor.
   Exposto em window.HBCard = {load, tokenize}.
   ========================================================= */
(function(){
'use strict';
// SDK da própria HyperCash (mesma API do FastSoft.js). O da FastSoft (js.fastsoftbrasil.com) gera o
// token em outro servidor, e a HyperCash recebe o cartão "vazio" na cobrança.
const SDK_URL = 'https://js.hypercash.com.br/security.js';
let ready = null;

function load(publicKey){
  if(ready) return ready;
  ready = new Promise((resolve, reject) => {
    const init = () => window.FastSoft
      ? window.FastSoft.setPublicKey(publicKey).then(() => resolve(window.FastSoft), reject)
      : reject(new Error('SDK indisponível'));
    if(window.FastSoft) return void init();
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = init;
    s.onerror = () => reject(new Error('Falha ao carregar o SDK'));
    document.head.appendChild(s);
  }).catch(e => { ready = null; throw e; }); // permite tentar de novo
  return ready;
}

/**
 * card: {number, holderName, expMonth, expYear, cvv}
 * ctx:  {amount (centavos — o mesmo valor que o servidor vai cobrar), installments,
 *        customer: {name, email, phoneNumber}, address: {street, streetNumber, complement,
 *        zipCode, neighborhood, city, state, country: 'BR'}}
 * onThreeDS(active): avisa a tela quando o banco está autenticando (3DS).
 */
async function tokenize(publicKey, card, ctx, onThreeDS){
  const sdk = await load(publicKey);
  if(await sdk.isThreeDSEnabled()){
    try{
      if(onThreeDS) onThreeDS(true);
      await sdk.initializeThreeDS({
        amount: ctx.amount, currency: 'BRL', installments: ctx.installments,
        card: {number: card.number, holderName: card.holderName, expMonth: card.expMonth, expYear: card.expYear}
      });
      // Se o banco exigir, o próprio SDK abre a janela de autenticação (desafio 3DS) e só
      // responde depois que o cliente concluir. Mesmo com "failure" o fluxo segue: o gateway decide.
      await sdk.authenticateThreeDS({customer: ctx.customer, address: ctx.address});
      await sdk.finalizeThreeDS();
    }catch(e){
      // Cartão/banco sem 3DS: segue sem autenticação e o gateway decide.
      console.warn('3DS indisponível, seguindo sem autenticação', e);
    }finally{
      if(onThreeDS) onThreeDS(false);
    }
  }
  return sdk.encrypt(card);
}

window.HBCard = {load, tokenize};
})();
