const slides = [...document.querySelectorAll('.slide')];
const previous = document.getElementById('previous');
const next = document.getElementById('next');
const notes = document.getElementById('notes');
let current = 0;
function showSlide(index, updateHash = true) {
  current = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, position) => { slide.hidden = position !== current; });
  previous.disabled = current === 0;
  next.disabled = current === slides.length - 1;
  document.getElementById('counter').textContent = `${current + 1} / ${slides.length}`;
  document.getElementById('slide-label').textContent = slides[current].dataset.title;
  document.title = `ProjectSync · ${slides[current].dataset.title}`;
  if (updateHash) history.replaceState(null, '', `#slide-${current + 1}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function fromHash() {
  const match = location.hash.match(/^#slide-(\d+)$/);
  showSlide(match ? Number(match[1]) - 1 : 0, false);
}
previous.addEventListener('click', () => showSlide(current - 1));
next.addEventListener('click', () => showSlide(current + 1));
notes.addEventListener('click', () => {
  const enabled = document.body.classList.toggle('show-notes');
  notes.setAttribute('aria-pressed', String(enabled));
});
document.getElementById('print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', fromHash);
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); showSlide(current + 1); }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); showSlide(current - 1); }
  if (event.key === 'Home') { event.preventDefault(); showSlide(0); }
  if (event.key === 'End') { event.preventDefault(); showSlide(slides.length - 1); }
});
fromHash();
