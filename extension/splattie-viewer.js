// Interactive .splattie renderer for the extension viewer page. .splattie is a
// RIGGED splat: the splattie-widget (built on Spark) drives an LBS-skinned head
// with a state machine that follows the cursor and auto-blinks. It runs here
// because the extension page's CSP allows Spark's worker + WASM. Importing the
// bundle auto-registers <splattie-widget>.
import './vendor/splattie-widget.esm.js';

const post = (msg) => parent.postMessage(msg, '*');

addEventListener('message', (e) => {
  if (e.origin !== 'https://github.com' || !e.data || e.data.type !== 'ov-splat') return;
  try {
    // The widget detects .splattie from its src string and fetches the blob; the
    // fragment carries the extension without affecting the fetch.
    const url = URL.createObjectURL(new Blob([e.data.bytes])) + '#file.splattie';
    const widget = document.createElement('splattie-widget');
    widget.setAttribute('src', url);
    document.body.appendChild(widget);
    // Report success once the widget has mounted Spark's canvas.
    const t0 = performance.now();
    (function check() {
      if (widget.querySelector('canvas')) return post({ type: 'ov-splat-ok' });
      if (performance.now() - t0 > 15000)
        return post({ type: 'ov-splat-error', error: 'splattie widget did not render in 15s' });
      requestAnimationFrame(check);
    })();
  } catch (err) {
    post({ type: 'ov-splat-error', error: 'splattie: ' + ((err && err.message) || err) });
  }
});

post({ type: 'ov-splat-ready' });
