# wllama (vendored)

[wllama](https://github.com/ngxson/wllama) 3.6.1 — llama.cpp compiled to WebAssembly, MIT licensed (see `LICENSE`).

Grandma uses it to run a small AI model on the device's processor, so her brain works on iPhones, iPads, Android phones, and any browser without WebGPU.

| File | From the npm package |
| --- | --- |
| `index.js` | `@wllama/wllama@3.6.1` → `esm/index.js` (unmodified) |
| `wllama.wasm` | `@wllama/wllama@3.6.1` → `esm/wasm/wllama.wasm` |
| `compat/wllama.js`, `compat/wllama.wasm` | `@wllama/wllama-compat@3.6.1` → `wasm/` — used by Safari/iOS and browsers without JSPI or Memory64 |

These are plain files served by your static host; there's no build step. `js/brain.js` points wllama at the local `compat/` files so nothing is loaded from a CDN.
