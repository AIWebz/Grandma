/*
 * Grandma AI — voice, using the browser's built-in Web Speech API.
 * Speech recognition availability varies by browser (Chrome, Edge and Safari
 * support it; Firefox does not). Native wrappers can supply their own through
 * window.GrandmaNative.listen / speak.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { Store } = GA;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const native = () => window.GrandmaNative || {};

  let current = null;

  const clean = (text) =>
    String(text || "")
      .replace(/[*_`#>]/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  const Voice = {
    canListen: () => Boolean(Rec || native().listen),
    canSpeak: () => Boolean("speechSynthesis" in window || native().speak),

    listen({ onInterim, onFinal, onEnd, onError } = {}) {
      Voice.stopSpeaking();
      if (native().listen) {
        native().listen().then((t) => { onFinal && onFinal(t); onEnd && onEnd(); }).catch((e) => { onError && onError(e); onEnd && onEnd(); });
        return () => native().stopListening && native().stopListening();
      }
      if (!Rec) {
        onError && onError(new Error("unsupported"));
        return () => {};
      }
      const r = new Rec();
      r.lang = navigator.language || "en-US";
      r.interimResults = true;
      r.continuous = false;
      let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        onInterim && onInterim((finalText + " " + interim).trim());
      };
      r.onerror = (e) => onError && onError(e);
      r.onend = () => {
        current = null;
        if (finalText.trim()) onFinal && onFinal(finalText.trim());
        onEnd && onEnd();
      };
      try {
        r.start();
      } catch (e) {
        onError && onError(e);
      }
      current = r;
      return () => r.stop();
    },

    stopListening() {
      if (current) current.stop();
    },

    voices() {
      if (!("speechSynthesis" in window)) return [];
      const lang = (navigator.language || "en").slice(0, 2);
      return speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang));
    },

    /* Prefer a natural-sounding voice when the person hasn't chosen one. */
    pickVoice() {
      const s = Store.doc("settings").voice;
      const all = Voice.voices();
      if (s.voiceURI) {
        const chosen = all.find((v) => v.voiceURI === s.voiceURI);
        if (chosen) return chosen;
      }
      const prefs = [/natural/i, /samantha/i, /karen/i, /moira/i, /serena/i, /google us english/i, /female/i];
      for (const re of prefs) {
        const v = all.find((x) => re.test(x.name));
        if (v) return v;
      }
      return all[0] || null;
    },

    speak(text, { onEnd } = {}) {
      const t = clean(text);
      if (!t) return onEnd && onEnd();
      if (native().speak) {
        native().speak(t).then(() => onEnd && onEnd()).catch(() => onEnd && onEnd());
        return;
      }
      if (!("speechSynthesis" in window)) return onEnd && onEnd();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      const v = Voice.pickVoice();
      if (v) u.voice = v;
      u.rate = Store.doc("settings").voice.rate || 1;
      u.pitch = 1;
      u.onend = () => onEnd && onEnd();
      u.onerror = () => onEnd && onEnd();
      speechSynthesis.speak(u);
    },

    stopSpeaking() {
      if (native().stopSpeaking) native().stopSpeaking();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    },

    speaking: () => "speechSynthesis" in window && speechSynthesis.speaking,
  };

  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
  GA.Voice = Voice;
})();
