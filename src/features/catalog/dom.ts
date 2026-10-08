export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text: string | number | null = null): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}
export function createNotifier() {
  let timer: ReturnType<typeof setTimeout>;
  return (message: string) => {
    const toast = element('toast');
    if (!toast) return;
    toast.textContent = message; toast.classList.add('visible');
    clearTimeout(timer); timer = setTimeout(() => toast.classList.remove('visible'), 3200);
  };
}
export function emptyState(mode: string, title: string, text: string,
  action: {label: string; run: () => void} | null = null) {
  const area = node('div', 'empty-state');
  const symbol = window.RadarEnhancements?.illustration(mode === 'explore' ? 'tags' : mode === 'released' ? 'rocket' : 'calendar') || node('span', 'empty-symbol', '◎');
  symbol.setAttribute('aria-hidden', 'true');
  const copy = node('div'); copy.append(node('h3', '', title), node('p', '', text));
  area.append(symbol, copy);
  if (action) { const button = node('button', 'button secondary', action.label); button.addEventListener('click', action.run); area.append(button); }
  return area;
}
export function detailLink(game: any, domain: any, className = '', name = game.name) {
  const link = node('a', className) as HTMLAnchorElement;
  link.href = domain.detailURL(game); link.setAttribute('aria-label', `查看 ${name} 的遊戲資訊`);
  return link;
}
