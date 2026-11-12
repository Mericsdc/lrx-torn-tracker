'use strict';
// Runs in <head> before the first paint. The page is written in English; a visitor who chose Turkish on
// lrxe8.com is repainted by LRXe8-tt.js, so hide the text briefly to avoid a flash of English.
document.documentElement.classList.add('js');
try {
  if (localStorage.getItem('lrxe8-locale') === 'tr') {
    document.documentElement.lang = 'tr';
    document.documentElement.classList.add('lang-wait');
    setTimeout(() => document.documentElement.classList.remove('lang-wait'), 1500);
  }
} catch {}
