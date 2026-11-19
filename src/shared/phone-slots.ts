/**
 * Phones (≤ 800px) sometimes need a control in another row: the calendar's
 * view switch beside the result count, Twitch's sort beside its result count.
 * Elements marked data-phone-before / data-phone-after="<selector>" move next
 * to that element on phones and back to their own place on wider screens, so
 * the reading and focus order always match what is on screen.
 *
 * Until the move happens they stay hidden on phones (.phone-placed in CSS),
 * so nothing jumps when the script runs. Listeners and ids travel with them.
 */
export const PHONE_QUERY = '(max-width: 800px)';
const SLOTTED = '[data-phone-before], [data-phone-after]';

interface Slot { node: HTMLElement; marker: Comment; reference: Element; before: boolean }

export function mountPhoneSlots(root: ParentNode = document, options: { media?: MediaQueryList; signal?: AbortSignal } = {}) {
  // Without a browser layout (unit tests, prerendering) everything stays put.
  const query = options.media || (typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null);
  if (!query) return { dispose() {} };
  const media: MediaQueryList = query;
  const slots: Slot[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(SLOTTED)) {
    const before = node.dataset.phoneBefore !== undefined;
    const reference = document.querySelector(before ? node.dataset.phoneBefore! : node.dataset.phoneAfter!);
    if (!reference || reference === node || node.contains(reference)) continue;
    const marker = document.createComment('phone-slot');
    node.before(marker);
    slots.push({ node, marker, reference, before });
  }
  let phone: boolean | null = null;
  function place() {
    if (phone === media.matches) return;
    phone = media.matches;
    for (const slot of slots) {
      if (!phone) slot.marker.after(slot.node);
      else if (slot.before) slot.reference.before(slot.node);
      else slot.reference.after(slot.node);
      slot.node.classList.toggle('phone-placed', phone);
    }
  }
  media.addEventListener('change', place, { signal: options.signal });
  place();
  return {
    dispose() {
      media.removeEventListener('change', place);
      for (const slot of slots) { slot.marker.after(slot.node); slot.marker.remove(); slot.node.classList.remove('phone-placed'); }
    },
  };
}
