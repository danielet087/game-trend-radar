'use strict';
// A small DOM for page-module tests: enough for the shipped modules and for
// Vue's runtime-dom, while keeping the shapes older assertions read
// (`children` arrays, `attributes[name]`, `listeners[type]`, raw `href`).

const REFLECTED = { id: 'id', href: 'href', src: 'src', alt: 'alt', title: 'title', type: 'type', role: 'role',
  tabindex: 'tabIndex', for: 'htmlFor', name: 'name', target: 'target', rel: 'rel', datetime: 'dateTime', lang: 'lang' };
const BOOLEAN = new Set(['hidden', 'disabled', 'open', 'checked', 'selected']);
const camel = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class FakeNode {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() {
    const siblings = this.parentNode ? this.parentNode.childNodes : [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get previousSibling() {
    const siblings = this.parentNode ? this.parentNode.childNodes : [];
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }
  insertBefore(node, reference) {
    if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.insertBefore(child, reference); return node; }
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    node.parentNode = this;
    if (index < 0) this.childNodes.push(node); else this.childNodes.splice(index, 0, node);
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
}

class FakeText extends FakeNode {
  constructor(text = '') { super(); this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = String(text); }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value ?? ''); }
  get data() { return this.nodeValue; }
  set data(value) { this.nodeValue = String(value ?? ''); }
}

class FakeComment extends FakeText {
  constructor(text = '') { super(text); this.nodeType = 8; this.nodeName = '#comment'; }
  get textContent() { return ''; }
}

class FakeFragment extends FakeNode {
  constructor() { super(); this.nodeType = 11; this.nodeName = '#document-fragment'; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'object' && node ? node : new FakeText(node)); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
}

