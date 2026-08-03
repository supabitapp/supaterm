function loadAnalytics() {
  return import("posthog-js").then(({ posthog }) => posthog);
}

function initializeAnalytics() {
  void loadAnalytics().then((analytics) => {
    analytics.init("phc_AwJsG6OgXpxwREkX5OW41cZ1tjjoLplTif5KbocleFx", {
      api_host: "https://p.supaterm.com",
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      person_profiles: "identified_only",
    });
  });
}

function capture(event: string) {
  void loadAnalytics().then((analytics) => analytics.capture(event));
}

export { capture, initializeAnalytics };
