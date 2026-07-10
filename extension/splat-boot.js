// Error relay for the splat viewer pages: any failure (CSP refusal, load
// error, exception) is reported to the content script, which falls back to the
// main-thread renderer. External file (not inline) so it runs under Chrome's
// MV3 extension-page CSP, which refuses 'unsafe-inline'.
const post = (m) => parent.postMessage(m, '*');
addEventListener('securitypolicyviolation', (e) =>
  post({
    type: 'ov-splat-error',
    error: 'CSP blocked ' + e.violatedDirective + ' ' + (e.blockedURI || ''),
  })
);
addEventListener(
  'error',
  (e) =>
    post({
      type: 'ov-splat-error',
      error: 'error: ' + (e.message || (e.error && e.error.message) || e.filename || ''),
    }),
  true
);
addEventListener('unhandledrejection', (e) =>
  post({
    type: 'ov-splat-error',
    error: 'reject: ' + ((e.reason && e.reason.message) || e.reason || ''),
  })
);
