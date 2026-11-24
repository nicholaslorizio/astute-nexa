/* Deck themes, shared by the browser editor and the .pptx exporter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexaThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const THEMES = {
    aurora: { name: 'Aurora', bg: '#0B1020', text: '#EEF1FF', muted: '#9AA3C7', accent: '#7C5CFF', accent2: '#22D3EE', font: "'Inter', system-ui, sans-serif", fontPptx: 'Segoe UI' },
    daybreak: { name: 'Daybreak', bg: '#FFFFFF', text: '#141A33', muted: '#5B6385', accent: '#3D5AFE', accent2: '#FF6B4A', font: "'Inter', system-ui, sans-serif", fontPptx: 'Segoe UI' },
    ember: { name: 'Ember', bg: '#1A0F0A', text: '#FFF4EC', muted: '#D9A88E', accent: '#FF6B35', accent2: '#FFC145', font: "'Inter', system-ui, sans-serif", fontPptx: 'Segoe UI' },
    glacier: { name: 'Glacier', bg: '#EAF6FB', text: '#0C2733', muted: '#4D6B78', accent: '#0EA5C6', accent2: '#10B981', font: "Georgia, 'Times New Roman', serif", fontPptx: 'Georgia' },
    terminal: { name: 'Terminal', bg: '#050A06', text: '#C8FFD4', muted: '#5FA06F', accent: '#22C55E', accent2: '#A3E635', font: "'JetBrains Mono', ui-monospace, monospace", fontPptx: 'Consolas' },
  };
  return { THEMES };
});
