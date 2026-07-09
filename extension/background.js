// octoview background (event page — Safari runs `background.scripts`, not the
// service worker, in unpacked mode). The github.com content script can't hand
// data to an extension page directly across Safari's process boundary, but it
// CAN message the background, and the background can open the viewer tab with the
// resolved raw URL baked into the tab's hash — no opener/storage/polling.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'preview' || !msg.src) return;
  const url =
    browser.runtime.getURL('viewer.html') +
    '#src=' +
    encodeURIComponent(msg.src) +
    '&name=' +
    encodeURIComponent(msg.name || 'file');
  browser.tabs.create({ url });
});
