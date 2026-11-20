function abrirMenu() { document.body.classList.toggle('aberto'); }
function proximo() { window.scrollBy(0, 200); }
function sair() { document.body.classList.add('saiu'); }
var campo = document.querySelector('input[name="email"]');
campo.addEventListener('paste', function (e) { e.preventDefault(); });
