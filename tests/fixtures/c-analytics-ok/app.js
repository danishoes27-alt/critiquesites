// Código próprio inofensivo da fixture: só dá assinaturas para o medidor de JS.
window.AOS = { init: function () {} };
window.gsap = { to: function () {} };
AOS.init({ duration: 600 });
gsap.to('.hero', { opacity: 1 });
console.error('c-analytics-ok: erro proposital de console');
