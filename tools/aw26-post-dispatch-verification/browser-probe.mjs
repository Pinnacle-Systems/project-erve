// Debug helper: node browser-probe.mjs <actorKey|ADMIN> <path> [<path>...]  -> prints visible text, buttons, inputs; saves probe shots.
import { launch, login, shot, actors, adminCreds, delay } from './browser-lib.mjs';
const [who, ...paths] = process.argv.slice(2);
const b = await launch();
try {
  const c =
    who === 'ADMIN'
      ? adminCreds()
      : { identifier: actors()[who].email, password: actors()[who].password };
  await login(b, c.identifier, c.password);
  for (const p of paths) {
    await b.navigateTo(p.startsWith('/') ? p : '/' + p);
    await delay(2500);
    const info = await b.evaluate(`(() => ({
      url: location.pathname,
      text: document.querySelector('main')?.innerText.replace(/\\n+/g, ' | ').slice(0, 900),
      buttons: [...document.querySelectorAll('main button, main a[role=button]')].map(x => x.innerText.trim()).filter(Boolean).slice(0, 25),
      inputs: [...document.querySelectorAll('main input')].map(i => i.type + ':' + (i.id || i.name || i.getAttribute('aria-label') || '')).slice(0, 12),
    }))()`);
    console.log(JSON.stringify(info, null, 1));
  }
} catch (e) {
  console.error('PROBE ERROR', e.message);
} finally {
  b.socket.close();
  b.__child.kill();
  process.exit(0);
}
