/* Grandma AI — Our Family Cookbook: family recipes, photos, stories, and memories. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const ORGANIZE_TOOL = {
    name: "organize_family_recipe",
    description: "Return the recipe transcribed from the photo(s), organized into fields.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        servings: { type: "string", description: "As written, e.g. '8' or 'one 9-inch pie'. Empty if not given." },
        total_time: { type: "string", description: "Prep + cook time if stated or clearly implied, e.g. '1 hr 15 min'. Empty if unknown." },
        ingredients: { type: "array", items: { type: "string" }, description: "One ingredient per item, with the amount as written." },
        instructions: { type: "array", items: { type: "string" }, description: "One step per item, in the original wording." },
        notes: { type: "string", description: "Any side notes, dedications, or margin comments on the card." },
        legible: { type: "boolean", description: "False if the image doesn't contain a readable recipe." },
      },
      required: ["title", "ingredients", "instructions", "legible"],
    },
  };

  const lines = (s) => String(s || "").split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

  function card(f) {
    const photo = (f.photos || [])[0];
    return `<button class="fam-card" data-route="cookbook/${f.id}">
        <div class="media-frame">${photo ? `<img data-media-id="${photo.id}" data-media-path="${U.esc(photo.path || "")}" alt="">` : "📖"}</div>
        <div class="fc-body">
          <h3>${U.esc(f.title)}</h3>
          ${f.from ? `<div class="from">From ${U.esc(f.from)}</div>` : ""}
          ${f.story ? `<p class="story">“${U.esc(f.story)}”</p>` : ""}
        </div>
      </button>`;
  }

  function listView(root) {
    const items = Store.list("family").sort((a, b) => a.title.localeCompare(b.title));
    const hh = Store.doc("household");
    root.innerHTML = `
      <div class="page-inner wide">
        <div class="page-head">
          <div><h2>Our Family Cookbook ❤️</h2><p>${hh.id ? `Shared with ${U.esc(hh.name)}` : "Recipes, stories, and memories worth keeping."}</p></div>
          <div class="row wrap">
            <button class="btn" data-fam-scan>${U.icon("image")}Scan handwritten recipe</button>
            <button class="btn primary" data-fam-new>${U.icon("plus")}Add a recipe</button>
          </div>
        </div>
        ${items.length ? `<div class="fam-grid">${items.map(card).join("")}</div>` : `
          <div class="empty">${U.avatar(60)}
            <p>Start preserving your family's recipes and stories here.</p>
            <p class="muted" style="font-size:14px">Snap a photo of a handwritten card and Grandma will type it up for you — the original photo stays with it.</p>
            <div class="row wrap" style="justify-content:center"><button class="btn primary" data-fam-scan>${U.icon("image")}Scan a recipe card</button><button class="btn" data-fam-new>Type one in</button></div>
          </div>`}
        ${!hh.id && GA.Plans.atLeast("pro") ? `<p class="small-print" style="text-align:center;margin-top:18px">Want the whole family adding recipes? <button class="link-btn" data-route="settings" data-section="household">Set up your household</button></p>` : ""}
      </div>`;
    GA.Account.hydrateImages(root);
    root.onclick = (e) => {
      if (e.target.closest("[data-fam-new]")) form();
      if (e.target.closest("[data-fam-scan]")) form(null, { scan: true });
    };
  }

  function detailView(root, id) {
    const f = Store.find("family", id);
    if (!f) {
      root.innerHTML = `<div class="page-inner"><button class="back-link" data-route="cookbook">${U.icon("chevronLeft")}Family Cookbook</button><div class="empty">${U.avatar(56)}<p>That recipe isn't here anymore.</p></div></div>`;
      return;
    }
    const ings = lines(f.ingredients);
    const steps = lines(f.instructions);
    root.innerHTML = `
      <div class="page-inner">
        <button class="back-link" data-route="cookbook">${U.icon("chevronLeft")}Family Cookbook</button>
        <h2 style="font-size:28px;font-weight:700;letter-spacing:-.02em;margin-top:4px">${U.esc(f.title)}</h2>
        ${f.from ? `<div style="color:var(--accent-text);font-weight:600;margin-top:4px">From ${U.esc(f.from)}</div>` : ""}
        <div class="meta">${f.servings ? `<span>${U.icon("users")}${U.esc(f.servings)}</span>` : ""}${f.time ? `<span>${U.icon("clock")}${U.esc(f.time)}</span>` : ""}</div>
        ${f.story ? `<blockquote class="story-quote">${U.esc(f.story)}</blockquote>` : ""}
        ${(f.photos || []).length ? `<div class="section-title">Original ${f.photos.length === 1 ? "card" : "photos"}</div>
          <div class="photo-strip">${f.photos.map((p) => `<figure><img data-media-id="${p.id}" data-media-path="${U.esc(p.path || "")}" alt="${U.esc(p.caption || "Recipe photo")}" data-lightbox>${p.caption ? `<figcaption>${U.esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
        <div class="card" style="margin-top:14px"><div class="recipe-full">
          ${ings.length ? `<h4>Ingredients</h4><ul class="ing-list">${ings.map((l) => `<li><span>${U.esc(l)}</span></li>`).join("")}</ul>` : ""}
          ${steps.length ? `<h4>Instructions</h4><ol class="step-list">${steps.map((l) => `<li><span>${U.esc(l)}</span></li>`).join("")}</ol>` : ""}
          ${f.notes ? `<h4>Notes & memories</h4><p class="pre">${U.esc(f.notes)}</p>` : ""}
          ${!ings.length && !steps.length && !f.notes ? `<p class="muted" style="padding:12px 0">No recipe text yet. Tap Edit to add it, or let Grandma read the photo.</p>` : ""}
        </div></div>
        <div class="row wrap" style="margin-top:14px">
          <button class="btn" data-fam-edit>${U.icon("edit")}Edit</button>
          ${ings.length ? `<button class="btn" data-fam-grocery>${U.icon("cart")}Add to Grocery List</button>` : ""}
          <button class="btn ghost" data-ask="Tell me some ideas to make our family's ${U.esc(f.title)} a little easier on a weeknight, without losing what makes it special.">${U.icon("chat")}Ask Grandma</button>
          <button class="btn ghost" data-fam-del>${U.icon("trash")}Delete</button>
        </div>
      </div>`;
    GA.Account.hydrateImages(root);
    root.onclick = async (e) => {
      const img = e.target.closest("[data-lightbox]");
      if (img && img.src) {
        const lb = document.createElement("div");
        lb.className = "lightbox";
        lb.innerHTML = `<img src="${img.src}" alt="${U.esc(img.alt)}">`;
        lb.onclick = () => lb.remove();
        document.body.appendChild(lb);
        return;
      }
      if (e.target.closest("[data-fam-edit]")) return form(f);
      if (e.target.closest("[data-fam-grocery]")) {
        const made = GA.Grocery.add(ings.map((l) => ({ name: l, section: GA.Grocery.guessSection(l) })), f.title);
        U.toast(`Added ${made.length} items to your grocery list`, { action: { label: "View", run: () => GA.App.go("grocery") } });
        return;
      }
      if (e.target.closest("[data-fam-del]") && (await U.confirm(`Delete "${f.title}" from the Family Cookbook? The photos will be removed too.`))) {
        (f.photos || []).forEach((p) => Store.DB.delMedia(p.id).catch(() => {}));
        Store.remove("family", f.id);
        GA.App.go("cookbook");
      }
    };
  }

  /* Add / edit form, with "Read it with Grandma" for handwritten photos. */
  function form(existing, { scan = false } = {}) {
    const f = existing ? JSON.parse(JSON.stringify(existing)) : { title: "", from: "", story: "", servings: "", time: "", ingredients: "", instructions: "", notes: "", photos: [] };
    const newPhotos = []; // uploaded during this edit (removed if cancelled)
    let saved = false;

    const photosHTML = () =>
      f.photos.map((p, i) => `<div class="thumb"><img data-media-id="${p.id}" data-media-path="${U.esc(p.path || "")}" alt=""><button type="button" data-rm-photo="${i}" aria-label="Remove photo">${U.icon("x")}</button></div>`).join("");

    U.openSheet({
      title: existing ? "Edit family recipe" : "Add a family recipe",
      wide: true,
      body: `
        <form id="fam-form">
          <div class="upload-drop" data-pick>
            ${U.icon("image")}<div><strong>Add photos</strong> — handwritten cards, the finished dish, or the cook.</div>
            <div class="muted" style="font-size:13px">The original images are kept exactly as they are.</div>
          </div>
          <input type="file" accept="image/*" multiple hidden data-file>
          <div class="form-photos" data-photos>${photosHTML()}</div>
          <div class="row wrap" style="margin:12px 0 4px" data-ai-row ${f.photos.length ? "" : "hidden"}>
            <button type="button" class="btn small" data-read>${U.icon("sparkle")}Read handwriting with Grandma</button>
            <span class="muted" style="font-size:13px" data-ai-status></span>
          </div>
          <label class="field" style="margin-top:12px"><span>Recipe name</span><input class="input" name="title" required maxlength="120" placeholder="Grandma Mary's Apple Pie" value="${U.esc(f.title)}"></label>
          <label class="field"><span>Whose recipe is it?</span><input class="input" name="from" maxlength="80" placeholder="Grandma Mary" value="${U.esc(f.from)}"></label>
          <label class="field"><span>The story</span><textarea class="textarea" name="story" rows="3" placeholder="Grandma Mary always made this for Thanksgiving.">${U.esc(f.story)}</textarea></label>
          <div class="field-row">
            <label class="field"><span>Servings</span><input class="input" name="servings" maxlength="40" value="${U.esc(f.servings)}" placeholder="8"></label>
            <label class="field"><span>Cooking time</span><input class="input" name="time" maxlength="40" value="${U.esc(f.time)}" placeholder="1 hr 15 min"></label>
          </div>
          <label class="field"><span>Ingredients <small class="muted">(one per line)</small></span><textarea class="textarea" name="ingredients" rows="6">${U.esc(f.ingredients)}</textarea></label>
          <label class="field"><span>Instructions <small class="muted">(one step per line)</small></span><textarea class="textarea" name="instructions" rows="6">${U.esc(f.instructions)}</textarea></label>
          <label class="field"><span>Notes & memories</span><textarea class="textarea" name="notes" rows="3" placeholder="Use the blue bowl. Always doubled at Christmas.">${U.esc(f.notes)}</textarea></label>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${existing ? "Save changes" : "Save to cookbook"}</button></div>
        </form>`,
      onMount(sheet, close) {
        const formEl = sheet.querySelector("#fam-form");
        const file = sheet.querySelector("[data-file]");
        const refreshPhotos = () => {
          sheet.querySelector("[data-photos]").innerHTML = photosHTML();
          sheet.querySelector("[data-ai-row]").hidden = !f.photos.length;
          GA.Account.hydrateImages(sheet);
        };
        GA.Account.hydrateImages(sheet);
        sheet.querySelector("[data-pick]").onclick = () => file.click();
        file.onchange = async () => {
          for (const fl of Array.from(file.files).slice(0, 6)) {
            try {
              const m = await GA.Account.saveMedia(fl, 2000);
              f.photos.push({ id: m.id, path: m.path, caption: "" });
              newPhotos.push(m.id);
            } catch (e) {
              U.toast("I couldn't read that photo.");
            }
          }
          file.value = "";
          refreshPhotos();
          if (scan && f.photos.length && !formEl.ingredients.value.trim()) readWithAI(sheet, formEl, f);
        };
        sheet.querySelector("[data-photos]").onclick = (e) => {
          const b = e.target.closest("[data-rm-photo]");
          if (!b) return;
          f.photos.splice(Number(b.dataset.rmPhoto), 1);
          refreshPhotos();
        };
        sheet.querySelector("[data-read]").onclick = () => readWithAI(sheet, formEl, f);
        formEl.onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(formEl);
          const data = {};
          ["title", "from", "story", "servings", "time", "ingredients", "instructions", "notes"].forEach((k) => (data[k] = String(fd.get(k) || "").trim()));
          data.photos = f.photos;
          saved = true;
          if (existing) {
            (existing.photos || []).filter((p) => !f.photos.some((q) => q.id === p.id)).forEach((p) => Store.DB.delMedia(p.id).catch(() => {}));
            Store.update("family", existing.id, data);
          } else {
            const rec = Store.add("family", data);
            GA.App.go("cookbook/" + rec.id);
          }
          close();
          U.toast(existing ? "Saved" : "Added to Our Family Cookbook ❤️");
        };
        // Photos added and then cancelled shouldn't linger on the device.
        const obs = new MutationObserver(() => {
          if (!document.body.contains(sheet)) {
            obs.disconnect();
            if (!saved) newPhotos.forEach((id) => Store.DB.delMedia(id).catch(() => {}));
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        if (scan) {
          file.setAttribute("capture", "environment");
          setTimeout(() => file.click(), 50);
          setTimeout(() => file.removeAttribute("capture"), 500);
        }
      },
    });
  }

  async function readWithAI(sheet, formEl, f) {
    const status = sheet.querySelector("[data-ai-status]");
    const btn = sheet.querySelector("[data-read]");
    if (!GA.AI.connected()) {
      status.innerHTML = `Grandma's AI isn't set up yet. <button type="button" class="link-btn" data-brain-setup>Turn her on</button>, or type the recipe in.`;
      return;
    }
    if (GA.Plans.remainingMessages() <= 0) {
      status.textContent = "You've reached today's AI limit. You can still type it in.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Grandma is reading the card…";
    try {
      const images = [];
      for (const p of f.photos.slice(0, 4)) {
        const blob = (await Store.DB.getMedia(p.id)) || (p.path ? await GA.Account.downloadMedia(p.path) : null);
        if (blob) images.push(await U.blobToBase64(await U.resizeImage(blob, 1568, 0.9)));
      }
      const out = await GA.AI.extract({
        instruction: "Transcribe this family recipe from the photo(s). Keep the original wording and amounts exactly as written. Put ingredients and steps in order.",
        images,
        tool: ORGANIZE_TOOL,
      });
      GA.Plans.recordMessage();
      if (out.legible === false) {
        status.textContent = "I couldn't make out a recipe in that photo. A brighter, straight-on photo helps.";
        return;
      }
      const fill = (name, value) => {
        if (value && !formEl[name].value.trim()) formEl[name].value = value;
      };
      fill("title", out.title);
      fill("servings", out.servings);
      fill("time", out.total_time);
      fill("ingredients", (out.ingredients || []).join("\n"));
      fill("instructions", (out.instructions || []).join("\n"));
      fill("notes", out.notes);
      if (f.photos[0] && !f.photos[0].caption) f.photos[0].caption = "Original recipe card";
      status.textContent = "Done! Please look it over — I kept the original wording.";
    } catch (e) {
      status.textContent = "I couldn't read that right now. Let's try again in a moment.";
    } finally {
      btn.disabled = false;
    }
  }

  GA.Views = GA.Views || {};
  GA.Views.cookbook = {
    title: "Family Cookbook",
    keys: ["family", "household"],
    render(root, params) {
      if (params[0]) detailView(root, params[0]);
      else listView(root);
    },
  };
})();
