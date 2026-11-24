'use strict';
const sanitizeHtml = require('sanitize-html');

// Allow-list for Write documents. Anything else (scripts, event handlers,
// iframes, javascript: links) is stripped before storage and before export.
const DOC_OPTIONS = {
  allowedTags: ['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'mark', 'sup', 'sub', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'span',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'input'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    input: ['type', 'checked', 'disabled'],
    td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
    li: ['data-checked'],
    ul: ['data-type'],
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i],
      'background-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(bold|[1-9]00)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['data', 'https'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
  },
};

const sanitizeDocHtml = (html) => sanitizeHtml(String(html || ''), DOC_OPTIONS);
const plainText = (s, max = 4000) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);

module.exports = { sanitizeDocHtml, plainText };
