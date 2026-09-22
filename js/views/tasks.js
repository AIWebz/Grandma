/* Grandma AI — Tasks & chores: Today | Upcoming | Completed, categories, reorder. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const CATS = [
    ["cleaning", "🧹", "Cleaning"], ["laundry", "🧺", "Laundry"], ["kitchen", "🍳", "Kitchen"], ["yard", "🌱", "Yard"],
    ["shopping", "🛒", "Shopping"], ["pets", "🐶", "Pets"], ["household", "🏠", "Household"], ["other", "📦", "Other"],
  ];
  const EMOJI = Object.fromEntries(CATS.map(([k, e]) => [k, e]));
  const REPEAT = { daily: "Every day", weekly: "Every week", monthly: "Every month" };

  let tab = "today";
  let cat = "all";
  let highlight = null;

  const sortTasks = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.createdAt - b.createdAt;

  function buckets() {
    const today = U.today();
    const all = Store.allTasks().filter((t) => cat === "all" || t.category === cat);
    const open = all.filter((t) => !t.completed);
    return {
      today: open.filter((t) => t.dueDate && t.dueDate <= today).sort(sortTasks),
      anytime: open.filter((t) => !t.dueDate).sort(sortTasks),
      upcoming: open.filter((t) => t.dueDate && t.dueDate > today).sort((a, b) => (a.dueDate + (a.dueTime || "99")).localeCompare(b.dueDate + (b.dueTime || "99")) || sortTasks(a, b)),
      completed: all.filter((t) => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    };
  }

  function row(t, { reorder = false } = {}) {
    const today = U.today();
    const bits = [];
    if (t.dueDate) bits.push(`<span class="${!t.completed && t.dueDate < today ? "overdue" : ""}">${U.esc(t.dueDate < today && !t.completed ? "Overdue · " + U.friendlyDate(t.dueDate) : U.friendlyDate(t.dueDate))}${t.dueTime ? " · " + U.friendlyTime(t.dueTime) : ""}</span>`);
    if (t.recurrence && t.recurrence !== "none") bits.push(`<span>↻ ${REPEAT[t.recurrence]}</span>`);
    if (t.remind) bits.push(`<span>🔔 Reminder</span>`);
    if (t.shared) bits.push(`<span class="shared-tag">${U.icon("users")}Shared</span>`);
    return `<div class="item-row ${t.completed ? "done" : ""} ${highlight === t.id ? "flash" : ""}" data-id="${t.id}" data-key="${t.shared ? "htasks" : "tasks"}">
        <input type="checkbox" class="check" data-task-check="${t.id}" ${t.completed ? "checked" : ""} aria-label="Mark ${U.esc(t.title)} ${t.completed ? "not done" : "done"}">
        <span class="cat-emoji" aria-hidden="true">${EMOJI[t.category] || "📦"}</span>
        <div class="t" data-edit="${t.id}"><span>${U.esc(t.title)}</span>${bits.length ? `<small>${bits.join("")}</small>` : ""}</div>
        ${reorder ? `<button class="icon-btn grip" data-grip aria-label="Drag to reorder">${U.icon("grip")}</button>` : ""}
        <button class="icon-btn" data-edit="${t.id}" aria-label="Edit ${U.esc(t.title)}">${U.icon("more")}</button>
      </div>`;
  }

  const listCard = (items, opts) => `<div class="list-card" ${opts && opts.reorder ? "data-reorder" : ""}>${items.map((t) => row(t, opts)).join("")}</div>`;

  function bodyHTML() {
    const b = buckets();
    if (tab === "today") {
      if (!b.today.length && !b.anytime.length) return emptyHTML("Looks like you're all caught up. ❤️");
      return (b.today.length ? `<div class="section-title">Today <span class="count">${b.today.length}</span></div>${listCard(b.today, { reorder: true })}` : "") +
        (b.anytime.length ? `<div class="section-title">Anytime <span class="count">${b.anytime.length}</span></div>${listCard(b.anytime, { reorder: true })}` : "");
    }
    if (tab === "upcoming") {
      if (!b.upcoming.length) return emptyHTML("Nothing coming up. Enjoy the breathing room. ❤️");
      const groups = {};
      b.upcoming.forEach((t) => (groups[t.dueDate] = groups[t.dueDate] || []).push(t));
      return Object.entries(groups).map(([d, items]) => `<div class="section-title">${U.esc(U.friendlyDate(d))}</div>${listCard(items)}`).join("");
    }
    if (!b.completed.length) return emptyHTML("Nothing checked off yet. The first one's the hardest.");
    return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn small ghost" data-clear-completed>${U.icon("trash")}Clear completed</button></div>${listCard(b.completed.slice(0, 100))}`;
  }

  const emptyHTML = (msg) => `<div class="empty">${U.avatar(56)}<p>${U.esc(msg)}</p><button class="btn" data-ask="Help me get things done today">Help me get things done</button></div>`;

  function render(root) {
    const b = buckets();
    root.innerHTML = `
      <div class="page-inner">
        <div class="page-head">
          <div><h2>Tasks</h2><p>Chores, reminders, and the little things.</p></div>
          <button class="btn primary" data-ask="My house is a mess. Can you help me get it under control?">${U.icon("sparkle")}Help me get things done</button>
        </div>
        <form class="add-row" id="task-add">
          <input class="input grow" name="title" placeholder="Add a task…" aria-label="New task" autocomplete="off" maxlength="200">
          <button class="btn primary" aria-label="Add task">${U.icon("plus")}</button>
        </form>
        <div class="tabs" role="tablist">
          <button class="${tab === "today" ? "on" : ""}" data-tab="today" role="tab">Today<span class="n">${b.today.length + b.anytime.length}</span></button>
          <button class="${tab === "upcoming" ? "on" : ""}" data-tab="upcoming" role="tab">Upcoming<span class="n">${b.upcoming.length}</span></button>
          <button class="${tab === "completed" ? "on" : ""}" data-tab="completed" role="tab">Completed</button>
        </div>
        <div class="chips" aria-label="Filter by category">
          <button class="chip ${cat === "all" ? "on" : ""}" data-cat="all">All</button>
          ${CATS.map(([k, e, l]) => `<button class="chip ${cat === k ? "on" : ""}" data-cat="${k}">${e} ${l}</button>`).join("")}
        </div>
        <div id="task-body" style="margin-top:8px">${bodyHTML()}</div>
      </div>`;
    wire(root);
    if (highlight) {
      const el = root.querySelector(`[data-id="${highlight}"]`);
      if (el) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      setTimeout(() => (highlight = null), 1800);
    }
  }

  function wire(root) {
    U.$("#task-add", root).onsubmit = (e) => {
      e.preventDefault();
      const title = e.target.title.value.trim();
      if (!title) return;
      const due = tab === "upcoming" ? U.addDays(U.today(), 1) : tab === "today" ? U.today() : "";
      GA.TaskOps.create({ title, category: guessCategory(title), due_date: due });
      e.target.title.value = "";
      U.$("#task-add input", root) && U.$("#task-add input", root).focus();
    };
    root.onclick = async (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { tab = t.dataset.tab; return render(root); }
      const c = e.target.closest("[data-cat]");
      if (c) { cat = c.dataset.cat; return render(root); }
      const ed = e.target.closest("[data-edit]");
      if (ed) return editTask(ed.dataset.edit);
      if (e.target.closest("[data-clear-completed]")) {
        if (await U.confirm("Clear all completed tasks?", { okLabel: "Clear" })) {
          buckets().completed.forEach((x) => Store.remove(x.shared ? "htasks" : "tasks", x.id));
        }
      }
    };
    root.onchange = (e) => {
      const cb = e.target.closest("[data-task-check]");
      if (!cb) return;
      e.stopPropagation();
      const rowEl = cb.closest(".item-row");
      if (cb.checked) {
        rowEl.classList.add("completing");
        setTimeout(() => GA.TaskOps.setCompleted(cb.dataset.taskCheck, true), 380);
      } else GA.TaskOps.setCompleted(cb.dataset.taskCheck, false);
    };
    U.$$("[data-reorder]", root).forEach(enableReorder);
  }

  function guessCategory(title) {
    const s = title.toLowerCase();
    if (/laundry|wash clothes|fold|iron/.test(s)) return "laundry";
    if (/dish|kitchen|cook|fridge|oven|counter/.test(s)) return "kitchen";
    if (/lawn|yard|garden|weed|rake|mow|plant/.test(s)) return "yard";
    if (/buy|shop|store|grocer|pick up/.test(s)) return "shopping";
    if (/dog|cat|pet|vet|litter|walk the/.test(s)) return "pets";
    if (/clean|vacuum|mop|dust|bathroom|tidy|sweep/.test(s)) return "cleaning";
    if (/bill|fix|repair|replace|filter|trash|recycl/.test(s)) return "household";
    return "other";
  }

  /* Drag-to-reorder with pointer events (works with mouse and touch). */
  function enableReorder(list) {
    list.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest("[data-grip]");
      if (!grip) return;
      e.preventDefault();
      const item = grip.closest(".item-row");
      const rows = () => U.$$(".item-row", list);
      const startY = e.clientY;
      item.classList.add("dragging");
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => {
        item.style.transform = `translateY(${ev.clientY - startY}px)`;
        const others = rows().filter((r) => r !== item);
        const mid = item.getBoundingClientRect().top + item.offsetHeight / 2;
        let before = null;
        for (const r of others) {
          const rect = r.getBoundingClientRect();
          if (mid < rect.top + rect.height / 2) { before = r; break; }
        }
        const beforeNow = item.nextElementSibling;
        if (before !== beforeNow && before !== item) {
          const oldTop = item.getBoundingClientRect().top;
          list.insertBefore(item, before);
          const newTop = item.getBoundingClientRect().top;
          const offset = parseFloat((item.style.transform.match(/-?[\d.]+/) || [0])[0]) - (newTop - oldTop);
          item.style.transform = `translateY(${offset}px)`;
        }
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        item.classList.remove("dragging");
        item.style.transform = "";
        const order = rows().map((r) => ({ id: r.dataset.id, key: r.dataset.key }));
        ["tasks", "htasks"].forEach((k) => {
          const ids = order.filter((o) => o.key === k).map((o) => o.id);
          if (ids.length) Store.reorder(k, ids);
        });
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  function editTask(id) {
    const found = Store.findTask(id);
    if (!found) return;
    const { key, task: t } = found;
    const inHousehold = Boolean(Store.doc("household").id);
    U.openSheet({
      title: "Edit task",
      body: `
        <form id="task-edit">
          <label class="field"><span>Task</span><input class="input" name="title" value="${U.esc(t.title)}" required maxlength="200"></label>
          <label class="field"><span>Category</span><select class="select" name="category">${CATS.map(([k, e, l]) => `<option value="${k}" ${t.category === k ? "selected" : ""}>${e} ${l}</option>`).join("")}</select></label>
          <div class="field-row">
            <label class="field"><span>Due date</span><input class="input" type="date" name="dueDate" value="${U.esc(t.dueDate || "")}"></label>
            <label class="field"><span>Time</span><input class="input" type="time" name="dueTime" value="${U.esc(t.dueTime || "")}"></label>
          </div>
          <label class="field"><span>Repeat</span><select class="select" name="recurrence">
            ${["none", "daily", "weekly", "monthly"].map((r) => `<option value="${r}" ${t.recurrence === r ? "selected" : ""}>${r === "none" ? "Doesn't repeat" : REPEAT[r]}</option>`).join("")}
          </select></label>
          <div class="set-row" style="padding:6px 0;border:0"><div class="l"><b>Remind me</b><small>A friendly notification when it's due</small></div><label class="switch"><input type="checkbox" name="remind" ${t.remind ? "checked" : ""}><span></span></label></div>
          ${inHousehold ? `<div class="set-row" style="padding:6px 0;border:0"><div class="l"><b>Share with household</b><small>${U.esc(Store.doc("household").name)}</small></div><label class="switch"><input type="checkbox" name="shared" ${key === "htasks" ? "checked" : ""}><span></span></label></div>` : ""}
          <label class="field"><span>Notes</span><textarea class="textarea" name="notes" rows="3" style="min-height:80px">${U.esc(t.notes || "")}</textarea></label>
          <div class="sheet-actions split">
            <button type="button" class="btn ghost" data-del>${U.icon("trash")}Delete</button>
            <button class="btn primary">Save</button>
          </div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#task-edit");
        f.onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(f);
          const patch = {
            title: fd.get("title").trim() || t.title,
            category: fd.get("category"),
            dueDate: fd.get("dueDate") || "",
            dueTime: fd.get("dueTime") || "",
            recurrence: fd.get("recurrence"),
            remind: f.remind.checked,
            notes: fd.get("notes") || "",
            spawnedNext: false,
          };
          const wantShared = inHousehold && f.shared && f.shared.checked;
          const targetKey = wantShared ? "htasks" : "tasks";
          if (targetKey !== key) {
            const { id: _id, shared: _s, ...rest } = t;
            Store.remove(key, t.id);
            Store.add(targetKey, { ...rest, ...patch });
          } else Store.update(key, t.id, patch);
          if (patch.remind && GA.Notify.permission() === "default") GA.Notify.enable();
          close();
        };
        sheet.querySelector("[data-del]").onclick = () => {
          Store.remove(key, t.id);
          close();
          U.toast("Task deleted", { action: { label: "Undo", run: () => Store.add(key, { ...t, id: undefined }) } });
        };
      },
    });
  }

  GA.Views = GA.Views || {};
  GA.Views.tasks = {
    title: "Tasks",
    keys: ["tasks", "htasks", "household"],
    render(root, params) {
      if (params[0]) {
        highlight = params[0];
        const f = Store.findTask(highlight);
        if (f) tab = f.task.completed ? "completed" : f.task.dueDate && f.task.dueDate > U.today() ? "upcoming" : "today";
        cat = "all";
      }
      render(root);
    },
    refresh(root) {
      const body = U.$("#task-body", root);
      if (!body) return render(root);
      // Keep the add box focused; refresh tabs + list only.
      const b = buckets();
      const tabs = U.$$(".tabs .n", root);
      if (tabs[0]) tabs[0].textContent = b.today.length + b.anytime.length;
      if (tabs[1]) tabs[1].textContent = b.upcoming.length;
      body.innerHTML = bodyHTML();
      U.$$("[data-reorder]", root).forEach(enableReorder);
    },
    guessCategory,
  };
})();
