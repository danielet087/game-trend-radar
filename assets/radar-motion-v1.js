/* A shared motion preference for the calendar, lists and game profile. */
(() => {
  "use strict";
  const key = "game-trend-radar:motion:v2";
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let preference = "on";
  try {
    preference = localStorage.getItem(key) || "on";
  } catch {}
  const motion = { enabled: preference !== "off" && !media.matches };
  window.RadarMotion = motion;
  const button = document.getElementById("motionToggle");
  function update() {
    motion.enabled = preference !== "off" && !media.matches;
    document.body.classList.toggle("motion-on", motion.enabled);
    document.body.classList.toggle("motion-off", !motion.enabled);
    document.documentElement.style.scrollBehavior = motion.enabled
      ? "smooth"
      : "auto";
    if (button) {
      button.disabled = media.matches;
      button.setAttribute("aria-pressed", String(motion.enabled));
      button.setAttribute(
        "aria-label",
        media.matches
          ? "裝置已設定減少動態效果"
          : motion.enabled
            ? "關閉動態效果"
            : "開啟動態效果",
      );
      button.title = button.getAttribute("aria-label");
      button.querySelector("span").textContent = motion.enabled
        ? "動態 ON"
        : "動態 OFF";
      button
        .querySelector("path")
        .setAttribute(
          "d",
          motion.enabled ? "M9 5v14M15 5v14" : "m8 5 11 7-11 7Z",
        );
    }
    if (!motion.enabled)
      document.getAnimations?.().forEach((animation) => animation.cancel());
    document.dispatchEvent(new Event("radar:motionchange"));
  }
  button?.addEventListener("click", () => {
    if (media.matches) return;
    preference = motion.enabled ? "off" : "on";
    try {
      localStorage.setItem(key, preference);
    } catch {}
    update();
  });
  media.addEventListener?.("change", update);
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      preference = event.newValue || "on";
      update();
    }
  });
  update();
})();
