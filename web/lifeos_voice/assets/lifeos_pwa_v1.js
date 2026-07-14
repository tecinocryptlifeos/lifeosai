(() => {
  "use strict";

  const release = "lifeos-premium-public-mobile-v2.0.4-20260714";
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js?v=" + encodeURIComponent(release),
        { updateViaCache: "none" }
      );
      await registration.update();
    } catch (error) {
      // Installation support must never prevent the public site from loading.
      console.warn("LifeOS mobile web app registration was unavailable.", error);
    }
  }, { once: true });
})();
