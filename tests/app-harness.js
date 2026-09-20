const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeNode(id) {
  const classes = new Set();
  const node = {
    id,
    value: "",
    files: [],
    checked: false,
    children: [],
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
      toggle(value, force) {
        const enabled = force === undefined ? !classes.has(value) : Boolean(force);
        enabled ? classes.add(value) : classes.delete(value);
        return enabled;
      }
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    insertBefore() {},
    after() {},
    remove() {},
    closest() { return null; },
    addEventListener() {},
    focus() {},
    blur() {},
    click() { this.clicked = true; },
    setAttribute() {},
    getAttribute() { return null; },
    scrollIntoView() {},
    offsetWidth: 80,
    offsetLeft: 0,
    getContext() {
      return {
        clearRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, arc() {}, fill() {}, drawImage() {}
      };
    },
    toDataURL() { return "data:image/jpeg;base64,AAAA"; }
  };
  Object.defineProperty(node, "innerHTML", {
    get() { return this._html || ""; },
    set(value) { this._html = String(value); }
  });
  Object.defineProperty(node, "textContent", {
    get() { return this._text || ""; },
    set(value) { this._text = String(value); }
  });
  return node;
}

function createAppHarness() {
  const file = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const app = scripts[scripts.length - 1];
  const declaredIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map();
  const createdNodes = [];
  const blobs = [];
  const objectUrls = { created: [], revoked: [] };
  const alerts = [];
  const confirms = [];
  const values = {};
  let storageWriteError = null;
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  const localStorage = {
    getItem(key) { return Object.hasOwn(values, key) ? values[key] : null; },
    setItem(key, value) {
      if (storageWriteError) throw storageWriteError;
      values[key] = String(value);
    },
    removeItem(key) { delete values[key]; }
  };
  const document = {
    getElementById(id) { return declaredIds.has(id) ? getNode(id) : null; },
    querySelector(selector) {
      if (selector === ".page.active") return getNode("today");
      if (selector === "header") return getNode("header");
      if (selector.includes("button.active") || selector.includes("button[data-p")) {
        return getNode("nav-button");
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".page") {
        return ["today", "weight", "train", "diet", "progress", "more", "ref", "data", "profiles", "trash"].map(getNode);
      }
      if (selector.includes("#nav button") || selector.includes("#more_panel button")) {
        return ["today", "weight", "train", "diet", "progress"].map(id => {
          const node = getNode(`nav-${id}`);
          node.dataset.p = id;
          return node;
        });
      }
      return [];
    },
    createElement(tag) {
      const node = makeNode(`created-${tag}`);
      node.tagName = String(tag).toUpperCase();
      createdNodes.push(node);
      return node;
    },
    addEventListener() {},
    fonts: { ready: Promise.resolve() },
    documentElement: makeNode("html"),
    body: makeNode("body"),
    activeElement: null
  };
  const window = {
    document,
    localStorage,
    scrollY: 0,
    innerHeight: 800,
    addEventListener() {},
    scrollTo() {},
    matchMedia() { return { matches: false, addEventListener() {} }; },
    requestAnimationFrame(callback) { callback(); return 0; },
    location: { reload() {} }
  };
  const context = vm.createContext({
    document,
    window,
    localStorage,
    navigator: {},
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console,
    alert(message) { alerts.push(String(message)); },
    confirm(message) { confirms.push(String(message)); return true; },
    prompt() { return null; },
    setTimeout(callback) { callback(); return 0; },
    clearTimeout() {},
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    Set,
    Map,
    Blob: function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
      this.size = Buffer.byteLength(parts.map(part => String(part)).join(""));
      blobs.push(this);
    },
    URL: {
      createObjectURL(blob) {
        const url = `blob:test-${objectUrls.created.length + 1}`;
        objectUrls.created.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) { objectUrls.revoked.push(url); }
    },
    FileReader: function FileReader() {
      this.readAsText = file => {
        this.result = file.content;
        if (this.onload) this.onload({ target: this });
      };
      this.readAsDataURL = file => {
        this.result = file.content;
        if (this.onload) this.onload({ target: this });
      };
    },
    Image: function Image() { this.width = 640; this.height = 480; }
  });
  context.globalThis = context;
  vm.runInContext(app, context, { filename: "index.html#app" });
  return {
    context,
    nodes,
    createdNodes,
    blobs,
    objectUrls,
    alerts,
    confirms,
    values,
    failStorageWrites(error = new Error("QuotaExceededError")) { storageWriteError = error; },
    allowStorageWrites() { storageWriteError = null; },
    run(source) { return vm.runInContext(source, context); }
  };
}

module.exports = { createAppHarness };
