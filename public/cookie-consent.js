// The cookie window: asks once which cookies and outside content a visitor allows, and remembers it in this browser.
// Necessary cookies (logging in) are always on. "Content from other sites" covers things that load from other
// companies without a tap: YouTube songs that start by themselves in stories, GIPHY GIFs and OpenStreetMap maps.
// The login page asks once; until then only necessary cookies are on.
// Pages ask window.lbConsent.extra() and listen for the "lb-consent" event when the choice changes.
(function () {
  "use strict";
  var KEY = "lb_consent", VERSION = 1;
  // Only the login page asks by itself (its script tag has data-ask); elsewhere the window opens from "Cookie settings"
  var ASK = Boolean(document.currentScript && document.currentScript.hasAttribute("data-ask"));

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || "null");
      return c && c.v === VERSION ? c : null;
    } catch (e) { return null; }
  }
  var choice = read();

  function save(extra) {
    choice = { v: VERSION, extra: Boolean(extra), at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch (e) { /* private mode: the choice lasts for this page */ }
    close();
    try { window.dispatchEvent(new CustomEvent("lb-consent", { detail: { extra: choice.extra } })); } catch (e) { /* old browser */ }
  }

  var css =
    ".lbc{position:fixed;z-index:2147483000;left:50%;bottom:16px;transform:translateX(-50%);width:min(540px,calc(100vw - 32px));" +
    "box-sizing:border-box;background:#0d0d0f;color:#f4f4f6;border:1px solid rgba(255,79,163,.45);border-radius:18px;" +
    "box-shadow:0 18px 50px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);padding:18px 18px 16px;font:14px/1.5 inherit;" +
    "font-family:inherit;animation:lbc-in .28s ease-out;max-height:calc(100vh - 32px);overflow:auto}" +
    "@keyframes lbc-in{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}" +
    ".lbc h2{margin:0 0 6px;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;color:#fff}" +
    ".lbc p{margin:0 0 12px;color:#c9c9d1}" +
    ".lbc a{color:#ff4fa3;text-decoration:underline}" +
    ".lbc-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}" +
    ".lbc button{font:inherit;font-weight:600;border-radius:999px;padding:9px 16px;cursor:pointer;border:1px solid rgba(255,255,255,.18);" +
    "background:transparent;color:#f4f4f6}" +
    ".lbc button:hover{border-color:#ff4fa3}" +
    ".lbc button:focus-visible{outline:2px solid #ff4fa3;outline-offset:2px}" +
    ".lbc .lbc-yes{background:#ff4fa3;border-color:#ff4fa3;color:#0b0b0b}" +
    ".lbc .lbc-yes:hover{background:#ff6cb4}" +
    ".lbc .lbc-link{border:0;padding:9px 6px;color:#c9c9d1;text-decoration:underline;margin-right:auto}" +
    ".lbc-row{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(255,255,255,.08)}" +
    ".lbc-row:last-of-type{margin-bottom:12px}" +
    ".lbc-row div{flex:1}.lbc-row b{display:block;color:#fff}.lbc-row small{color:#a5a5ae;font-size:12.5px}" +
    ".lbc-sw{position:relative;flex:none;width:44px;height:26px;margin-top:2px}" +
    ".lbc-sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}" +
    ".lbc-sw span{position:absolute;inset:0;border-radius:99px;background:#3a3a42;transition:background .2s;pointer-events:none}" +
    ".lbc-sw span:after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}" +
    ".lbc-sw input:checked+span{background:#ff4fa3}.lbc-sw input:checked+span:after{transform:translateX(18px)}" +
    ".lbc-sw input:disabled{cursor:default}.lbc-sw input:disabled+span{opacity:.55}" +
    ".lbc-sw input:focus-visible+span{outline:2px solid #ff4fa3;outline-offset:2px}" +
    "@media (max-width:480px){.lbc{bottom:10px;padding:16px 14px 14px}.lbc-btns button{flex:1 1 auto}.lbc .lbc-link{flex:0 0 100%;text-align:left;order:3}}";

  var box = null;
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function close() { if (box) { box.remove(); box = null; } }

  function open(settings) {
    if (!document.body) return document.addEventListener("DOMContentLoaded", function () { open(settings); });
    if (!document.getElementById("lbc-css")) document.head.appendChild(el("style", { id: "lbc-css", text: css }));
    close();
    var intro = el("p", { html: "LookBlog uses only the cookies it needs to keep you logged in. Some things, like YouTube songs in stories, GIFs and event maps, load from other companies, who can see your IP address. You choose whether they load by themselves. <a href=\"/cookies\">Cookie Policy</a>" });
    var kids = [el("h2", { id: "lbc-title" }, [document.createTextNode("🍪 Cookies")]), intro];
    if (settings) {
      var extraBox = el("input", { type: "checkbox", id: "lbc-extra", "aria-describedby": "lbc-extra-why" });
      extraBox.checked = Boolean(choice && choice.extra);
      var needBox = el("input", { type: "checkbox", disabled: "", "aria-label": "Necessary cookies, always on" });
      needBox.checked = true;
      kids.push(
        el("div", { class: "lbc-row" }, [
          el("div", {}, [el("b", { text: "Necessary" }), el("small", { text: "Keep you logged in and remember the accounts you switch between. The site can't work without them, so they're always on." })]),
          el("label", { class: "lbc-sw" }, [needBox, el("span")]),
        ]),
        el("div", { class: "lbc-row" }, [
          el("div", {}, [el("label", { for: "lbc-extra" }, [el("b", { text: "Content from other sites" })]), el("small", { id: "lbc-extra-why", text: "Lets YouTube songs in stories play by themselves and shows GIFs (GIPHY) and maps (OpenStreetMap) without a tap. When it's off, you tap to load each one." })]),
          el("label", { class: "lbc-sw" }, [extraBox, el("span")]),
        ]),
        el("div", { class: "lbc-btns" }, [
          el("button", { type: "button", class: "lbc-link", text: "Back", onclick: function () { open(false); } }),
          el("button", { type: "button", text: "Reject cookies", title: "Only the cookies needed to log in stay on", onclick: function () { save(false); } }),
          el("button", { type: "button", text: "Save my choice", onclick: function () { save(extraBox.checked); } }),
          el("button", { type: "button", class: "lbc-yes", text: "Accept all", onclick: function () { save(true); } }),
        ])
      );
    } else {
      kids.push(el("div", { class: "lbc-btns" }, [
        el("button", { type: "button", class: "lbc-link", text: "Settings", onclick: function () { open(true); } }),
        el("button", { type: "button", text: "Reject cookies", title: "Only the cookies needed to log in stay on", onclick: function () { save(false); } }),
        el("button", { type: "button", class: "lbc-yes", text: "Accept all", onclick: function () { save(true); } }),
      ]));
    }
    box = el("section", { class: "lbc", role: "dialog", "aria-modal": "false", "aria-labelledby": "lbc-title" }, kids);
    document.body.appendChild(box);
  }

  window.lbConsent = {
    extra: function () { return Boolean(choice && choice.extra); },
    asked: function () { return Boolean(choice); },
    open: function () { open(true); },
  };

  // Any "Cookie settings" link or button on any page opens the window again
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-cookie-settings]");
    if (!t) return;
    e.preventDefault();
    open(true);
  });

  if (!choice && ASK) open(false);
})();
