(() => {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let installPrompt = null;
  const setup = () => {
    const btn = document.getElementById('install-app');
    if (!btn) return;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); installPrompt = e; btn.hidden = false;
    });
    btn.addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null; btn.hidden = true;
    });
    window.addEventListener('appinstalled', () => { btn.hidden = true; installPrompt = null; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
