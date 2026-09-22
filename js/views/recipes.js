/* Grandma AI — Recipes: browse, search, filter, and the recipe detail page. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CATS = ["Breakfast", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"];

  let query = "";
  let filter = "All";

  function matches(r) {
    if (filter === "Saved" && !GA.Kitchen.isSaved(r.id)) return false;
    if (filter !== "All" && filter !== "Saved" && !(r.categories || []).includes(filter)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q) || r.ingredients.some((i) => i.item.toLowerCase().includes(q));
  }

  function tile(r) {
    return `<button class="recipe-tile" data-route="recipes/${r.id}">
        <div class="food-tile" style="--tile:${GA.RecipeUI.tileColor(r)}" aria-hidden="true">${U.esc(r.emoji || "🍲")}</div>
        <div class="grow"><h3>${U.esc(r.name)}</h3>${GA.RecipeUI.meta(r)}</div>
        ${GA.Kitchen.isSaved(r.id) ? `<span class="saved-dot" title="Saved">${U.icon("bookmark")}</span>` : ""}
      </button>`;
  }

  function gridHTML() {
    const list = GA.Kitchen.all().filter(matches);
    if (!list.length) {
      if (filter === "Saved" && !query) {
        return `<div class="empty">${U.avatar(56)}<p>Nothing saved yet. Grandma can help you find something delicious.</p><button class="btn primary" data-ask="Find me a traditional recipe">Ask Grandma</button></div>`;
      }
      return `<div class="empty">${U.avatar(56)}<p>I don't have one like that yet — but I can make you one.</p><button class="btn primary" data-ask="${U.esc(query ? `Can you give me a recipe for ${query}?` : "Find me a traditional recipe")}">Ask Grandma for a recipe</button></div>`;
    }
    return `<div class="recipe-grid">${list.map(tile).join("")}</div>`;
  }

  function listView(root) {
    root.innerHTML = `
      <div class="page-inner wide">
        <div class="page-head">
          <div><h2>Recipes</h2><p>Traditional favorites and everything Grandma makes for you.</p></div>
          <button class="btn primary" data-ask="I have some ingredients in the kitchen. Can you help me make something with them?">${U.icon("sparkle")}Make me something</button>
        </div>
        <div class="search-row">${U.icon("search")}<input class="input" id="recipe-search" type="search" placeholder="Search recipes or ingredients" value="${U.esc(query)}" aria-label="Search recipes"></div>
        <div class="chips" role="tablist" aria-label="Recipe categories">
          ${["All", "Saved"].concat(CATS).map((c) => `<button class="chip ${c === filter ? "on" : ""}" data-filter="${c}" role="tab" aria-selected="${c === filter}">${c === "Saved" ? "❤️ Saved" : c}</button>`).join("")}
        </div>
        <div id="recipe-grid" style="margin-top:12px">${gridHTML()}</div>
        <div class="ad-slot" data-ad="recipes"></div>
      </div>`;
    const search = U.$("#recipe-search", root);
    search.addEventListener("input", () => {
      query = search.value.trim();
      U.$("#recipe-grid", root).innerHTML = gridHTML();
    });
    root.onclick = (e) => {
      const f = e.target.closest("[data-filter]");
      if (f) {
        filter = f.dataset.filter;
        U.$$(".chip", root).forEach((c) => {
          c.classList.toggle("on", c.dataset.filter === filter);
          c.setAttribute("aria-selected", String(c.dataset.filter === filter));
        });
        U.$("#recipe-grid", root).innerHTML = gridHTML();
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
      if (grid) grid.innerHTML = gridHTML();
      else listView(root);
    },
  };
})();
