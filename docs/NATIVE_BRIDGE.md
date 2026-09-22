# Native bridge: `window.GrandmaNative`

The web app runs unchanged inside an iOS or Android wrapper. When the wrapper puts a `window.GrandmaNative` object on the page, the app automatically switches to:

- AdMob ads (when `ads.provider` is `"native"`)
- App Store / Google Play purchases
- the wrapper's notifications
- the wrapper's speech features

Every method is optional. The app checks for each one and falls back to the web version when it's missing.

All methods return Promises unless noted otherwise.

| Method | Called when | Should do / return |
| --- | --- | --- |
| `purchase(productId, userId)` | The person taps a plan button | Run StoreKit / Play Billing (or RevenueCat) with `appUserID = userId`. Resolve `{ plan: "plus"\|"pro", period, status: "active", renewsAt }`, or reject if cancelled. |
| `restorePurchases(userId)` | **Restore Purchases** | Restore, then resolve the same shape (or `{ plan: "free" }`). |
| `manageSubscriptions()` | **Manage subscription** | Open the store's subscription management screen. |
| `showBanner(placement)` / `hideBanner()` | A Free user opens Recipes, Grocery, or Planner / otherwise | Show or hide an AdMob banner anchored at the bottom. Sync, no return. |
| `showInterstitial()` | A natural section transition (already rate-limited by the app) | Show a preloaded AdMob interstitial. |
| `showRewarded()` | The person chooses "Watch an ad for 5 more messages" | Show a rewarded ad. Set SSV custom data to the Supabase user ID. Resolve `true` if the reward was earned. |
| `notify({ title, body, tag, route })` | An immediate notification | Post a local notification. Tapping it should load `#/<route>`. |
| `scheduleNotifications(list)` | Tasks or settings change | Replace all pending local notifications with `list` (items: `{ id, title, body, at (ISO), route }`). |
| `requestNotificationPermission()` | The person turns notifications on | Ask the OS. Resolve `true` or `false`. |
| `listen()` / `stopListening()` | Mic button (optional; the web Speech API is used otherwise) | Resolve the recognized text. |
| `speak(text)` / `stopSpeaking()` | Read aloud (optional) | Speak with a natural system voice. Resolve when finished. |

Product IDs come from `config.js → billing.nativeProducts`. Set `billing.provider` to `"native"` and `ads.provider` to `"native"` in the build you bundle into the app.

## The JavaScript shim

Native code injects this script at document start. It turns native message passing into Promises. Keep it identical on both platforms, and change only `post()`.

```js
(function () {
  let seq = 0;
  const waiting = {};
  // iOS: WKScriptMessageHandler named "grandma"; Android: @JavascriptInterface "GrandmaAndroid"
  const post = (msg) =>
    window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.grandma
      ? window.webkit.messageHandlers.grandma.postMessage(msg)
      : window.GrandmaAndroid.postMessage(JSON.stringify(msg));
  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      waiting[id] = { resolve, reject };
      post({ id, method, args });
    });
  // Native calls this with the result: window.__grandmaReply(id, ok, valueJson)
  window.__grandmaReply = (id, ok, value) => {
    const w = waiting[id];
    delete waiting[id];
    if (w) ok ? w.resolve(value) : w.reject(new Error(String(value || "failed")));
  };
  const fire = (method) => (...args) => post({ id: 0, method, args });
  window.GrandmaNative = {
    purchase: (p, u) => call("purchase", p, u),
    restorePurchases: (u) => call("restorePurchases", u),
    manageSubscriptions: fire("manageSubscriptions"),
    showBanner: fire("showBanner"),
    hideBanner: fire("hideBanner"),
    showInterstitial: fire("showInterstitial"),
    showRewarded: () => call("showRewarded"),
    notify: fire("notify"),
    scheduleNotifications: fire("scheduleNotifications"),
    requestNotificationPermission: () => call("requestNotificationPermission"),
  };
})();
```

## iOS sketch (Swift, WKWebView)

This is a starting point, not a complete app. Add the Google Mobile Ads SDK and RevenueCat with Swift Package Manager in Xcode.

```swift
import UIKit
import WebKit

final class WebViewController: UIViewController, WKScriptMessageHandler {
    var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        let shim = try! String(contentsOf: Bundle.main.url(forResource: "bridge-shim", withExtension: "js")!)
        config.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "grandma")
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "https://your-app.example/")!))
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let id = body["id"] as? Int ?? 0
        let args = body["args"] as? [Any] ?? []
        switch method {
        case "purchase":
            // Purchases.shared.logIn(args[1] as! String) { ... purchase(productId) ... }
            // then reply(id, ok: true, json: "{\"plan\":\"plus\",\"status\":\"active\"}")
            break
        case "showRewarded":
            // Present a GADRewardedAd with serverSideVerificationOptions.customRewardString = userId
            break
        default: break
        }
    }

    func reply(_ id: Int, ok: Bool, json: String) {
        webView.evaluateJavaScript("window.__grandmaReply(\(id), \(ok), \(json))")
    }
}
```

In `Info.plist`, add `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, and `NSUserTrackingUsageDescription` (if you use personalized ads), plus `GADApplicationIdentifier`.

## Android sketch (Kotlin, WebView)

Add `com.google.android.gms:play-services-ads` and RevenueCat's `purchases` to the app's Gradle dependencies in Android Studio.

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "GrandmaAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                view.evaluateJavascript(assets.open("bridge-shim.js").bufferedReader().readText(), null)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = request.grant(request.resources)
        }
        web.loadUrl("https://your-app.example/")
    }

    inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val msg = JSONObject(json)
            val id = msg.getInt("id")
            when (msg.getString("method")) {
                "purchase" -> { /* Purchases.sharedInstance.logIn(userId) ... then reply(id, true, "{\"plan\":\"plus\"}") */ }
                "showBanner" -> { /* show AdView at the bottom */ }
                "showRewarded" -> { /* RewardedAd with ServerSideVerificationOptions(userId) */ }
            }
        }
    }

    private fun reply(id: Int, ok: Boolean, json: String) = runOnUiThread {
        web.evaluateJavascript("window.__grandmaReply($id, $ok, $json)", null)
    }
}
```

Request `RECORD_AUDIO`, `CAMERA`, and `POST_NOTIFICATIONS` at runtime. Add your AdMob app ID to `AndroidManifest.xml`.

## Bundled vs. hosted files

- **Hosted (load your HTTPS URL):** updates ship as soon as you push to GitHub. Keep `ALLOWED_ORIGINS` set to your site.
- **Bundled (copy the repo files into the app):** works offline from the first launch. Serve the files over a custom scheme or local server, and add that origin to the worker's `ALLOWED_ORIGINS`. Every change needs a new store release.
