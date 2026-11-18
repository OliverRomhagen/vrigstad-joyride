// Shared by the browser regression tests; attach before navigation.
export function watchErrors(page) {
  const errors = [];
  page.on('console', m => {
    if (m.type() !== 'error' && !/WebGL.*(error|INVALID|lost)|GL_INVALID|THREE.WebGLProgram/i.test(m.text())) return;
    const url = m.location().url;
    if (m.text().startsWith('Failed to load resource') && url && new URL(url).origin !== new URL(page.url()).origin) return;
    errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}
