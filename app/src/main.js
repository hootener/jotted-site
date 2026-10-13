import { createStore } from './store.js?v=c12a0ee880';
import { isUlid } from './ulid.js?v=c12a0ee880';
import { mountEditor } from './editor.js?v=c12a0ee880';
import { mountList } from './list.js?v=c12a0ee880';

const root = document.getElementById('app');
if (globalThis.jotted) {
  document.documentElement.classList.add('electron', `platform-${globalThis.jotted.platform}`);
  if (globalThis.jotted.platform === 'darwin') {
    const bar = document.createElement('div');
    bar.className = 'titlebar';
    document.body.prepend(bar);
  }
}
const store = await createStore();
let unmount = null;

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  unmount?.();
  unmount = null;
  const m = location.hash.match(/^#\/([0-9A-Za-z]{26})$/);
  const id = m?.[1]?.toUpperCase();
  if (id && isUlid(id)) {
    const jot = await store.loadJot(id);
    if (token !== routeToken) return; // hash changed while loading
    if (jot) {
      unmount = mountEditor(root, store, jot);
      return;
    }
  }
  if (location.hash && location.hash !== '#/') {
    location.replace('#/');
    return;
  }
  const list = await store.listJots();
  if (token !== routeToken) return;
  unmount = mountList(root, store, list);
}

window.addEventListener('hashchange', route);
route();

// Desktop auto-update banner (no-op in the browser build).
globalThis.jotted?.onUpdate?.(({ state, version }) => {
  let bar = document.querySelector('.update-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'update-banner';
    document.body.append(bar);
  }
  if (state === 'downloaded') {
    bar.innerHTML = `Jotted ${version} is ready. <button class="btn primary">Restart to update</button> <button class="btn ghost dismiss">Later</button>`;
    bar.querySelector('.primary').addEventListener('click', () => globalThis.jotted.installUpdate());
  } else {
    bar.innerHTML = `Jotted ${version} is available. <a class="btn primary" href="https://hootener.github.io/jotted-site/download.html" target="_blank" rel="noopener">Download</a> <button class="btn ghost dismiss">Later</button>`;
  }
  bar.querySelector('.dismiss').addEventListener('click', () => bar.remove());
});

// Desktop menu actions (no-op in the browser build).
globalThis.jotted?.onMenu?.(async (action) => {
  if (action === 'new-jot') {
    const jot = await store.saveJot(store.newJot());
    location.hash = `#/${jot.id}`;
  } else if (action === 'all-jots') {
    location.hash = '#/';
  }
});
