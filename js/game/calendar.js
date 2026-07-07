const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function fmtDate(epoch, di) {
  const d = new Date(epoch); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + di);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function diToISO(epoch, di) {
  const d = new Date(epoch); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + di);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function renderCalendarHTML(epoch, dayIndex, statusFor) {
  const start = new Date(epoch); start.setHours(0, 0, 0, 0);
  const now = new Date();
  let y = start.getFullYear(), m = start.getMonth();
  const endY = now.getFullYear(), endM = now.getMonth();
  let html = `<div class="cal-dow">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("")}</div>`;
  while (y < endY || (y === endY && m <= endM)) {
    html += `<div class="cal-month">${MONTHS[m]} ${y}</div><div class="cal-grid">`;
    const lead = new Date(y, m, 1).getDay();
    for (let i = 0; i < lead; i++) html += `<span class="cal-cell blank"></span>`;
    const days = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const cd = new Date(y, m, d); cd.setHours(0, 0, 0, 0);
      const di = dayIndex(cd);
      let cls = "cal-cell", click = false;
      if (di < 0) cls += " blank";
      else { const st = statusFor(di); cls += " " + st; click = st !== "future"; }
      html += `<button class="${cls}" ${click ? `data-di="${di}"` : "disabled"}>${di < 0 ? "" : d}</button>`;
    }
    html += `</div>`;
    m++; if (m > 11) { m = 0; y++; }
  }
  return html;
}
