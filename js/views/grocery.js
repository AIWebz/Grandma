/* Grandma AI — Grocery List, organized by store section. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const SECTIONS = [
    ["produce", "🥬", "Produce"],
    ["meat", "🥩", "Meat"],
    ["dairy", "🧀", "Dairy"],
    ["pantry", "🥫", "Pantry"],
    ["other", "🧴", "Other"],
  ];

  function itemRow(g) {
    const sub = [g.quantity, g.source ? `for ${g.source}` : ""].filter(Boolean).join(" · ");
    return `<div class="item-row ${g.checked ? "done" : ""}" data-id="${g.id}">
        <input type="checkbox" class="check" data-grocery-toggle="${g.id}" ${g.checked ? "checked" : ""} aria-label="${U.esc(g.name)}">
        <div class="t"><span>${U.esc(g.name)}</span>${sub ? `<small>${U.esc(sub)}</small>` : ""}</div>
        <button class="icon-btn" data-remove="${g.id}" aria-label="Remove ${U.esc(g.name)}">${U.icon("x")}</button>
      </div>`;
  }

  function bodyHTML() {
    const items = Store.list("grocery");
    if (!items.length) {
      return `<div class="empty">${U.avatar(56)}<p>Your grocery list is empty. Want Grandma to make one?</p><button class="btn primary" data-ask="Make a grocery list">Make me a list</button></div>`;
    }
    const open = items.filter((g) => !g.checked);
    const done = items.filter((g) => g.checked);
    let html = SECTIONS.map(([k, e, l]) => {
      const list = open.filter((g) => g.section === k).sort((a, b) => a.createdAt - b.createdAt);
      if (!list.length) return "";
      return `<div class="section-title">${e} ${l} <span class="count">${list.length}</span></div><div class="list-card">${list.map(itemRow).join("")}</div>`;
    }).join("");
    if (!open.length) html += `<div class="empty" style="padding:28px 20px">${U.avatar(48)}<p>All done! Everything's in the cart. ❤️</p></div>`;
    if (done.length) {
      html += `<div class="section-title">✓ In the cart <span class="count">${done.length}</span></div><div class="list-card">${done.map(itemRow).join("")}</div>`;
    }
    return html;
  }

  function render(root) {
    const items = Store.list("grocery");
    root.innerHTML = `
      <div class="page-inner">
        <div class="page-head">
          <div><h2>Grocery List</h2><p>${items.filter((g) => !g.checked).length} item${items.filter((g) => !g.checked).length === 1 ? "" : "s"} to get${Store.doc("household").id ? " · shared with " + U.esc(Store.doc("household").name) : ""}</p></div>
          <div class="row">
            ${items.length ? `<button class="btn ghost" data-share>${U.icon("upload")}Share</button>` : ""}
            <button class="btn ghost" data-from-plan>${U.icon("calendar")}From my meal plan${GA.Plans.can("autoGrocery") ? "" : ` <span class="tag-pro">Grandma+</span>`}</button>
            <button class="btn primary" data-ask="Make a grocery list for this week's dinners">${U.icon("sparkle")}Make me a list</button>
          </div>
        </div>
        <form class="add-row" id="grocery-add">
          <input class="input grow" name="name" placeholder="Add an item…" aria-label="New grocery item" autocomplete="off" maxlength="120">
          <select class="select" name="section" aria-label="Section" style="width:auto;border-radius:999px">
            <option value="">Auto</option>
            ${SECTIONS.map(([k, e, l]) => `<option value="${k}">${e} ${l}</option>`).join("")}
          </select>
          <button class="btn primary" aria-label="Add item">${U.icon("plus")}</button>
        </form>
        <div id="grocery-body">${bodyHTML()}</div>
        ${items.some((g) => g.checked) ? `<div class="row" style="justify-content:center;margin-top:18px"><button class="btn ghost" data-clear>${U.icon("trash")}Clear completed items</button></div>` : ""}
        <div class="ad-slot" data-ad="grocery"></div>
      </div>`;

    U.$("#grocery-add", root).onsubmit = (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      GA.Grocery.add([{ name, section: e.target.section.value || GA.Grocery.guessSection(name) }]);
      e.target.name.value = "";
      e.target.name.focus();
    };
    root.onclick = async (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const item = Store.find("grocery", rm.dataset.remove);
        Store.remove("grocery", rm.dataset.remove);
        if (item) U.toast(`Removed ${item.name}`, { action: { label: "Undo", run: () => Store.add("grocery", { ...item, id: undefined }) } });
        return;
      }
      if (e.target.closest("[data-clear]")) {
        Store.list("grocery").filter((g) => g.checked).forEach((g) => Store.remove("grocery", g.id));
        U.toast("Cleared completed items");
        return;
      }
      const lbl = e.target.closest(".item-row .t");
      if (lbl) {
        const id = lbl.closest(".item-row").dataset.id;
        const g = Store.find("grocery", id);
        if (g) Store.update("grocery", id, { checked: !g.checked });
        return;
      }
      if (e.target.closest("[data-share]")) share();
      if (e.target.closest("[data-from-plan]")) {
        if (!GA.Plans.gate("autoGrocery", "Automatic grocery lists")) return;
        const n = GA.Planner.groceryFromPlan();
        U.toast(n ? `Added ${n} items from this week's meal plan` : "No recipes in your planner this week yet — try “Plan the week's dinners” in the Planner.");
      }
    };
    GA.Ads.banner(U.$("[data-ad]", root), "grocery");
  }

  async function share() {
    const open = Store.list("grocery").filter((g) => !g.checked);
    const text = "Grocery list\n" + SECTIONS.map(([k, e, l]) => {
      const list = open.filter((g) => g.section === k);
      return list.length ? `\n${l}\n` + list.map((g) => `☐ ${g.name}${g.quantity ? " (" + g.quantity + ")" : ""}`).join("\n") : "";
    }).join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "Grocery list", text });
      else {
        await navigator.clipboard.writeText(text);
        U.toast("List copied — paste it anywhere");
      }
    } catch (e) { /* cancelled */ }
  }

  GA.Views = GA.Views || {};
  GA.Views.grocery = {
    title: "Grocery List",
    keys: ["grocery", "household"],
    render,
    refresh(root) {
      const input = U.$("#grocery-add input", root);
      const hadFocus = document.activeElement === input;
      const val = input ? input.value : "";
      render(root);
      const again = U.$("#grocery-add input", root);
      if (again) {
        again.value = val;
        if (hadFocus) again.focus();
      }
    },
  };
})();
