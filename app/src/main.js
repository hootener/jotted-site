import { createStore } from './store.js?v=4314a9ac34';
import { isUlid } from './ulid.js?v=4314a9ac34';
import { mountEditor } from './editor.js?v=4314a9ac34';
import { mountList } from './list.js?v=4314a9ac34';

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

// Desktop menu actions (no-op in the browser build).
globalThis.jotted?.onMenu?.(async (action) => {
  if (action === 'new-jot') {
    const jot = await store.saveJot(store.newJot());
    location.hash = `#/${jot.id}`;
  } else if (action === 'all-jots') {
    location.hash = '#/';
  }
});
