# LifeOS cost-free growth checklist

Release: `lifeos-cost-free-growth-readiness-v2.0.5-20260715`

Final public origin: `https://losai.onrender.com`

## What this release completes

- Every public canonical URL, Open Graph URL, sitemap entry and robots sitemap reference uses `https://losai.onrender.com`.
- Requests reaching the retired `lifeos-ai-voice-app.onrender.com` host are permanently redirected to the matching path on `losai.onrender.com` when that service is running this release.
- A dedicated, uncached `https://losai.onrender.com/health` endpoint is ready for one legitimate external uptime monitor.
- GitHub Actions runs release tests on pushes and pull requests; it is not misused as a hosting keepalive.
- AdSense verification code and `ads.txt` are generated only after a correctly formatted publisher ID is configured.
- Advertising code is restricted to public information pages. Chat, voice, sign-in, administrator, audit and API surfaces remain ad-free.
- The privacy policy contains Google advertising-cookie disclosures and opt-out links.

## Final cost-free domain decision

Google currently permits a domain, a subdomain on a platform included in the Public Suffix List, or a site managed by an AdSense platform partner to be added as an AdSense site. The current Public Suffix List explicitly includes `onrender.com` under Render. Therefore `losai.onrender.com` is structurally eligible to be submitted as its own AdSense site without buying a custom domain.

This is not a promise of approval. Google will still review ownership, original content quality, traffic experience and policy compliance.

- Google AdSense site-management rule: <https://support.google.com/adsense/answer/12170421?hl=en>
- Current Public Suffix List entry for Render: <https://publicsuffix.org/list/public_suffix_list.dat>
- Google AdSense eligibility requirements: <https://support.google.com/adsense/answer/9724?hl=en>

## Cost-free hosting limits

Render allocates 750 Free instance hours per workspace each calendar month. Keeping `losai` warm continuously can consume almost the entire allowance. The retired backup service must remain asleep except during an actual recovery. Do not monitor both services.

Render's internal `healthCheckPath` detects whether a running service is healthy; it does not exempt a Free service from idle spin-down. Render documents Free services as spinning down after 15 minutes without inbound traffic and taking about one minute to wake.

An external five-minute HTTP probe should normally prevent the 15-minute idle condition, but it cannot create paid-tier guarantees. Render may restart a Free service and documents Free instances as unsuitable for production guarantees.

Official references:

- Render Free limits: <https://render.com/docs/free>
- Render uptime and external monitoring guidance: <https://render.com/docs/uptime-best-practices>
- GitHub Actions Additional Product Terms: <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions>

## One-time cost-free uptime monitor

After this release is live, configure one monitor in UptimeRobot's Free plan:

1. Create or sign in to a free UptimeRobot account. A payment card is not required for the Free plan.
2. Choose **New monitor** and select **HTTP(s)**.
3. Set the friendly name to `LifeOS losai health`.
4. Set the URL to `https://losai.onrender.com/health`.
5. Select the Free plan's five-minute interval.
6. Save it and wait until the monitor reports **Up**. The endpoint must return HTTP 200 with the exact body `OK`.
7. Do not add `lifeos-ai-voice-app.onrender.com`; keep that old service only as a recovery backup.

UptimeRobot Free-plan reference: <https://uptimerobot.com/pricing/>

## Google Search Console

1. Add a URL-prefix property for `https://losai.onrender.com/`.
2. Use the HTML-tag verification method. The verification meta tag is already on the home page.
3. Submit `https://losai.onrender.com/sitemap.xml`.
4. Inspect the home page and the main public content pages, then request indexing when Search Console permits it.
5. Confirm that `https://losai.onrender.com/robots.txt` and the sitemap both load while signed out.

## Google AdSense

1. Apply with `https://losai.onrender.com` only after Search Console can see the main public pages.
2. During AdSense setup, choose Google's consent-management platform for the EEA, United Kingdom and Switzerland.
3. Copy the real publisher ID in the form `pub-1234567890123456`.
4. In the Render `losai` service, set `LIFEOS_ADSENSE_PUBLISHER_ID` to that publisher ID and save/deploy.
5. Verify that `/api/release` reports `adsense_configured: true` and `ads_txt_ready: true`.
6. Verify that `https://losai.onrender.com/ads.txt` returns one valid Google seller line.
7. Confirm that AdSense markup appears on `/`, but never on `/chat`, `/voice` or `/admin`.

Do not invent a publisher ID or place advertisements inside Sophia's private conversation interfaces.
