// mask.js: blurs personal data before a screenshot of a production screen.
// Paste the whole file into the browser's JavaScript tool. It masks at once.
//   window.__re.mask.apply({ selectors: ['.customer-name'], names: ['Maria Silva'], avatars: true })
//   window.__re.mask.clear()
// Run it right before each screenshot: apps re-render and drop the mask.
// Playwright browser_evaluate: wrap as () => { <file>; return window.__re.last; }
(() => {
  const re = (window.__re = window.__re || {});
  const CLASS = '__re-masked';
  const STYLE_ID = '__re-mask-style';
  const PATTERNS = {
    email: /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i,
    phone: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4}\b/,
    money: /(?:R\$|US\$|\$|€|£)\s?\d[\d.,]*/,
    cpf: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
    cnpj: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  };

  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function apply(options = {}) {
    const patterns = { ...PATTERNS };
    for (const [i, name] of (options.names || []).entries()) patterns[`name${i + 1}`] = new RegExp(escapeRegExp(name), 'i');
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `.${CLASS}{filter:blur(6px)!important}`;
      document.head.appendChild(style);
    }
    const counts = {};
    const mark = (element, reason) => {
      if (!element || element === document.body || element === document.documentElement) return;
      if (!element.classList.contains(CLASS)) {
        element.classList.add(CLASS);
        counts[reason] = (counts[reason] || 0) + 1;
      }
    };

    for (const selector of options.selectors || []) {
      for (const element of document.querySelectorAll(selector)) mark(element, `selector ${selector}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue;
      if (!text || !text.trim()) continue;
      for (const [reason, pattern] of Object.entries(patterns)) {
        if (pattern.test(text)) {
          mark(node.parentElement, reason);
          break;
        }
      }
    }
    for (const field of document.querySelectorAll('input, textarea')) {
      for (const [reason, pattern] of Object.entries(patterns)) {
        if (field.value && pattern.test(field.value)) {
          mark(field, reason);
          break;
        }
      }
    }
    if (options.avatars !== false) {
      for (const image of document.querySelectorAll('img')) {
        const rect = image.getBoundingClientRect();
        const round = parseFloat(getComputedStyle(image).borderTopLeftRadius) >= rect.width / 3;
        if (rect.width > 0 && rect.width <= 64 && (round || /avatar|profile|user/i.test(`${image.className} ${image.alt}`))) mark(image, 'avatar');
      }
    }
    const result = { masked: Object.values(counts).reduce((a, b) => a + b, 0), byReason: counts };
    re.last = result;
    return result;
  }

  function clear() {
    for (const element of document.querySelectorAll(`.${CLASS}`)) element.classList.remove(CLASS);
    document.getElementById(STYLE_ID)?.remove();
    re.last = { cleared: true };
    return re.last;
  }

  re.mask = { apply, clear };
  return apply();
})();
