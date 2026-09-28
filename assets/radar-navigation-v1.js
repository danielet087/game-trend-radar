/* Native disclosure navigation works without data requests or JavaScript. */
(() => {
  "use strict";
  const disclosure = document.querySelector(".explore-nav");
  if (!disclosure) return;
  const toggle = disclosure.querySelector("summary");
  const links = Array.from(disclosure.querySelectorAll(".explore-route"));

  document.addEventListener("pointerdown", event => {
    if (!disclosure.contains(event.target)) disclosure.open = false;
  });
  disclosure.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!disclosure.contains(document.activeElement)) disclosure.open = false;
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !disclosure.open) return;
    event.preventDefault();
    event.stopPropagation();
    disclosure.open = false;
    toggle.focus();
  }, true);
  disclosure.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = links.indexOf(document.activeElement);
    let next;
    if (event.key === "ArrowDown") next = (index + 1) % links.length;
    else if (event.key === "ArrowUp") next = index <= 0 ? links.length - 1 : index - 1;
    else if (index >= 0 && event.key === "Home") next = 0;
    else if (index >= 0 && event.key === "End") next = links.length - 1;
    else return;
    event.preventDefault();
    disclosure.open = true;
    links[next].focus();
  });
  // Tab, Enter and modified link clicks retain their native browser behavior.
  window.addEventListener("pageshow", () => { disclosure.open = false; });
})();
