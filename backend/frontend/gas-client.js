// =========================================================
// Connects the website to the Google Apps Script server.
// =========================================================
// The pages (script.js / dashboard.js) were written to call the server
// with fetch("/api/..."). Instead of rewriting every page, this file
// quietly redirects those calls to the Apps Script web address from
// config.js, and keeps the login token in the browser.
(function () {
  var TOKEN_KEY = "sabc_token";
  var realFetch = window.fetch.bind(window);

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
  }

  var page = (location.pathname.split("/").pop() || "").toLowerCase();
  var onAuthPage = page === "login.html" || page === "signup.html";

  // Everything except the login / signup screens needs an account.
  if (!onAuthPage && !getToken()) {
    location.replace("login.html");
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        resolve(s.slice(s.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(new Error("Could not read the file.")); };
      reader.readAsDataURL(file);
    });
  }

  async function buildPayload(url, init) {
    var u = new URL(url, "http://local");
    var query = {};
    u.searchParams.forEach(function (v, k) { query[k] = v; });

    var fields = {}, files = {};
    var body = init.body;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      var entries = Array.from(body.entries());
      for (var i = 0; i < entries.length; i++) {
        var k = entries[i][0], v = entries[i][1];
        if (typeof File !== "undefined" && v instanceof File) {
          if (v.size > 0) files[k] = { name: v.name, mime: v.type || "application/octet-stream", data: await fileToBase64(v) };
        } else {
          fields[k] = v;
        }
      }
    } else if (typeof body === "string" && body) {
      try { fields = JSON.parse(body); } catch (e) { fields = {}; }
    }

    return {
      method: String(init.method || "GET").toUpperCase(),
      path: u.pathname,
      query: query,
      fields: fields,
      files: files,
      token: getToken()
    };
  }

  function reply(status, data) {
    return new Response(JSON.stringify(data), { status: status, headers: { "Content-Type": "application/json" } });
  }

  window.fetch = async function (input, init) {
    init = init || {};
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") !== 0) return realFetch(input, init);

    var cfg = window.SABC_CONFIG || {};
    if (!cfg.apiUrl || cfg.apiUrl.indexOf("PASTE_") === 0) {
      return reply(503, { error: "The site is not connected to its server yet (config.js)." });
    }

    var payload;
    try {
      payload = await buildPayload(url, init);
    } catch (e) {
      return reply(400, { error: e.message || "Could not prepare the request." });
    }

    var env;
    try {
      // text/plain keeps this a "simple" request, so the browser doesn't
      // need a CORS pre-check (Apps Script can't answer one).
      var res = await realFetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow"
      });
      env = await res.json();
    } catch (e) {
      return reply(502, { error: "Could not reach the server. Check your internet connection and try again." });
    }

    var status = Number(env && env.status) || 500;
    var data = (env && env.data) || {};

    if (payload.path === "/api/auth/login" || payload.path === "/api/auth/signup") {
      if (status < 300 && data.token) setToken(data.token);
      delete data.token;
    }
    if (payload.path === "/api/auth/logout") setToken("");

    // Session ended (or token no longer valid): back to the login screen.
    if (status === 401 && payload.path.indexOf("/api/auth/") !== 0 && !onAuthPage) {
      setToken("");
      setTimeout(function () { location.replace("login.html"); }, 50);
    }

    return reply(status, data);
  };
})();
