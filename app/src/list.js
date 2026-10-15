// Home page: list of saved jots.
import { renderThumbnail, createImageCache } from './canvas.js?v=3fc9c45e0a';

export function mountList(root, store, jots) {
  root.innerHTML = `
    <div class="home">
      <header class="home-header">
        <a class="brand" href="#/" aria-label="Jotted">
          <img class="brand-wordmark" src="assets/wordmark.png" alt="jotted">
        </a>
        <button class="btn primary new">+ New jot</button>
      </header>
      <main class="grid"></main>
    </div>`;
  const grid = root.querySelector('.grid');
  const pending = new Map(); // card -> jot, re-rendered when an image finishes loading
  const imageCache = createImageCache(() => {
    for (const [card, jot] of pending) {
      const thumb = card.querySelector('.thumb');
      if (thumb) thumb.replaceChildren(renderThumbnail(jot, 240, 150, imageCache));
    }
  });
  root.querySelector('.new').addEventListener('click', async () => {
    const jot = await store.saveJot(store.newJot());
    location.hash = `#/${jot.id}`;
  });

  if (jots.length === 0) {
    grid.innerHTML = `<p class="empty">No jots yet. Create one and start writing.<br>
      Works best with a stylus. Mouse and touch work too.</p>`;
  }

  for (const entry of jots) {
    const card = document.createElement('article');
    card.className = 'card';
    grid.append(card);
    store.loadJot(entry.id).then((jot) => {
      if (!jot) card.remove();
      else if (card.isConnected) fillCard(card, jot);
    });
  }

  document.title = 'Jotted';
  return function unmount() {
    root.innerHTML = '';
  };

  function fillCard(card, jot) {
    card.innerHTML = `
      <a class="thumb" href="#/${jot.id}" aria-label="Open jot ${jot.id}"></a>
      <div class="meta">
        <div class="meta-text">
          <span class="name">${escapeHtml(jot.name)}</span>
          <span class="count">${formatDate(jot.updatedAt)} · ${jot.strokes.length} stroke${jot.strokes.length === 1 ? '' : 's'}</span>
        </div>
        <button class="btn ghost delete" title="Delete jot">Delete</button>
      </div>`;
    card.querySelector('.thumb').append(renderThumbnail(jot, 240, 150, imageCache));
    if (jot.images?.length) pending.set(card, jot);

    // Two-step delete: first click arms, second click within 3s confirms.
    const del = card.querySelector('.delete');
    let armed = 0;
    del.addEventListener('click', async () => {
      if (armed) {
        clearTimeout(armed);
        await store.deleteJot(jot.id);
        card.remove();
        if (!grid.children.length) mountList(root, store, []);
        return;
      }
      del.textContent = 'Confirm?';
      del.classList.add('danger');
      armed = setTimeout(() => {
        armed = 0;
        del.textContent = 'Delete';
        del.classList.remove('danger');
      }, 3000);
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(ts) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
