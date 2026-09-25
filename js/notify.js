/*
 * Grandma AI — friendly notifications.
 *
 * While the app is open (or installed as a PWA and running in the
 * background), this checks every minute for task reminders and the
 * person's chosen nudges and shows a system notification. Notifications
 * that must arrive while the app is fully closed need push delivery from a
 * server or the native wrapper — see README "Notifications".
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  let timer = null;

  const supported = () => "Notification" in window || Boolean(window.GrandmaNative && window.GrandmaNative.notify);

  async function show(title, body, tag, route) {
    if (window.GrandmaNative && window.GrandmaNative.notify) {
      window.GrandmaNative.notify({ title, body, tag, route });
      return;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      const opts = { body, tag, icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png", data: { route } };
      if (reg) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch (e) {
      /* notifications blocked */
    }
  }

  function once(key) {
    const notified = Store.doc("local").notified || {};
    if (notified[key]) return false;
    // Keep the record small: forget entries older than a couple of days.
    const today = U.today();
    const trimmed = Object.fromEntries(Object.entries(notified).filter(([k]) => k.includes(today) || k.includes(U.addDays(today, -1))));
    trimmed[key] = 1;
    Store.replaceDoc("local", { ...Store.doc("local"), notified: trimmed });
    return true;
  }

  function tick() {
    const n = Store.doc("settings").notifications;
    if (!n.enabled || n.frequency === "off") return;
    const today = U.today();
    const now = U.nowTime();
    const name = Store.doc("profile").name;
    const tasks = Store.allTasks();

    // Task reminders ("remind me to…")
    if (n.tasks) {
      for (const t of tasks) {
        if (t.completed || !t.remind || !t.dueDate) continue;
        const when = t.dueTime || "09:00";
        if (t.dueDate === today && when <= now && once(`task:${t.id}:${today}`)) {
          show("Don't forget ❤️", t.title, "task-" + t.id, "tasks");
        }
      }
    }

    // Birthdays: the day before (evening) and the morning of
    if (GA.Birthdays) {
      for (const b of GA.Birthdays.list()) {
        const inDays = GA.Birthdays.daysUntil(b);
        if (inDays === 1 && now >= "18:00" && once(`bday1:${b.id}:${today}`)) show("Birthday tomorrow 🎂", `${b.name}'s birthday is tomorrow! Want Grandma to help you make a card?`, "bday-" + b.id, "planner");
        if (inDays === 0 && now >= "08:00" && once(`bday0:${b.id}:${today}`)) show("Happy birthday day 🎉", `Today is ${b.name}'s birthday${GA.Birthdays.turning(b) ? ` (turning ${GA.Birthdays.turning(b)})` : ""}. Don't forget to reach out! I can make a card.`, "bday-" + b.id, "planner");
      }
    }

    // Morning check-in
    if (n.daily && n.dailyTime && n.dailyTime <= now && once(`daily:${today}`)) {
      const due = tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= today).length;
      const body = due
        ? `${U.greetingWord()}${name ? ", " + name : ""}. You've got ${due} thing${due === 1 ? "" : "s"} on today's list. We'll take it one at a time.`
        : `${U.greetingWord()}${name ? ", " + name : ""}. Nothing pressing today. Want to plan something nice?`;
      show("Grandma AI", body, "daily", "chat");
    }

    // Dinner nudge
    if (n.recipes && n.dinnerTime) {
      const [h, m] = n.dinnerTime.split(":").map(Number);
      const before = new Date();
      before.setHours(h, m - 30, 0, 0);
      const t = `${String(before.getHours()).padStart(2, "0")}:${String(before.getMinutes()).padStart(2, "0")}`;
      if (t <= now && now < n.dinnerTime && once(`dinner:${today}`)) {
        show("Grandma AI", `Hey${name ? " " + name : " sweetheart"} ❤️ It's almost dinner time. Want me to help you figure out what to make?`, "dinner", "chat");
      }
    }

    // Afternoon encouragement (normal frequency only)
    if (n.frequency === "normal" && now >= "15:00" && now < "19:00") {
      const left = tasks.filter((t) => !t.completed && t.dueDate === today);
      if (left.length > 0 && left.length <= 2 && once(`encourage:${today}`)) {
        show("Grandma AI", left.length === 1 ? `Just one thing left today: ${left[0].title}. You've got this.` : "You've only got two things left today. You've got this.", "encourage", "tasks");
      }
    }
  }

  const Notify = {
    supported,
    permission: () => ("Notification" in window ? Notification.permission : window.GrandmaNative && window.GrandmaNative.notify ? "granted" : "unsupported"),
    async enable() {
      if (window.GrandmaNative && window.GrandmaNative.requestNotificationPermission) {
        const ok = await window.GrandmaNative.requestNotificationPermission();
        Store.setDoc("settings", { notifications: { enabled: Boolean(ok) } });
        return ok;
      }
      if (!("Notification" in window)) return false;
      const p = await Notification.requestPermission();
      Store.setDoc("settings", { notifications: { enabled: p === "granted" } });
      return p === "granted";
    },
    start() {
      clearInterval(timer);
      // A native wrapper schedules everything itself (even when closed).
      if (window.GrandmaNative && window.GrandmaNative.scheduleNotifications) {
        const sync = U.debounce(Notify.syncNative, 1000);
        ["tasks", "htasks", "settings", "profile"].forEach((k) => Store.on(k, sync));
        sync();
        return;
      }
      timer = setInterval(tick, 60000);
      setTimeout(tick, 5000);
    },
    /*
     * Native wrappers can deliver notifications while the app is closed.
     * We hand them the full upcoming schedule; they replace what they had.
     */
    syncNative() {
      const n = Store.doc("settings").notifications;
      const out = [];
      if (n.enabled && n.frequency !== "off") {
        const name = Store.doc("profile").name;
        const at = (day, hhmm) => new Date(`${day}T${hhmm}:00`).toISOString();
        const today = U.today();
        if (n.tasks) {
          Store.allTasks()
            .filter((t) => !t.completed && t.remind && t.dueDate && t.dueDate >= today)
            .forEach((t) => out.push({ id: "task-" + t.id, title: "Don't forget ❤️", body: t.title, at: at(t.dueDate, t.dueTime || "09:00"), route: "tasks" }));
        }
        for (let i = 0; i < 7; i++) {
          const day = U.addDays(today, i);
          if (n.daily) out.push({ id: "daily-" + day, title: "Grandma AI", body: `Good morning${name ? ", " + name : ""}. Let's see what today needs.`, at: at(day, n.dailyTime), route: "chat" });
          if (n.recipes) {
            const [h, m] = n.dinnerTime.split(":").map(Number);
            const d = new Date(`${day}T00:00:00`);
            d.setHours(h, m - 30);
            out.push({ id: "dinner-" + day, title: "Grandma AI", body: `Hey${name ? " " + name : " sweetheart"} ❤️ It's almost dinner time. Want me to help you figure out what to make?`, at: d.toISOString(), route: "chat" });
          }
        }
      }
      try {
        window.GrandmaNative.scheduleNotifications(out.filter((x) => new Date(x.at) > new Date()));
      } catch (e) { /* wrapper not ready */ }
    },
    test() {
      show("Grandma AI", "This is what my reminders look like. ❤️", "test", "chat");
    },
  };

  GA.Notify = Notify;
})();
