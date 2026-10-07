// Show startup failures on the headset itself, where a desktop console is absent.
function report(message) {
  const el = document.getElementById('booterror');
  if (!el) return;
  el.textContent = '실행 오류: ' + message;
  el.style.display = 'block';
  el.style.whiteSpace = 'pre-wrap';
}
window.addEventListener('error', event => report(event.message || '파일을 불러오지 못했습니다.'));
window.addEventListener('unhandledrejection', event => report(event.reason?.stack || event.reason?.message || String(event.reason)));