function compound(selector) {
  const parts = { tag: null, id: null, classes: [], attributes: [] };
  const rest = selector.replace(/\[([^\]=]+)(?:="([^"]*)")?\]/g, (_, name, value) => { parts.attributes.push([name, value]); return ''; });
  for (const token of rest.match(/[#.]?[^#.]+/g) || []) {
    if (token[0] === '#') parts.id = token.slice(1);
    else if (token[0] === '.') parts.classes.push(token.slice(1));
    else parts.tag = token.toLowerCase();
  }
  return parts;
}
function matchesCompound(element, parts) {
  if (element.nodeType !== 1) return false;
  if (parts.tag && element.tagName.toLowerCase() !== parts.tag) return false;
  if (parts.id && element.id !== parts.id) return false;
  const classes = String(element.className || '').split(/\s+/);
  if (parts.classes.some(name => !classes.includes(name))) return false;
  return parts.attributes.every(([name, value]) => {
    const actual = element.getAttribute(name);
    return actual !== null && (value === undefined || actual === value);
  });
}
function matchesSelector(element, selector) {
  return selector.split(',').some(alternative => {
    const chain = alternative.trim().split(/\s+/).map(compound);
    if (!chain.length || !matchesCompound(element, chain[chain.length - 1])) return false;
    let ancestor = element.parentElement;
    for (let index = chain.length - 2; index >= 0; index--) {
      while (ancestor && !matchesCompound(ancestor, chain[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

class FakeStyle {
  setProperty(name, value) { this[camel(name)] = String(value); }
  removeProperty(name) { delete this[camel(name)]; }
  getPropertyValue(name) { return this[camel(name)] || ''; }
}

class FakeElement extends FakeNode {
  constructor(tag = 'div', namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super();
    this.nodeType = 1; this.tagName = tag; this.nodeName = String(tag).toUpperCase(); this.namespaceURI = namespaceURI;
    this.attributes = {}; this.dataset = {}; this.style = new FakeStyle(); this.listeners = {}; this._listeners = {};
    // Link and media properties stay undefined until code sets them, like the older test DOMs.
    this.className = ''; this.id = ''; this.hidden = false; this.disabled = false;
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const children = this.children; return children[children.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); const text = String(value ?? ''); if (text) this.appendChild(new FakeText(text)); }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  get innerHTML() { return this.childNodes.length ? this.textContent : ''; }
  set innerHTML(value) {
    if (String(value ?? '') !== '') throw new Error('The fake DOM does not parse HTML; build nodes instead.');
    this.replaceChildren();
  }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'object' && node ? node : new FakeText(node)); }
  prepend(...nodes) { const first = this.firstChild; for (const node of nodes) this.insertBefore(typeof node === 'object' && node ? node : new FakeText(node), first); }
  replaceChildren(...nodes) { for (const child of [...this.childNodes]) this.removeChild(child); this.append(...nodes); }
  replaceWith(...nodes) { const parent = this.parentNode; if (!parent) return; for (const node of nodes) parent.insertBefore(node, this); parent.removeChild(this); }
  setAttribute(name, value) {
    const key = String(name).toLowerCase(), text = String(value);
    this.attributes[key] = text;
    if (key === 'class') this.className = text;
    else if (key.startsWith('data-')) this.dataset[camel(key.slice(5))] = text;
    else if (BOOLEAN.has(key)) this[key] = true;
    else if (REFLECTED[key]) this[REFLECTED[key]] = key === 'tabindex' ? Number(text) : text;
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (key === 'class') return this.className || null;
    if (key === 'id') return this.id || null;
    if (key.startsWith('data-') && this.dataset[camel(key.slice(5))] !== undefined) return String(this.dataset[camel(key.slice(5))]);
    return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) {
    const key = String(name).toLowerCase();
    delete this.attributes[key];
    if (key === 'class') this.className = '';
    else if (key.startsWith('data-')) delete this.dataset[camel(key.slice(5))];
    else if (BOOLEAN.has(key)) this[key] = false;
  }
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : force;
    if (on) this.setAttribute(name, ''); else this.removeAttribute(name);
    return on;
  }
  get classList() {
    const read = () => String(this.className || '').split(/\s+/).filter(Boolean);
    const write = values => { this.className = [...new Set(values)].join(' '); };
    return {
      add: (...names) => write([...read(), ...names]),
      remove: (...names) => write(read().filter(name => !names.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !read().includes(name) : force;
        write(on ? [...read(), name] : read().filter(value => value !== name));
        return on;
      },
      contains: name => read().includes(name),
    };
  }
  addEventListener(type, listener) {
    (this._listeners[type] ||= []).push(listener);
    this.listeners[type] = listener;
  }
  removeEventListener(type, listener) {
    const list = (this._listeners[type] || []).filter(item => item !== listener);
    this._listeners[type] = list;
    if (list.length) this.listeners[type] = list[list.length - 1]; else delete this.listeners[type];
  }
  dispatchEvent(event) {
    for (const listener of [...(this._listeners[event.type] || [])]) listener.call(this, event);
    return !event.defaultPrevented;
  }
  click() { this.dispatchEvent({ type: 'click', target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; } }); }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => { for (const child of node.childNodes) { if (child.nodeType === 1) { if (child.matches(selector)) found.push(child); visit(child); } } };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {} blur() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  showModal() { this.open = true; }
  show() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: 'close', target: this, currentTarget: this }); }
}

function createDocument(extra = {}) {
  const document = {
    nodeType: 9, referrer: '', title: '', hidden: false, listeners: {},
    body: new FakeElement('body'), documentElement: new FakeElement('html'),
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag, namespace),
    createTextNode: text => new FakeText(text),
    createComment: text => new FakeComment(text),
    createDocumentFragment: () => new FakeFragment(),
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  };
  return document;
}

// Globals Vue's runtime-dom checks with `instanceof` or `typeof`.
const vueGlobals = { SVGElement: class SVGElement {}, Element: FakeElement, Node: FakeNode, Text: FakeText };

module.exports = { FakeNode, FakeText, FakeComment, FakeFragment, FakeElement, createDocument, vueGlobals };
