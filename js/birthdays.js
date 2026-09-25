/*
 * Grandma AI — birthdays and birthday cards.
 *
 * Grandma remembers birthdays (from chat, or added by hand in the Planner),
 * reminds you the day before and on the day, and makes a birthday card:
 * pick a design, let Grandma write the message, then save or share it as an
 * image. Cards are drawn on a <canvas>, so they work offline.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const pad = (n) => String(n).padStart(2, "0");
  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ---------------- birthdays ---------------- */
  const Birthdays = {
    list: () => Store.list("birthdays"),

    /* Save (or update, by name) a birthday. month is 1-12. */
    add({ name, month, day, year, relation }) {
      name = String(name || "").trim();
      month = Number(month);
      day = Number(day);
      if (!name || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
      const y = Number(year) >= 1900 && Number(year) <= new Date().getFullYear() ? Number(year) : null;
      const existing = Birthdays.list().find((b) => b.name.toLowerCase() === name.toLowerCase());
      const data = { name, month, day, year: y || (existing && existing.year) || null, relation: String(relation || (existing && existing.relation) || "").trim() };
      if (!existing) return Store.add("birthdays", data);
      Store.update("birthdays", existing.id, data);
      return { ...existing, ...data };
    },

    find: (name) => {
      const n = String(name || "").toLowerCase().trim();
      return Birthdays.list().find((b) => b.name.toLowerCase() === n) || Birthdays.list().find((b) => n && (b.name.toLowerCase().includes(n) || n.includes(b.name.toLowerCase())));
    },

    /* The next date this birthday falls on (YYYY-MM-DD), today included. */
    next(b) {
      const today = U.today();
      const y = Number(today.slice(0, 4));
      let d = `${y}-${pad(b.month)}-${pad(b.day)}`;
      if (d < today) d = `${y + 1}-${pad(b.month)}-${pad(b.day)}`;
      return d;
    },
    daysUntil: (b) => Math.round((U.parseKey(Birthdays.next(b)) - U.parseKey(U.today())) / 86400000),
    turning: (b) => (b.year ? Number(Birthdays.next(b).slice(0, 4)) - b.year : null),
    dateText: (b) => `${MONTHS[b.month - 1]} ${b.day}`,

    upcoming(days = 30) {
      return Birthdays.list()
        .map((b) => ({ ...b, in: Birthdays.daysUntil(b) }))
        .filter((b) => b.in <= days)
        .sort((a, b) => a.in - b.in);
    },
    on: (date) => Birthdays.list().filter((b) => date.slice(5) === `${pad(b.month)}-${pad(b.day)}`),

    whenText(b) {
      const n = Birthdays.daysUntil(b);
      return n === 0 ? "today! 🎉" : n === 1 ? "tomorrow" : n < 7 ? `in ${n} days` : `on ${Birthdays.dateText(b)}`;
    },

    /* For Grandma's context: who's coming up. */
    contextLine() {
      const up = Birthdays.upcoming(45);
      if (!up.length) return "";
      return "Birthdays coming up (name | date | turning): " + up.map((b) => `${b.name}${b.relation ? " (" + b.relation + ")" : ""} | ${Birthdays.dateText(b)}${b.in === 0 ? " — today" : b.in === 1 ? " — tomorrow" : ""} | ${Birthdays.turning(b) || "?"}`).join("; ");
    },
  };

  /* ---------------- card designs ---------------- */
  const STYLES = {
    classic: { label: "Classic", emoji: "🎂", bg: ["#fdf6ec", "#f6e7cf"], ink: "#4a3527", accent: "#b8894a", font: "Georgia, 'Times New Roman', serif" },
    floral: { label: "Floral", emoji: "🌸", bg: ["#fdecef", "#f7d6de"], ink: "#6b2f45", accent: "#d86b8c", font: "Georgia, 'Times New Roman', serif" },
    party: { label: "Party", emoji: "🎉", bg: ["#2b2350", "#4b2f6e"], ink: "#fff8e8", accent: "#ffd166", font: "'Inter', system-ui, sans-serif" },
    balloons: { label: "Balloons", emoji: "🎈", bg: ["#e8f4ff", "#fff4d6"], ink: "#23405e", accent: "#ff6b6b", font: "'Inter', system-ui, sans-serif" },
  };

  function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text).split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  /* Draw a card onto a canvas (1080 × 1350, portrait). */
  function draw(canvas, { name, message, from, style = "classic", age }) {
    const S = STYLES[style] || STYLES.classic;
    const W = 1080;
    const H = 1350;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, S.bg[0]);
    g.addColorStop(1, S.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Decorations
    let seed = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 7);
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    if (style === "party") {
      const colors = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#f78c6b"];
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, 6 + rand() * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (style === "floral") {
      ctx.font = "90px serif";
      ["🌸", "🌷", "🌼"].forEach((f, i) => {
        ctx.fillText(f, 40 + i * 70, 130 + (i % 2) * 40);
        ctx.fillText(f, W - 250 + i * 70, H - 60 - (i % 2) * 40);
      });
    } else if (style === "balloons") {
      ctx.font = "120px serif";
      ctx.fillText("🎈", 60, 170);
      ctx.fillText("🎈", W - 190, 230);
      ctx.fillText("🎁", W - 200, H - 70);
    } else {
      ctx.strokeStyle = S.accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(40, 40, W - 80, H - 80);
      ctx.lineWidth = 2;
      ctx.strokeRect(58, 58, W - 116, H - 116);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "170px serif";
    ctx.fillText(S.emoji, W / 2, 330);

    ctx.fillStyle = S.accent;
    ctx.font = `600 64px ${S.font}`;
    ctx.fillText(age ? `Happy ${ordinal(age)} Birthday` : "Happy Birthday", W / 2, 450);

    ctx.fillStyle = S.ink;
    let size = 110;
    ctx.font = `700 ${size}px ${S.font}`;
    while (ctx.measureText(name).width > W - 160 && size > 50) ctx.font = `700 ${(size -= 6)}px ${S.font}`;
    ctx.fillText(name, W / 2, 580);

    ctx.font = `400 46px ${S.font}`;
    const lines = wrap(ctx, message, W - 220).slice(0, 10);
    const top = 700;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * 64));

    if (from) {
      ctx.font = `italic 48px ${S.font}`;
      ctx.fillStyle = S.accent;
      ctx.fillText(`With love, ${from}`, W / 2, Math.max(top + lines.length * 64 + 90, H - 170));
    }
    return canvas;
  }

  const previewCache = new Map();
  /* A small image of a card, for chat bubbles. */
  function preview(card) {
    const key = JSON.stringify([card.name, card.message, card.from, card.style, card.age]);
    if (!previewCache.has(key)) previewCache.set(key, draw(document.createElement("canvas"), card).toDataURL("image/png"));
    return previewCache.get(key);
  }

  async function share(card) {
    const canvas = draw(document.createElement("canvas"), card);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const file = new File([blob], `birthday-card-${card.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Happy Birthday, ${card.name}!` });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    U.toast("Card saved to your downloads 🎂");
  }

  /* Messages for when Grandma's AI is off. */
  const TEMPLATES = [
    (n) => `Happy birthday, ${n}! Wishing you a year full of good food, warm hugs, and plenty of reasons to laugh. You deserve every bit of it.`,
    (n) => `${n}, I hope your birthday is as sweet as a fresh-baked pie and just as warm. Here's to another wonderful year!`,
    (n) => `Happy birthday, dear ${n}! May this year bring you health, happiness, and at least one really good slice of cake.`,
  ];

  async function writeMessage({ name, relation, age, tone = "warm" }) {
    const b = Birthdays.find(name);
    const facts = Store.list("memory").map((m) => m.fact).filter((f) => f.toLowerCase().includes(String(name).toLowerCase())).slice(0, 4);
    const instruction = `Write the message inside a birthday card for ${name}${relation ? ` (my ${relation})` : b && b.relation ? ` (my ${b.relation})` : ""}${age ? `, who is turning ${age}` : ""}. Tone: ${tone}. 2-4 sentences, personal and heartfelt, the kind of thing a loving grandma would write. Don't sign it.${facts.length ? " Things I know about them: " + facts.join("; ") + "." : ""}`;
    if (GA.AI.connected()) {
      try {
        const text = await GA.AI.compose({ instruction });
        if (text && text.length > 20) return text.replace(/^["“]|["”]$/g, "");
      } catch (e) { /* fall back to a classic */ }
    }
    return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)](name);
  }

  /* ---------------- card maker ---------------- */
  function openCardMaker(start = {}) {
    const b = start.name ? Birthdays.find(start.name) : null;
    const card = {
      name: start.name || "",
      message: start.message || "",
      from: start.from != null ? start.from : Store.doc("profile").name || "",
      style: STYLES[start.style] ? start.style : "classic",
      age: start.age || (b && Birthdays.turning(b)) || null,
    };
    U.openSheet({
      title: "Birthday card",
      wide: true,
      body: `<form class="card-maker" id="card-maker">
          <div class="cm-preview"><canvas aria-label="Card preview"></canvas></div>
          <div class="cm-fields">
            <label class="field"><span>Who's it for?</span><input class="input" name="name" value="${U.esc(card.name)}" placeholder="Mom, Aunt June, Leo…" maxlength="40" required></label>
            <div class="field"><span>Design</span><div class="cm-styles">${Object.entries(STYLES).map(([k, s]) => `<button type="button" class="chip ${k === card.style ? "on" : ""}" data-style="${k}">${s.emoji} ${s.label}</button>`).join("")}</div></div>
            <label class="field"><span>Message</span><textarea class="input" name="message" rows="5" maxlength="400" placeholder="Grandma can write this for you">${U.esc(card.message)}</textarea></label>
            <button type="button" class="btn ghost small" data-write>${U.icon("sparkle")}${card.message ? "Write another" : "Have Grandma write it"}</button>
            <div class="field-row">
              <label class="field"><span>From</span><input class="input" name="from" value="${U.esc(card.from)}" maxlength="40"></label>
              <label class="field"><span>Turning (optional)</span><input class="input" type="number" name="age" min="1" max="120" value="${card.age || ""}"></label>
            </div>
            <div class="sheet-actions split"><button type="button" class="btn ghost" data-close>Close</button><button class="btn primary">${U.icon("upload")}Save or share</button></div>
          </div>
        </form>`,
      onMount(sheet) {
        const f = sheet.querySelector("#card-maker");
        const canvas = f.querySelector("canvas");
        const read = () => {
          card.name = f.name.value.trim() || "You";
          card.message = f.message.value.trim();
          card.from = f.from.value.trim();
          card.age = Number(f.age.value) || null;
        };
        const redraw = () => {
          read();
          draw(canvas, card);
        };
        const write = async () => {
          const btn = f.querySelector("[data-write]");
          read();
          if (!f.name.value.trim()) return f.name.focus();
          btn.disabled = true;
          btn.innerHTML = `${U.icon("refresh", "spin")}Grandma is writing…`;
          f.message.value = await writeMessage({ name: card.name, age: card.age });
          btn.disabled = false;
          btn.innerHTML = `${U.icon("sparkle")}Write another`;
          redraw();
        };
        f.addEventListener("input", U.debounce(redraw, 150));
        f.addEventListener("click", (e) => {
          const st = e.target.closest("[data-style]");
          if (st) {
            card.style = st.dataset.style;
            f.querySelectorAll("[data-style]").forEach((x) => x.classList.toggle("on", x === st));
            redraw();
          }
          if (e.target.closest("[data-write]")) write();
        });
        f.onsubmit = (e) => {
          e.preventDefault();
          read();
          if (!card.message) card.message = TEMPLATES[0](card.name);
          share({ ...card });
        };
        redraw();
        if (!card.message && card.name) write();
      },
    });
  }

  /* ---------------- add / edit a birthday ---------------- */
  function openEditor(id) {
    const b = id ? Store.find("birthdays", id) : null;
    U.openSheet({
      title: b ? "Edit birthday" : "Add a birthday",
      body: `<form id="bday-form">
          <label class="field"><span>Name</span><input class="input" name="name" value="${U.esc(b ? b.name : "")}" required maxlength="40" placeholder="Mom"></label>
          <div class="field-row">
            <label class="field"><span>Month</span><select class="select" name="month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${b && b.month === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
            <label class="field"><span>Day</span><input class="input" type="number" name="day" min="1" max="31" required value="${b ? b.day : ""}"></label>
            <label class="field"><span>Year (optional)</span><input class="input" type="number" name="year" min="1900" max="${new Date().getFullYear()}" value="${b && b.year ? b.year : ""}"></label>
          </div>
          <label class="field"><span>Who are they to you? (optional)</span><input class="input" name="relation" value="${U.esc(b ? b.relation || "" : "")}" maxlength="30" placeholder="mother, best friend, grandson…"></label>
          <div class="sheet-actions split">${b ? `<button type="button" class="btn ghost" data-del>${U.icon("trash")}Delete</button>` : `<button type="button" class="btn ghost" data-close>Cancel</button>`}<button class="btn primary">Save</button></div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#bday-form");
        f.onsubmit = (e) => {
          e.preventDefault();
          const data = { name: f.name.value, month: f.month.value, day: f.day.value, year: f.year.value, relation: f.relation.value };
          if (b && b.name.toLowerCase() !== data.name.trim().toLowerCase()) Store.remove("birthdays", b.id);
          if (!Birthdays.add(data)) return U.toast("Please check the date.");
          close();
          U.toast(`Grandma will remember ${data.name.trim()}'s birthday 🎂`);
        };
        const del = sheet.querySelector("[data-del]");
        if (del) del.onclick = () => {
          Store.remove("birthdays", b.id);
          close();
        };
      },
    });
  }

  /* The Planner's "Birthdays" section. */
  function sectionHTML() {
    const all = Birthdays.list().map((b) => ({ ...b, in: Birthdays.daysUntil(b) })).sort((a, b) => a.in - b.in);
    return `<div class="section-title">🎂 Birthdays <span class="count">${all.length}</span>
        <button class="btn ghost small" data-bday-add style="margin-left:auto">${U.icon("plus")}Add</button></div>
      ${all.length
        ? `<div class="list-card">${all.slice(0, 8).map((b) => `<div class="item-row bday-row">
            <div class="t" data-bday-edit="${b.id}"><span>${U.esc(b.name)}${b.relation ? ` <small class="muted">· ${U.esc(b.relation)}</small>` : ""}</span>
              <small>${U.esc(Birthdays.dateText(b))}${Birthdays.turning(b) ? ` · turning ${Birthdays.turning(b)}` : ""} · ${U.esc(Birthdays.whenText(b))}</small></div>
            <button class="btn small ${b.in <= 14 ? "primary" : "ghost"}" data-bday-card="${U.esc(b.name)}">🎂 Card</button>
          </div>`).join("")}</div>`
        : `<p class="muted small">Tell Grandma about birthdays in chat ("Mom's birthday is March 3rd") or add them here, and she'll remind you and help make a card.</p>`}`;
  }

  /* Clicks from anywhere in the app. */
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-bday-add]")) return openEditor();
    const ed = e.target.closest("[data-bday-edit]");
    if (ed) return openEditor(ed.dataset.bdayEdit);
    const c = e.target.closest("[data-bday-card]");
    if (c) return openCardMaker({ name: c.dataset.bdayCard });
    const open = e.target.closest("[data-card-open]");
    if (open) {
      try { openCardMaker(JSON.parse(open.dataset.cardOpen)); } catch (err) { /* ignore */ }
    }
    const sh = e.target.closest("[data-card-share]");
    if (sh) {
      try { share(JSON.parse(sh.dataset.cardShare)); } catch (err) { /* ignore */ }
    }
  });

  GA.Birthdays = { ...Birthdays, STYLES, draw, preview, share, writeMessage, openCardMaker, openEditor, sectionHTML };
})();
