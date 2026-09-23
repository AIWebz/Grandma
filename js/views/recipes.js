/* Grandma AI — Recipes: browse, search, filter, and the recipe detail page. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CATS = ["Breakfast", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"];

  let query = "";
  let filter = "All";
  const gen = { text: "", tags: new Set(), servings: null, busy: false, error: "", fallback: null };
  const QUICK = [
    ["Quick", "ready in 30 minutes or less"],
    ["Easy", "easy for a beginner"],
    ["Comfort food", "cozy comfort food"],
    ["Healthy", "on the lighter, healthier side"],
    ["Vegetarian", "vegetarian"],
    ["Kid-friendly", "kid-friendly"],
  ];

  const fromGrandma = () => Store.list("recipes").filter((r) => r.source === "ai").sort((a, b) => b.createdAt - a.createdAt);

  function matches(r) {
    if (filter === "Saved" && !GA.Kitchen.isSaved(r.id)) return false;
    if (!["All", "Saved", "From Grandma"].includes(filter) && !(r.categories || []).includes(filter)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q) || r.ingredients.some((i) => i.item.toLowerCase().includes(q));
  }

  function tile(r) {
    const saved = GA.Kitchen.isSaved(r.id);
    return `<button class="recipe-tile" data-route="recipes/${r.id}">
        <div class="rt-media" style="--tile:${GA.RecipeUI.tileColor(r)}" aria-hidden="true"><span>${U.esc(r.emoji || "🍲")}</span>${saved ? `<i class="rt-saved">${U.icon("bookmark")}</i>` : ""}${r.source === "ai" ? `<i class="rt-tag">By Grandma</i>` : ""}</div>
        <div class="rt-body"><h3>${U.esc(r.name)}</h3>${GA.RecipeUI.meta(r)}</div>
      </button>`;
  }

  function gridHTML() {
    const pool = filter === "From Grandma" ? fromGrandma() : GA.Kitchen.all();
    const list = pool.filter(matches);
    if (!list.length) {
      if (filter === "Saved" && !query) return `<div class="empty">${U.avatar(56)}<p>Nothing saved yet. Grandma can help you find something delicious.</p></div>`;
      if (filter === "From Grandma" && !query) return `<div class="empty">${U.avatar(56)}<p>Recipes Grandma writes for you will show up here.</p></div>`;
      return `<div class="empty">${U.avatar(56)}<p>I don't have one like that yet — but I can make you one.</p><button class="btn primary" data-gen-from-search>Make “${U.esc(query || "something")}”</button></div>`;
    }
    return `<div class="recipe-grid">${list.map(tile).join("")}</div>`;
  }

  /* ---------- the recipe maker ---------- */
  function makerHTML() {
    const left = GA.Plans.recipeGensLeft();
    const limit = GA.Plans.limit("recipeGens");
    const connected = GA.AI.connected();
    const serves = gen.servings || GA.Kitchen.defaultServings();
    const personalized = GA.Plans.can("cookingPrefs");
    let status = "";
    if (gen.busy) status = `<div class="maker-busy">${U.avatar(28, "thinking")}<span>Grandma is writing your recipe…</span><div class="typing"><i></i><i></i><i></i></div></div>`;
    else if (gen.error) status = `<p class="form-error">${U.esc(gen.error)}</p>`;
    let fallback = "";
    if (gen.fallback) {
      fallback = gen.fallback.length
        ? `<p class="muted small" style="margin-top:12px">While Grandma's AI is off, here are the closest recipes from her collection:</p><div class="recipe-grid compact">${gen.fallback.map(tile).join("")}</div>`
        : `<p class="muted small" style="margin-top:12px">Nothing in Grandma's collection matches that yet.</p>`;
    }
    return `
      <div class="maker">
        <div class="maker-head">
          <div><h3>What are we cooking?</h3><p class="muted">Tell Grandma what you have or what you're craving. She'll write a full recipe.</p></div>
          ${limit !== Infinity && connected ? `<span class="pill-count" title="Recipes Grandma can write today">${left} of ${limit} left today</span>` : ""}
        </div>
        <textarea class="input maker-input" id="gen-text" rows="2" placeholder="e.g. chicken, rice and broccoli — or “a cozy soup for a rainy day”" ${gen.busy ? "disabled" : ""}>${U.esc(gen.text)}</textarea>
        <div class="maker-row">
          <div class="chips wrap">${QUICK.map(([l]) => `<button class="chip ${gen.tags.has(l) ? "on" : ""}" data-gen-tag="${l}" ${gen.busy ? "disabled" : ""}>${l}</button>`).join("")}</div>
          <div class="maker-actions">
            <span class="stepper" aria-label="Servings"><button data-gen-serves="-1" aria-label="Fewer servings">−</button><span>${serves} servings</span><button data-gen-serves="1" aria-label="More servings">+</button></span>
            ${connected
              ? `<button class="btn primary" data-gen ${gen.busy ? "disabled" : ""}>${U.icon("sparkle")}Make my recipe</button>`
              : `<button class="btn primary" data-brain-setup>${U.icon("sparkle")}Turn on Grandma</button><button class="btn ghost" data-gen-find>Search her recipes</button>`}
          </div>
        </div>
        <p class="muted tiny">${personalized ? "✓ Personalized with your cooking preferences." : `Allergies you set are always respected. <button class="link-btn" data-route="pricing">Grandma+</button> personalizes every recipe to your diet, skill, and household.`}</p>
        ${status}${fallback}
      </div>`;
  }

  function renderMaker(root) {
    const host = U.$("#maker", root);
    if (host) host.innerHTML = makerHTML();
  }

  async function generate(root) {
    const extras = QUICK.filter(([l]) => gen.tags.has(l)).map(([, d]) => d);
    if (!gen.text.trim() && !extras.length) {
      U.toast("Tell Grandma what you have or what you're in the mood for.");
      U.$("#gen-text", root) && U.$("#gen-text", root).focus();
      return;
    }
    if (GA.Plans.recipeGensLeft() <= 0) {
      GA.Plans.gate(GA.Plans.is("free") ? "cookingPrefs" : "labs", GA.Plans.is("free") ? "More recipes each day" : "Unlimited recipe generation");
      return;
    }
    const request = [gen.text.trim() || "a dinner the whole family will like", ...extras].join("; ");
    gen.busy = true;
    gen.error = "";
    gen.fallback = null;
    renderMaker(root);
    try {
      const r = await GA.AI.generateRecipe({ request, servings: gen.servings || GA.Kitchen.defaultServings() });
      const rec = Store.add("recipes", { ...r, baseServings: r.servings, saved: false, source: "ai" });
      GA.Plans.recordRecipeGen();
      gen.busy = false;
      gen.text = "";
      gen.tags.clear();
      GA.App.go("recipes/" + rec.id);
    } catch (e) {
      gen.busy = false;
      gen.error = e.kind === "config" ? "Grandma's AI isn't turned on yet." : e.kind === "brain-unsupported" ? "Grandma's AI couldn't start on this device. Try the Phone version in Settings." : "I couldn't make that recipe right now. Let's try again.";
      renderMaker(root);
    }
  }

  function listView(root) {
    root.innerHTML = `
      <div class="page-inner wide">
        <div class="page-head">
          <div><h2>Recipes</h2><p>Grandma's classics, your favorites, and anything you dream up.</p></div>
        </div>
        <div id="maker">${makerHTML()}</div>
        <div class="toolbar">
          <div class="search-row grow">${U.icon("search")}<input class="input" id="recipe-search" type="search" placeholder="Search recipes or ingredients" value="${U.esc(query)}" aria-label="Search recipes"></div>
        </div>
        <div class="chips" role="tablist" aria-label="Recipe categories">
          ${["All", "Saved", "From Grandma"].concat(CATS).map((c) => `<button class="chip ${c === filter ? "on" : ""}" data-filter="${c}" role="tab" aria-selected="${c === filter}">${c}</button>`).join("")}
        </div>
        <div id="recipe-grid" style="margin-top:14px">${gridHTML()}</div>
        <div class="ad-slot" data-ad="recipes"></div>
      </div>`;
    const search = U.$("#recipe-search", root);
    search.addEventListener("input", () => {
      query = search.value.trim();
      U.$("#recipe-grid", root).innerHTML = gridHTML();
    });
    root.oninput = (e) => {
      if (e.target.id === "gen-text") gen.text = e.target.value;
    };
    root.onkeydown = (e) => {
      if (e.target.id === "gen-text" && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        generate(root);
      }
    };
    root.onclick = (e) => {
      const f = e.target.closest("[data-filter]");
      if (f) {
        filter = f.dataset.filter;
        U.$$("[data-filter]", root).forEach((c) => {
          c.classList.toggle("on", c.dataset.filter === filter);
          c.setAttribute("aria-selected", String(c.dataset.filter === filter));
        });
        U.$("#recipe-grid", root).innerHTML = gridHTML();
        return;
      }
      const t = e.target.closest("[data-gen-tag]");
      if (t) {
        const l = t.dataset.genTag;
        gen.tags.has(l) ? gen.tags.delete(l) : gen.tags.add(l);
        t.classList.toggle("on", gen.tags.has(l));
        return;
      }
      const sv = e.target.closest("[data-gen-serves]");
      if (sv) {
        gen.servings = U.clamp((gen.servings || GA.Kitchen.defaultServings()) + Number(sv.dataset.genServes), 1, 24);
        renderMaker(root);
        return;
      }
      if (e.target.closest("[data-gen]")) return generate(root);
      if (e.target.closest("[data-gen-find]")) {
        gen.fallback = GA.Kitchen.findSimilar(gen.text + " " + [...gen.tags].join(" "));
        renderMaker(root);
        return;
      }
      if (e.target.closest("[data-gen-from-search]")) {
        gen.text = query;
        renderMaker(root);
        U.$("#maker", root).scrollIntoView({ behavior: "smooth", block: "start" });
        if (GA.AI.connected()) generate(root);
      }
    };
    GA.Ads.banner(U.$("[data-ad]", root), "recipes");
  }

  function detailView(root, id) {
    const r = GA.Kitchen.get(id);
    if (!r) {
      root.innerHTML = `<div class="page-inner"><button class="back-link" data-route="recipes">${U.icon("chevronLeft")}Recipes</button><div class="empty">${U.avatar(56)}<p>I couldn't find that recipe. It may have been removed.</p></div></div>`;
      return;
    }
    const mine = r.source === "ai";
    root.innerHTML = `
      <div class="page-inner">
        <button class="back-link" data-route="recipes">${U.icon("chevronLeft")}Recipes</button>
        <div class="recipe-hero">
          <div class="food-tile" style="--tile:${GA.RecipeUI.tileColor(r)}" role="img" aria-label="${U.esc(r.name)}">${U.esc(r.emoji || "🍲")}</div>
          <div class="grow">
            <h2>${U.esc(r.name)}</h2>
            ${r.description ? `<p>${U.esc(r.description)}</p>` : ""}
            ${GA.RecipeUI.meta(r)}
          </div>
        </div>
        <div class="rc-actions" style="padding:0">${GA.RecipeUI.actions(r)}</div>
        <div class="card" style="margin-top:16px">${GA.RecipeUI.full(r)}</div>
        <div class="row wrap" style="margin-top:14px">
          <button class="btn ghost" data-ask="About the ${U.esc(r.name)} recipe: ">${U.icon("chat")}Ask Grandma about this</button>
          ${mine ? `<button class="btn ghost" data-delete-recipe="${r.id}">${U.icon("trash")}Delete</button>` : ""}
        </div>
      </div>`;
    root.onclick = async (e) => {
      const d = e.target.closest("[data-delete-recipe]");
      if (d && (await U.confirm("Delete this recipe? This can't be undone."))) {
        Store.remove("recipes", d.dataset.deleteRecipe);
        GA.App.go("recipes");
      }
    };
  }

  GA.Views = GA.Views || {};
  GA.Views.recipes = {
    title: "Recipes",
    keys: ["recipes", "subscription"],
    render(root, params) {
      if (params[0]) detailView(root, params[0]);
      else listView(root);
    },
    // Keep the search box focused while typing: only the grid refreshes.
    refresh(root, params) {
      if (params[0]) return detailView(root, params[0]);
      const grid = U.$("#recipe-grid", root);
      if (!grid) return listView(root);
      grid.innerHTML = gridHTML();
      if (!root.contains(document.activeElement) || document.activeElement.id !== "gen-text") renderMaker(root);
    },
  };
})();
