/* LIFEOS_ACCOUNT_LAYOUT_FIX_V1 */

(function () {
  "use strict";

  function textKey(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function byText(selector, exactText) {
    var wanted = textKey(exactText);

    return Array.from(
      document.querySelectorAll(selector)
    ).find(function (node) {
      return textKey(node.textContent) === wanted;
    }) || null;
  }

  function commonAncestor(first, second) {
    if (!first || !second) {
      return null;
    }

    var ancestors = new Set();

    for (
      var current = first;
      current;
      current = current.parentElement
    ) {
      ancestors.add(current);
    }

    for (
      var candidate = second;
      candidate;
      candidate = candidate.parentElement
    ) {
      if (ancestors.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function rectArea(node) {
    if (
      !node ||
      typeof node.getBoundingClientRect !== "function"
    ) {
      return 0;
    }

    var rect = node.getBoundingClientRect();

    return (
      Math.max(0, rect.width) *
      Math.max(0, rect.height)
    );
  }

  function applyBackgroundCover(card) {
    document.documentElement.classList.add(
      "lifeos-account-layout-fix"
    );

    if (document.body) {
      document.body.classList.add(
        "lifeos-account-layout-fix"
      );
    }

    var viewportArea = Math.max(
      1,
      window.innerWidth * window.innerHeight
    );

    var bestCandidate = null;
    var bestScore = 0;

    Array.from(
      document.body
        ? document.body.querySelectorAll("*")
        : []
    )
      .slice(0, 1500)
      .forEach(function (node) {
        if (
          card &&
          (node === card || card.contains(node))
        ) {
          return;
        }

        var style = window.getComputedStyle(node);

        var visual =
          node.tagName === "IMG" ||
          node.tagName === "VIDEO" ||
          style.backgroundImage !== "none";

        if (!visual) {
          return;
        }

        var areaRatio =
          rectArea(node) / viewportArea;

        if (areaRatio < 0.22) {
          return;
        }

        var positionBoost =
          /fixed|absolute/.test(style.position)
            ? 1
            : 0;

        var score = areaRatio + positionBoost;

        if (score > bestScore) {
          bestCandidate = node;
          bestScore = score;
        }
      });

    if (bestCandidate) {
      bestCandidate.classList.add(
        "lifeos-account-background-cover"
      );
    }
  }

  function apply() {
    var submit =
      document.getElementById(
        "emailPasswordSignIn"
      ) ||
      byText(
        "button,input[type='button']," +
          "input[type='submit'],[role='button']",
        "Create LifeOS account"
      );

    var heading = byText(
      "h1,h2,h3,h4,[role='heading']",
      "LifeOS Account"
    );

    if (!submit || !heading) {
      return false;
    }

    submit.classList.add(
      "lifeos-account-submit-visible"
    );

    var card = commonAncestor(
      heading,
      submit
    );

    if (!card) {
      return false;
    }

    card.classList.add(
      "lifeos-account-card-scroll"
    );

    var overlay = null;

    for (
      var node = card.parentElement;
      node;
      node = node.parentElement
    ) {
      var style = window.getComputedStyle(node);
      var rect = node.getBoundingClientRect();

      if (
        /fixed|absolute/.test(style.position) ||
        (
          rect.width >=
            window.innerWidth * 0.85 &&
          rect.height >=
            window.innerHeight * 0.80
        )
      ) {
        overlay = node;
        break;
      }
    }

    overlay = overlay || document.body;

    overlay.classList.add(
      "lifeos-account-overlay-scroll"
    );

    for (
      var parent = card.parentElement;
      parent && parent !== overlay;
      parent = parent.parentElement
    ) {
      parent.classList.add(
        "lifeos-account-scroll-unclip"
      );
    }

    applyBackgroundCover(card);

    return true;
  }

  window.__LifeOSAccountLayoutFixV1 = {
    apply: apply
  };

  function start() {
    apply();

    [250, 800, 1800].forEach(
      function (delay) {
        window.setTimeout(apply, delay);
      }
    );

    if (
      typeof MutationObserver === "function" &&
      document.body
    ) {
      var observer =
        new MutationObserver(function () {
          apply();
        });

      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );

      window.setTimeout(
        function () {
          observer.disconnect();
        },
        10000
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

  window.addEventListener(
    "pageshow",
    apply
  );

  window.addEventListener(
    "resize",
    apply
  );

  window.addEventListener(
    "orientationchange",
    apply
  );
}());
