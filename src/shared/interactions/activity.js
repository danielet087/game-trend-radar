export function createActivity({ insights: I, storage, motion, helpers }) {
const { make } = helpers;
  const ticker = document.getElementById("activityTicker");
  if (!ticker) return;
  const viewport = document.getElementById("activityViewport");
  const track = document.getElementById("activityTrack");
  const pause = document.getElementById("activityPause");
  const open = document.getElementById("activityMore");
  const dialog = document.getElementById("activityDialog");
  const list = document.getElementById("activityList");
  open.disabled = true;
  let manualPause = false, events = [], featured = [], current = 0, timer = null, flip = null;
  const dateLabel = value => String(value || "").replaceAll("-", "/");
  function eventLink(event, clone = false) {
    const a = make("a", "activity-item");
    a.href = I.activityURL(event);
    const addedDay = I.taipeiDay(event.at);
    const added = make("time", "activity-added-at", addedDay ? dateLabel(addedDay) : "日期未提供");
    if (addedDay) added.dateTime = addedDay;
    added.title = "這則動態的新增日期（台灣時間）";
    const type = make("span", "activity-kind " + (event.type === "added" ? "is-new" : "is-date"),
      event.type === "added" ? "新收錄" : event.type === "platform_added" ? "新增平台" : "日期更新");
    a.append(added, type);
    if (event.source === "nintendo") a.append(make("span", "activity-kind", I.activityPlatform(event)));
    a.append(make("span", "activity-name", event.name));
    if (event.type === "release_date") a.append(make("span", "activity-change", `${dateLabel(event.previous_date)} → ${dateLabel(event.date)}`));
    else a.append(make("span", "activity-change", dateLabel(event.date) + " 上市"));
    a.title = [...a.children].map(child => child.textContent).join(" · ");
    a.setAttribute("aria-label", a.title);
    if (clone) { a.tabIndex = -1; a.setAttribute("aria-hidden", "true"); }
    return a;
  }
  function cancelFlip() {
    if (!flip) return;
    const animation = flip;
    flip = null;
    animation.cancel();
    track.lastElementChild?.remove();
  }
  function canFlip() {
    return !!motion?.enabled && featured.length > 1 && typeof track.animate === "function" &&
      !manualPause && !document.hidden && !dialog.open && !ticker.matches(":hover, :focus-within");
  }
  function schedule() {
    clearTimeout(timer);
    timer = canFlip() && !flip ? setTimeout(advance, 4500) : null;
  }
  function advance() {
    if (!canFlip()) { schedule(); return; }
    const next = (current + 1) % featured.length;
    track.append(eventLink(featured[next], true));
    const animation = track.animate([
      { transform: "translateY(0)" },
      { transform: `translateY(-${viewport.clientHeight}px)` },
    ], { duration: 460, easing: "cubic-bezier(.22,1,.36,1)" });
    flip = animation;
    animation.finished.then(() => {
      if (flip !== animation) return;
      flip = null;
      current = next;
      track.replaceChildren(eventLink(featured[current]));
      schedule();
    }, () => {});
  }
  function motion() {
    const animated = !!motion?.enabled && featured.length > 1 && typeof track.animate === "function";
    ticker.classList.toggle("ticker-static", !animated);
    ticker.classList.toggle("ticker-paused", manualPause);
    pause.disabled = !animated;
    pause.setAttribute("aria-pressed", String(manualPause || !animated));
    pause.setAttribute("aria-label", manualPause || !animated ? "播放雷達動態" : "暫停雷達動態");
    pause.textContent = manualPause || !animated ? "▶" : "Ⅱ";
    if (!canFlip()) cancelFlip();
    schedule();
  }
  pause.addEventListener("click", () => { manualPause = !manualPause; motion(); });
  document.addEventListener("radar:motionchange", motion);
  ticker.addEventListener("mouseenter", motion);
  ticker.addEventListener("mouseleave", motion);
  ticker.addEventListener("focusin", motion);
  ticker.addEventListener("focusout", () => queueMicrotask(motion));
  document.addEventListener("visibilitychange", () => { ticker.classList.toggle("ticker-background", document.hidden); motion(); });
  open.addEventListener("click", () => { dialog.showModal(); ticker.classList.add("ticker-reading"); motion(); });
  document.getElementById("activityClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { ticker.classList.remove("ticker-reading"); open.focus({ preventScroll: true }); motion(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  async function loadActivity() {
    const data = await storage.readJSON("./data/activity.json", value => value?.version === 1 && Array.isArray(value.events));
    events = I.activityEvents(data?.events);
    if (!events.length) {
      track.replaceChildren(make("span", "activity-empty", data ? "近期沒有新收錄、發售日期或平台異動。" : "更新動態暫時無法讀取。"));
      open.hidden = true; pause.hidden = true; motion(); return;
    }
    featured = events.slice(0, 8);
    track.replaceChildren(eventLink(featured[current]));
    open.disabled = false;
    list.replaceChildren(...events.map(event => {
      const item = make("li");
      item.append(eventLink(event));
      return item;
    }));
    motion();
  }
  loadActivity();
}
