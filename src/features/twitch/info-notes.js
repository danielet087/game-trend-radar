// The ⓘ buttons beside headings: each opens the note named by its
// aria-controls; opening one closes the others, and a click elsewhere or
// Escape closes them.

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5.5"></path><path d="M12 7.6v.1"></path></svg>';

/** A heading with an ⓘ button and its note (one paragraph per line). */
export function infoHeading(tag, title, { id, label, lines, className = '' }) {
  const wrap = document.createElement('div');
  wrap.className = `tw-info-anchor ${className}`.trim();
  const heading = document.createElement(tag);
  heading.textContent = title;
  heading.id = `${id}Title`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tw-info';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.innerHTML = ICON;
  const note = document.createElement('div');
  note.className = 'tw-info-note';
  note.id = id;
  note.setAttribute('role', 'note');
  note.hidden = true;
  setInfoLines(note, lines);
  wrap.append(heading, button, note);
  return { wrap, heading, button, note };
}

/** Replace a note's lines; a line is text or a node. */
export function setInfoLines(note, lines) {
  note.replaceChildren(...lines.filter(Boolean).map(line => {
    if (line instanceof Node) return line;
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    return paragraph;
  }));
}

function close(root, except) {
  for (const button of root.querySelectorAll('.tw-info[aria-expanded="true"]')) {
    if (button === except) continue;
    button.setAttribute('aria-expanded', 'false');
    const note = document.getElementById(button.getAttribute('aria-controls'));
    if (note) note.hidden = true;
  }
}

/** Open and close the notes under `root` until `signal` aborts. */
export function bindInfoNotes(root, signal) {
  document.addEventListener('click', event => {
    const button = event.target.closest?.('.tw-info');
    if (button && root.contains(button)) {
      const note = document.getElementById(button.getAttribute('aria-controls'));
      const open = button.getAttribute('aria-expanded') !== 'true';
      close(root, button);
      button.setAttribute('aria-expanded', String(open));
      if (note) note.hidden = !open;
      return;
    }
    if (!event.target.closest?.('.tw-info-note')) close(root);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = root.querySelector('.tw-info[aria-expanded="true"]');
    if (!open) return;
    close(root);
    open.focus();
  }, { signal });
}
