# Licenses of the parts Nexa uses

Astute Nexa itself is licensed under the [GNU AGPL-3.0](LICENSE).

Nexa uses 258 open source packages when it runs (counted from `npm ls --omit=dev`). All of them allow use inside an AGPL-3.0 project. Development-only tools are not shipped and are not listed.

## Packages to know about

| Package | License | What it means |
|---|---|---|
| jszip | MIT **or** GPL-3.0-or-later (your choice) | Nexa uses it under the **MIT** option. No GPL terms apply. |
| buffers 0.1.1 (pulled in by exceljs > unzipper > binary) | No license field in its package | The package states no license. Treat it as unclear until confirmed, or replace exceljs's zip reader if your lawyers ask. |

No package uses the GPL, LGPL, MPL, EPL or SSPL as its only license.

## Direct dependencies

| Package | License | Used for |
|---|---|---|
| express | MIT | Web server |
| ws | MIT | Live chat, presence and calls |
| docx | MIT | Saving `.docx` |
| mammoth | BSD-2-Clause | Opening `.docx` |
| exceljs | MIT | Opening and saving `.xlsx` |
| pptxgenjs | MIT | Saving `.pptx` |
| jszip | MIT (dual MIT or GPL-3.0) | Reading `.pptx` |
| htmlparser2, domutils | MIT, BSD-2-Clause | Reading documents |
| sanitize-html | MIT | Cleaning documents and mail |
| nodemailer | MIT-0 | Sending outside mail |

## Counts by license

| License | Packages |
|---|---|
| MIT | 220 |
| ISC | 15 |
| BSD-2-Clause | 8 |
| BSD-3-Clause | 5 |
| Apache-2.0 | 2 |
| Unlicense | 1 |
| UNKNOWN | 1 |
| MIT/X11 | 1 |
| MIT-0 | 1 |
| BlueOak-1.0.0 | 1 |
| BSD | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT AND Zlib) | 1 |

## Full list

<details><summary>Every package and version</summary>

