export async function renderNotifySettings() {
  const note = document.querySelector("#notify-note");
  const newT = document.querySelector("#set-notify-new"), beforeT = document.querySelector("#set-notify-before");
  if (!note || !newT || !beforeT) return;
  const o = window.ZOZDLE_ONLINE;
  const disable = (msg) => { newT.disabled = beforeT.disabled = true; newT.checked = beforeT.checked = false; note.textContent = msg; };
  if (!o || !o.enabled) return disable("Notifications aren't available.");
  if (!o.pushSupported) return disable("This browser doesn't support notifications.");
  if (!o.user) return disable("Sign in to turn on notifications.");
  newT.disabled = beforeT.disabled = false;
  note.textContent = "";
  try {
    const prefs = await o.loadNotifyPrefs();
    newT.checked = !!prefs.notify_new;
    beforeT.checked = !!prefs.notify_before;
  } catch { note.textContent = "Couldn't load your notification settings."; }
}

export async function onNotifyToggle(field, el, toast) {
  const o = window.ZOZDLE_ONLINE;
  if (!o || !o.user) { el.checked = false; toast("Sign in to turn on notifications", true); return; }
  if (el.checked) {
    const ok = await o.enablePush();
    if (!ok) { el.checked = false; toast("Allow notifications in your browser first", true); return; }
    const r = await o.setNotifyPref({ [field]: true });
    if (r.error) { el.checked = false; toast("Couldn't save", true); }
    else toast("Notifications on ✦");
  } else {
    const r = await o.setNotifyPref({ [field]: false });
    if (r.error) { el.checked = true; toast("Couldn't save", true); }
  }
}
