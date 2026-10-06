// Search by voice: a microphone in the search bar. Speak, and the words become the search.
// Uses the browser's own speech recognition (Chrome, Edge, Safari; Brave and Firefox don't offer it).
import { h, toast, icon } from "../ui.js";

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

export function attachVoiceSearch(form, input) {
  const mic = h("button", { type: "button", class: "vs-mic", title: "Search by voice", "aria-label": "Search by voice" }, icon("mic"));
  form.append(mic);
  let rec = null;
  const stop = () => { try { rec?.stop(); } catch {} };
  const done = () => { rec = null; mic.classList.remove("on"); form.classList.remove("listening"); input.placeholder = input.dataset.ph || input.placeholder; };
  mic.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (rec) return stop();
    if (!Rec) return toast("Voice search doesn’t work in this browser. Try Chrome, Edge or Safari.");
    rec = new Rec();
    rec.lang = document.documentElement.lang && document.documentElement.lang !== "en" ? document.documentElement.lang : navigator.language || "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    input.dataset.ph = input.dataset.ph || input.placeholder;
    let heard = "";
    rec.onstart = () => { mic.classList.add("on"); form.classList.add("listening"); input.value = ""; input.placeholder = "Listening… say what you’re looking for"; input.focus(); };
    rec.onresult = (ev) => {
      heard = [...ev.results].map((r) => r[0].transcript).join(" ").trim();
      input.value = heard;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (ev.results[ev.results.length - 1].isFinal) stop();
    };
    rec.onerror = (ev) => {
      const why = { "not-allowed": "Allow the microphone to search by voice.", "service-not-allowed": "Allow the microphone to search by voice.", network: "Voice search isn’t available in this browser (Brave blocks it). Try Chrome, Edge or Safari.", "no-speech": "Didn’t hear anything. Tap the mic and speak." }[ev.error];
      if (why) toast(why);
    };
    rec.onend = () => {
      done();
      if (heard) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
    };
    try { rec.start(); } catch { done(); }
  });
  return mic;
}
