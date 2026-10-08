export function createHelpers(motion) {
  const make = (tag, className = "", text = null) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== null) el.textContent = text;
    return el;
  };
  const shapes = {
    calendar: '<rect x="13" y="18" width="49" height="47" rx="10"/><path d="M13 33h49M26 12v13m22-13v13M27 47h8m-8 10h8"/><circle cx="59" cy="58" r="15"/><path d="m53 58 5 5 8-10"/>',
    rocket: '<path d="m24 49 3-15 26-20 13 13-20 26-15 3-7-7Z"/><circle cx="50" cy="30" r="6"/><path d="m29 56-5 13-2-11-11-2 13-6M43 20l-17-1-9 16 12-1m31 12 1 17-16 9 1-19"/>',
    tags: '<path d="m13 37 27-24 24 4 4 24-27 27-28-31Z"/><circle cx="52" cy="28" r="5"/><path d="m25 40 12 13m-5-20 13 13M13 17l-4-6m55 48 7 2M49 72l1 5"/>',
  };
  function illustration(kind = "calendar") {
    const el = make("span", "empty-illustration illustration-" + kind);
    el.setAttribute("aria-hidden", "true");
    // Constant original drawings; never insert game data as markup.
    el.innerHTML = `<svg viewBox="0 0 80 80">${shapes[kind] || shapes.calendar}</svg>`;
    return el;
  }
  function pulseSaved() {
    if (!motion?.enabled) return;
    document.querySelectorAll("[data-saved-count]").forEach(el => {
      el.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.25)", background: "#d7efd6" }, { transform: "scale(1)" }], { duration: 280 });
    });
  }

return {make, illustration, pulseSaved};
}
