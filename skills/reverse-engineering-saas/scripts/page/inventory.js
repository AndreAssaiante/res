// inventory.js: what the page is built with and what it contains.
// Paste the whole file into the browser's JavaScript tool. The value of the
// last expression is the result. Re-run later with window.__re.inventory().
// Playwright browser_evaluate: wrap as () => { <file>; return window.__re.last; }
(() => {
  const re = (window.__re = window.__re || {});
  const LIMIT = 150;
  const TEST_ID_ATTRIBUTES = [
    'data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy', 'data-e2e',
    'data-pendo-id', 'data-pendo', 'data-automation-id', 'data-component', 'data-name',
  ];
  const SDK_GLOBALS = {
    Sentry: () => window.Sentry || window.__SENTRY__,
    Datadog: () => window.DD_RUM || window.DD_LOGS,
    LaunchDarkly: () => window.LDClient || window.ldclient,
    Statsig: () => window.statsig || window.Statsig,
    Optimizely: () => window.optimizely,
    Segment: () => window.analytics && window.analytics.identify,
    Amplitude: () => window.amplitude,
    Mixpanel: () => window.mixpanel,
    PostHog: () => window.posthog,
    Heap: () => window.heap,
    FullStory: () => window.FS,
    Hotjar: () => window.hj,
    Intercom: () => window.Intercom,
    Pendo: () => window.pendo,
    Appcues: () => window.Appcues,
    Userpilot: () => window.userpilot,
    Zendesk: () => window.zE,
    HubSpot: () => window._hsq,
    'Google Analytics': () => window.gtag || window.ga,
    'Google Tag Manager': () => window.google_tag_manager,
    Stripe: () => window.Stripe,
  };

  const bump = (map, key) => {
    if (key) map[key] = (map[key] || 0) + 1;
  };
  const top = (map, n = LIMIT) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  // Replaces ID-like path segments with :id so routes group together.
  const templatePath = (path) =>
    path
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        if (/^\d+$/.test(segment)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
        if (/\d/.test(segment) && segment.length >= 6 && /^[\w-]+$/.test(segment)) return ':id';
        return segment;
      })
      .join('/');

  const accessibleName = (element) =>
    (element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      (element.getAttribute('aria-labelledby') &&
        document.getElementById(element.getAttribute('aria-labelledby'))?.textContent) ||
      element.labels?.[0]?.textContent ||
      element.textContent ||
      element.getAttribute('placeholder') ||
      element.querySelector('img[alt]')?.alt ||
      '').trim();

  const cssPath = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      let part = node.localName;
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const classes = [...node.classList].slice(0, 2);
      if (classes.length) part += `.${classes.join('.')}`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  const detectFrameworks = (elements) => {
    const found = {};
    const angular = document.querySelector('[ng-version]');
    if (angular) found.Angular = angular.getAttribute('ng-version');
    else if (window.ng || window.getAllAngularRootElements) found.Angular = 'unknown version';
    if (window.angular) found.AngularJS = window.angular.version?.full || 'unknown version';
    const sample = elements.slice(0, 3000);
    if (sample.some((el) => Object.keys(el).some((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$'))) ||
        document.querySelector('[data-reactroot]')) {
      found.React = window.React?.version || 'detected';
    }
    if (window.__VUE__ || document.querySelector('[data-v-app]') || sample.some((el) => el.__vue_app__ || el.__vue__ ||
        [...el.attributes].some((attribute) => attribute.name.startsWith('data-v-')))) {
      found.Vue = window.Vue?.version || 'detected';
    }
    if (sample.some((el) => typeof el.className === 'string' && /\bsvelte-[a-z0-9]+\b/.test(el.className))) found.Svelte = 'detected';
    if (window.__NEXT_DATA__ || document.getElementById('__next')) found['Next.js'] = window.next?.version || 'detected';
    if (window.__NUXT__) found.Nuxt = 'detected';
    if (window.Ember) found.Ember = window.Ember.VERSION || 'detected';
    if (window.jQuery) found.jQuery = window.jQuery.fn?.jquery || 'detected';
    if (window.Backbone) found.Backbone = window.Backbone.VERSION || 'detected';
    if (window.Alpine) found.Alpine = window.Alpine.version || 'detected';
    if (window.htmx) found.htmx = window.htmx.version || 'detected';
    return found;
  };

  const storageKeys = (storage) => {
    try {
      return Object.keys(storage).sort().slice(0, LIMIT);
    } catch {
      return ['(not readable)'];
    }
  };

  re.inventory = function inventory() {
    const elements = [...document.querySelectorAll('body *')];
    const customElements = {};
    const testIds = {};
    const roles = {};
    const classPrefixes = {};
    const routes = {};
    const unnamedControls = [];
    let shadowRoots = 0;
    let utilityClasses = 0;

    for (const element of elements) {
      if (element.localName.includes('-')) bump(customElements, element.localName);
      if (element.shadowRoot) shadowRoots += 1;
      for (const attribute of TEST_ID_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value) bump(testIds, `${attribute}=${value}`);
      }
      bump(roles, element.getAttribute('role'));
      for (const attribute of element.attributes) {
        if (attribute.name.startsWith('data-radix-')) bump(classPrefixes, 'data-radix');
      }
      if (typeof element.className === 'string') {
        for (const token of element.className.split(/\s+/)) {
          const prefix = token.match(/^([A-Za-z]{2,})[-_]/)?.[1];
          bump(classPrefixes, prefix);
          if (/^(m|p)[trblxy]?-\d|^(text|bg)-(xs|sm|base|lg|xl|white|black|\w+-\d{2,3})$|^(flex|grid|hidden|items-center)$/.test(token)) {
            utilityClasses += 1;
          }
        }
      }
      if (element.matches('button, [role="button"], a[href], input:not([type="hidden"]), select, textarea') &&
          !accessibleName(element) && !element.closest('label') && unnamedControls.length < 30) {
        unnamedControls.push(cssPath(element));
      }
    }

    for (const link of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        if (url.origin !== location.origin) continue;
        bump(routes, templatePath(url.pathname) + (url.hash.startsWith('#/') ? templatePath(url.hash) : ''));
      } catch {
        // Ignore unparsable href values.
      }
    }

    const scriptHosts = {};
    for (const script of document.querySelectorAll('script[src]')) {
      try {
        const url = new URL(script.src, location.href);
        bump(scriptHosts, url.origin === location.origin ? '(same origin)' : url.host);
      } catch {
        // Ignore unparsable src values.
      }
    }

    const html = document.documentElement;
    const result = {
      page: {
        title: document.title,
        route: templatePath(location.pathname) + (location.hash.startsWith('#/') ? templatePath(location.hash) : ''),
        lang: html.lang || null,
        viewport: `${innerWidth}x${innerHeight}`,
        themeHints: {
          htmlClass: html.className || null,
          dataTheme: html.getAttribute('data-theme') || document.body.getAttribute('data-theme'),
          prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
        },
        generator: document.querySelector('meta[name="generator"]')?.content || null,
        serviceWorker: Boolean(navigator.serviceWorker?.controller),
        iframes: [...document.querySelectorAll('iframe')].map((frame) => {
          try {
            return new URL(frame.src, location.href).host || '(inline)';
          } catch {
            return '(unknown)';
          }
        }),
      },
      frameworks: detectFrameworks(elements),
      designSystemHints: {
        classPrefixes: top(classPrefixes, 30),
        utilityClassCount: utilityClasses,
      },
      components: {
        customElements: top(customElements),
        testIds: top(testIds),
      },
      accessibility: {
        roles: top(roles, 50),
        landmarks: ['header', 'nav', 'main', 'aside', 'footer', 'dialog'].map((tag) => ({
          name: tag,
          count: document.querySelectorAll(tag).length,
        })),
        unnamedControls,
      },
      routes: top(routes),
      thirdParty: {
        scriptHosts: top(scriptHosts, 50),
        sdks: Object.entries(SDK_GLOBALS)
          .filter(([, probe]) => {
            try {
              return Boolean(probe());
            } catch {
              return false;
            }
          })
          .map(([name]) => name),
      },
      storageKeys: { localStorage: storageKeys(localStorage), sessionStorage: storageKeys(sessionStorage) },
      notes: [
        `Scanned ${elements.length} elements in the main document.`,
        shadowRoots ? `${shadowRoots} open shadow roots were not scanned.` : null,
        'Storage lists key names only, never values.',
      ].filter(Boolean),
    };
    re.last = result;
    return result;
  };

  return re.inventory();
})();