| Package | License |
|---|---|
| @fast-csv/format@4.3.5 | MIT |
| @fast-csv/parse@4.3.6 | MIT |
| @types/node@14.18.63 | MIT |
| @types/node@22.20.5 | MIT |
| @types/node@26.6.7 | MIT |
| @xmldom/xmldom@0.8.15 | MIT |
| accepts@2.0.0 | MIT |
| archiver-utils@2.1.0 | MIT |
| archiver-utils@3.0.4 | MIT |
| archiver@5.3.2 | MIT |
| argparse@1.0.10 | MIT |
| array-buffer-byte-length@1.0.2 | MIT |
| arraybuffer.prototype.slice@1.0.4 | MIT |
| async-function@1.0.0 | MIT |
| async@3.2.6 | MIT |
| available-typed-arrays@1.0.7 | MIT |
| balanced-match@1.0.2 | MIT |
| base64-js@1.5.1 | MIT |
| big-integer@1.6.52 | Unlicense |
| binary@0.3.0 | MIT |
| bl@4.1.0 | MIT |
| bluebird@3.4.7 | MIT |
| body-parser@2.4.0 | MIT |
| brace-expansion@1.1.22 | MIT |
| brace-expansion@2.1.8 | MIT |
| buffer-crc32@0.2.13 | MIT |
| buffer-indexof-polyfill@1.0.2 | MIT |
| buffer@5.7.1 | MIT |
| buffers@0.1.1 | UNKNOWN |
| bytes@3.1.2 | MIT |
| call-bind-apply-helpers@1.0.2 | MIT |
| call-bind@1.0.9 | MIT |
| call-bound@1.0.4 | MIT |
| chainsaw@0.1.0 | MIT/X11 |
| compress-commons@4.1.2 | MIT |
| concat-map@0.0.1 | MIT |
| content-disposition@2.0.1 | MIT |
| content-type@2.1.0 | MIT |
| cookie-signature@1.2.2 | MIT |
| cookie@0.7.2 | MIT |
| core-util-is@1.0.3 | MIT |
| crc-32@1.2.2 | Apache-2.0 |
| crc32-stream@4.0.3 | MIT |
| data-view-buffer@1.0.2 | MIT |
| data-view-byte-length@1.0.2 | MIT |
| data-view-byte-offset@1.0.1 | MIT |
| dayjs@1.11.23 | MIT |
| debug@4.4.3 | MIT |
| define-data-property@1.1.4 | MIT |
| define-properties@1.2.1 | MIT |
| depd@2.0.0 | MIT |
| dingbat-to-unicode@1.0.2 | BSD-2-Clause |
| docx@9.16.0 | MIT |
| dom-serializer@3.1.1 | MIT |
| domelementtype@3.0.0 | BSD-2-Clause |
| domhandler@6.0.1 | BSD-2-Clause |
| domutils@4.0.2 | BSD-2-Clause |
| duck@0.1.12 | BSD |
| dunder-proto@1.0.1 | MIT |
| duplexer2@0.1.4 | BSD-3-Clause |
| ee-first@1.1.1 | MIT |
| encodeurl@2.0.3 | MIT |
| end-of-stream@1.4.5 | MIT |
| entities@8.1.0 | BSD-2-Clause |
| es-abstract-get@1.0.0 | MIT |
| es-abstract@1.24.2 | MIT |
| es-define-property@1.0.1 | MIT |
| es-errors@1.3.0 | MIT |
| es-object-atoms@1.1.2 | MIT |
| es-set-tostringtag@2.1.0 | MIT |
| es-to-primitive@1.3.4 | MIT |
| escape-html@1.0.3 | MIT |
| escape-string-regexp@4.0.0 | MIT |
| etag@1.8.1 | MIT |
| exceljs@4.4.0 | MIT |
| express@5.3.0 | MIT |
| fast-csv@4.3.6 | MIT |
| fflate@0.8.3 | MIT |
| finalhandler@2.1.1 | MIT |
| for-each@0.3.5 | MIT |
| forwarded@0.2.0 | MIT |
| fresh@2.0.0 | MIT |
| fs-constants@1.0.0 | MIT |
| fs.realpath@1.0.0 | ISC |
| fstream@1.0.12 | ISC |
| function-bind@1.1.2 | MIT |
| function.prototype.name@1.2.0 | MIT |
| functions-have-names@1.2.3 | MIT |
| generator-function@2.0.1 | MIT |
| get-intrinsic@1.3.0 | MIT |
| get-proto@1.0.1 | MIT |
| get-symbol-description@1.1.0 | MIT |
| glob@7.2.3 | ISC |
| globalthis@1.0.4 | MIT |
| gopd@1.2.0 | MIT |
| graceful-fs@4.2.12 | BlueOak-1.0.0 |
| has-bigints@1.1.0 | MIT |
| has-property-descriptors@1.0.2 | MIT |
| has-proto@1.2.0 | MIT |
| has-symbols@1.1.0 | MIT |
| has-tostringtag@1.0.2 | MIT |
| hasown@2.0.4 | MIT |
| htmlparser2@12.0.0 | MIT |
| http-errors@2.0.1 | MIT |
| https@1.0.0 | ISC |
| iconv-lite@0.7.3 | MIT |
| ieee754@1.2.1 | BSD-3-Clause |
| image-size@2.1.0 | MIT |
| immediate@3.0.6 | MIT |
| inflight@1.0.6 | ISC |
| inherits@2.0.4 | ISC |
| internal-slot@1.1.0 | MIT |
| ipaddr.js@1.9.1 | MIT |
| is-array-buffer@3.0.5 | MIT |
| is-async-function@2.1.1 | MIT |
| is-bigint@1.1.0 | MIT |
| is-boolean-object@1.2.2 | MIT |
| is-callable@1.2.7 | MIT |
| is-data-view@1.0.2 | MIT |
| is-date-object@1.1.0 | MIT |
| is-document.all@1.0.0 | MIT |
| is-finalizationregistry@1.1.1 | MIT |
| is-generator-function@1.1.2 | MIT |
| is-map@2.0.3 | MIT |
| is-negative-zero@2.0.3 | MIT |
| is-number-object@1.1.1 | MIT |
| is-plain-object@5.1.0 | MIT |
| is-promise@4.0.0 | MIT |
| is-regex@1.2.1 | MIT |
| is-set@2.0.3 | MIT |
| is-shared-array-buffer@1.0.4 | MIT |
| is-string@1.1.1 | MIT |
| is-symbol@1.1.1 | MIT |
| is-typed-array@1.1.15 | MIT |
| is-weakmap@2.0.2 | MIT |
| is-weakref@1.1.1 | MIT |
| is-weakset@2.0.4 | MIT |
| isarray@1.0.0 | MIT |
| isarray@2.0.5 | MIT |
| jszip@3.10.2 | (MIT OR GPL-3.0-or-later) |
| launder@1.7.2 | MIT |
| lazystream@1.0.1 | MIT |
| lie@3.3.0 | MIT |
| listenercount@1.0.1 | ISC |
| lodash.defaults@4.2.0 | MIT |
| lodash.difference@4.5.0 | MIT |
| lodash.escaperegexp@4.1.2 | MIT |
| lodash.flatten@4.4.0 | MIT |
| lodash.groupby@4.6.0 | MIT |
| lodash.isboolean@3.0.3 | MIT |
| lodash.isequal@4.5.0 | MIT |
| lodash.isfunction@3.0.9 | MIT |
| lodash.isnil@4.0.0 | MIT |
| lodash.isplainobject@4.0.6 | MIT |
| lodash.isundefined@3.0.1 | MIT |
| lodash.union@4.6.0 | MIT |
| lodash.uniq@4.5.0 | MIT |
| lop@0.4.2 | BSD-2-Clause |
| mammoth@1.13.0 | BSD-2-Clause |
| math-intrinsics@1.1.0 | MIT |
| media-typer@1.1.1 | MIT |
| merge-descriptors@2.0.0 | MIT |
| mime-db@1.54.0 | MIT |
| mime-types@3.0.2 | MIT |
| minimatch@3.1.5 | ISC |
| minimatch@5.1.9 | ISC |
| minimist@1.2.8 | MIT |
| mkdirp@0.5.6 | MIT |
| ms@2.1.3 | MIT |
| nanoid@3.3.20 | MIT |
| nanoid@6.0.2 | MIT |
| negotiator@1.1.0 | MIT |
| nodemailer@10.6.1 | MIT-0 |
| normalize-path@3.0.0 | MIT |
| object-inspect@1.14.0 | MIT |
| object-keys@1.1.1 | MIT |
| object.assign@4.1.7 | MIT |
| on-finished@2.4.2 | MIT |
| once@1.4.0 | ISC |
| option@0.2.4 | BSD-2-Clause |
| own-keys@1.0.2 | MIT |
| pako@1.0.11 | (MIT AND Zlib) |
| parse-srcset@1.0.2 | MIT |
| parseurl@1.3.3 | MIT |
| path-is-absolute@1.0.1 | MIT |
| path-to-regexp@8.4.2 | MIT |
| picocolors@1.1.1 | ISC |
| possible-typed-array-names@1.1.0 | MIT |
| postcss@8.5.33 | MIT |
| pptxgenjs@4.0.1 | MIT |
| process-nextick-args@2.0.1 | MIT |
| proxy-addr@2.0.8 | MIT |
| qs@6.17.1 | BSD-3-Clause |
| range-parser@1.3.0 | MIT |
| raw-body@3.0.2 | MIT |
| readable-stream@2.3.8 | MIT |
| readable-stream@3.6.2 | MIT |
| readdir-glob@1.1.3 | Apache-2.0 |
| reflect.getprototypeof@1.0.10 | MIT |
| regexp.prototype.flags@1.5.4 | MIT |
| rimraf@2.7.1 | ISC |
| router@2.3.0 | MIT |
| safe-array-concat@1.1.4 | MIT |
| safe-buffer@5.1.2 | MIT |
| safe-buffer@5.2.1 | MIT |
| safe-push-apply@1.0.0 | MIT |
| safe-regex-test@1.1.0 | MIT |
| safer-buffer@2.1.2 | MIT |
| sanitize-html@2.18.2 | MIT |
| saxes@5.0.1 | ISC |
| send@1.2.1 | MIT |
| serve-static@2.2.1 | MIT |
| set-function-length@1.2.2 | MIT |
| set-function-name@2.0.2 | MIT |
| set-proto@1.0.0 | MIT |
| setimmediate@1.0.5 | MIT |
| setprototypeof@1.2.0 | ISC |
| side-channel-list@1.0.1 | MIT |
| side-channel-map@1.0.1 | MIT |
| side-channel-weakmap@1.0.2 | MIT |
| side-channel@1.1.1 | MIT |
| source-map-js@1.2.4 | BSD-3-Clause |
| sprintf-js@1.0.3 | BSD-3-Clause |
| statuses@2.0.2 | MIT |
| stop-iteration-iterator@1.1.0 | MIT |
| string.prototype.trim@1.2.11 | MIT |
| string.prototype.trimend@1.0.10 | MIT |
| string.prototype.trimstart@1.0.8 | MIT |
| string_decoder@1.1.1 | MIT |
| string_decoder@1.3.0 | MIT |
| tar-stream@2.2.0 | MIT |
| tmp@0.2.7 | MIT |
| toidentifier@1.0.1 | MIT |
| traverse@0.3.10 | MIT |
| type-is@2.1.0 | MIT |
| typed-array-buffer@1.0.3 | MIT |
| typed-array-byte-length@1.0.3 | MIT |
| typed-array-byte-offset@1.0.5 | MIT |
| typed-array-length@1.0.8 | MIT |
| typedarray.prototype.slice@1.0.6 | MIT |
| unbox-primitive@1.1.0 | MIT |
| underscore@1.13.8 | MIT |
| undici-types@6.21.0 | MIT |
| undici-types@8.9.0 | MIT |
| unpipe@1.0.0 | MIT |
| unzipper@0.10.14 | MIT |
| util-deprecate@1.0.2 | MIT |
| uuid@11.1.1 | MIT |
| vary@1.1.2 | MIT |
| which-boxed-primitive@1.1.1 | MIT |
| which-builtin-type@1.2.1 | MIT |
| which-collection@1.0.2 | MIT |
| which-typed-array@1.1.24 | MIT |
| wrappy@1.0.2 | ISC |
| ws@8.23.0 | MIT |
| xmlbuilder@10.1.1 | MIT |
| xmlchars@2.2.0 | MIT |
| zip-stream@4.1.1 | MIT |

</details>
