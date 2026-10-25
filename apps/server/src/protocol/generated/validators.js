/* Generated. Do not edit. */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    try {
      return (
        mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
        mod.exports
      );
    } catch (e) {
      throw ((mod = 0), e);
    }
  };

// ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  '../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js'(exports) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320) pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  },
});

// ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  '../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/formats.js'(
    exports,
  ) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      'date-time': fmtDef(getDateTime(true), compareDateTime),
      'iso-time': fmtDef(getTime(), compareIsoTime),
      'iso-date-time': fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      'uri-reference':
        /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      'uri-template':
        /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email:
        /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname:
        /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      'json-pointer-uri-fragment': /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: 'number', validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: 'number', validate: validateInt64 },
      // C-type float
      float: { type: 'number', validate: validateNumber },
      // C-type double
      double: { type: 'number', validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true,
    };
    exports.fastFormats = {
      ...exports.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(
        /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i,
        compareTime,
      ),
      'date-time': fmtDef(
        /^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i,
        compareDateTime,
      ),
      'iso-time': fmtDef(
        /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i,
        compareIsoTime,
      ),
      'iso-date-time': fmtDef(
        /^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i,
        compareIsoDateTime,
      ),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      'uri-reference': /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email:
        /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
    };
    exports.formatNames = Object.keys(exports.fullFormats);
    function isLeapYear(year) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }
    var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
    var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function date(str) {
      const matches = DATE.exec(str);
      if (!matches) return false;
      const year = +matches[1];
      const month = +matches[2];
      const day = +matches[3];
      return (
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month])
      );
    }
    function compareDate(d1, d2) {
      if (!(d1 && d2)) return void 0;
      if (d1 > d2) return 1;
      if (d1 < d2) return -1;
      return 0;
    }
    var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function getTime(strictTimeZone) {
      return function time(str) {
        const matches = TIME.exec(str);
        if (!matches) return false;
        const hr = +matches[1];
        const min = +matches[2];
        const sec = +matches[3];
        const tz = matches[4];
        const tzSign = matches[5] === '-' ? -1 : 1;
        const tzH = +(matches[6] || 0);
        const tzM = +(matches[7] || 0);
        if (tzH > 23 || tzM > 59 || (strictTimeZone && !tz)) return false;
        if (hr <= 23 && min <= 59 && sec < 60) return true;
        const utcMin = min - tzM * tzSign;
        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
      };
    }
    function compareTime(s1, s2) {
      if (!(s1 && s2)) return void 0;
      const t1 = /* @__PURE__ */ new Date('2020-01-01T' + s1).valueOf();
      const t2 = /* @__PURE__ */ new Date('2020-01-01T' + s2).valueOf();
      if (!(t1 && t2)) return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2)) return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2)) return void 0;
      t1 = a1[1] + a1[2] + a1[3];
      t2 = a2[1] + a2[2] + a2[3];
      if (t1 > t2) return 1;
      if (t1 < t2) return -1;
      return 0;
    }
    var DATE_TIME_SEPARATOR = /t|\s/i;
    function getDateTime(strictTimeZone) {
      const time = getTime(strictTimeZone);
      return function date_time(str) {
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
      };
    }
    function compareDateTime(dt1, dt2) {
      if (!(dt1 && dt2)) return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2)) return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2)) return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0) return void 0;
      return res || compareTime(t1, t2);
    }
    var NOT_URI_FRAGMENT = /\/|:/;
    var URI =
      /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function uri(str) {
      return NOT_URI_FRAGMENT.test(str) && URI.test(str);
    }
    var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function byte(str) {
      BYTE.lastIndex = 0;
      return BYTE.test(str);
    }
    var MIN_INT32 = -(2 ** 31);
    var MAX_INT32 = 2 ** 31 - 1;
    function validateInt32(value) {
      return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
    }
    function validateInt64(value) {
      return Number.isInteger(value);
    }
    function validateNumber() {
      return true;
    }
    var Z_ANCHOR = /[^\\]\\Z/;
    function regex(str) {
      if (Z_ANCHOR.test(str)) return false;
      try {
        new RegExp(str);
        return true;
      } catch (e) {
        return false;
      }
    }
  },
});

// validators.js
var validateServerInfo = validate109;
var schema32 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'requestId',
    'serverId',
    'eventEpoch',
    'serverVersion',
    'protocol',
    'readiness',
    'capabilities',
    'time',
  ],
  properties: {
    schemaVersion: { const: 1 },
    requestId: { $ref: '#/$defs/Uuid' },
    serverId: { $ref: '#/$defs/Uuid' },
    eventEpoch: { $ref: '#/$defs/Uuid' },
    serverVersion: { type: 'string', minLength: 1, maxLength: 64 },
    protocol: { $ref: '#/$defs/ProtocolRange' },
    readiness: { $ref: '#/$defs/Readiness' },
    capabilities: { $ref: '#/$defs/ServerCapabilities' },
    time: { $ref: '#/$defs/Timestamp' },
  },
};
var schema37 = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'phase', 'reason'],
  properties: {
    ready: { type: 'boolean' },
    phase: { enum: ['starting', 'ready', 'stopping', 'failed'] },
    reason: { enum: ['STARTING', 'READY', 'STOPPING', 'PERSISTENCE_UNAVAILABLE'] },
  },
  oneOf: [
    {
      properties: {
        ready: { const: false },
        phase: { const: 'starting' },
        reason: { const: 'STARTING' },
      },
    },
    {
      properties: { ready: { const: true }, phase: { const: 'ready' }, reason: { const: 'READY' } },
    },
    {
      properties: {
        ready: { const: false },
        phase: { const: 'stopping' },
        reason: { const: 'STOPPING' },
      },
    },
    {
      properties: {
        ready: { const: false },
        phase: { const: 'failed' },
        reason: { const: 'PERSISTENCE_UNAVAILABLE' },
      },
    },
  ],
};
var func1 = Object.prototype.hasOwnProperty;
var func2 = require_ucs2length().default;
var formats0 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var formats6 = require_formats().fastFormats['date-time'];
function validate109(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate109.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.serverId === void 0 && (missing0 = 'serverId')) ||
        (data.eventEpoch === void 0 && (missing0 = 'eventEpoch')) ||
        (data.serverVersion === void 0 && (missing0 = 'serverVersion')) ||
        (data.protocol === void 0 && (missing0 = 'protocol')) ||
        (data.readiness === void 0 && (missing0 = 'readiness')) ||
        (data.capabilities === void 0 && (missing0 = 'capabilities')) ||
        (data.time === void 0 && (missing0 = 'time'))
      ) {
        validate109.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema32.properties, key0)) {
            validate109.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate109.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate109.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate109.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate109.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate109.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.serverId !== void 0) {
                let data2 = data.serverId;
                const _errs6 = errors;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (errors === _errs7) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        validate109.errors = [
                          {
                            instancePath: instancePath + '/serverId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func2(data2) < 36) {
                          validate109.errors = [
                            {
                              instancePath: instancePath + '/serverId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!formats0.test(data2)) {
                            validate109.errors = [
                              {
                                instancePath: instancePath + '/serverId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    } else {
                      validate109.errors = [
                        {
                          instancePath: instancePath + '/serverId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.eventEpoch !== void 0) {
                  let data3 = data.eventEpoch;
                  const _errs9 = errors;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (errors === _errs10) {
                      if (typeof data3 === 'string') {
                        if (func2(data3) > 36) {
                          validate109.errors = [
                            {
                              instancePath: instancePath + '/eventEpoch',
                              schemaPath: '#/$defs/Uuid/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 36 },
                              message: 'must NOT have more than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func2(data3) < 36) {
                            validate109.errors = [
                              {
                                instancePath: instancePath + '/eventEpoch',
                                schemaPath: '#/$defs/Uuid/minLength',
                                keyword: 'minLength',
                                params: { limit: 36 },
                                message: 'must NOT have fewer than 36 characters',
                              },
                            ];
                            return false;
                          } else {
                            if (!formats0.test(data3)) {
                              validate109.errors = [
                                {
                                  instancePath: instancePath + '/eventEpoch',
                                  schemaPath: '#/$defs/Uuid/format',
                                  keyword: 'format',
                                  params: { format: 'uuid' },
                                  message: 'must match format "uuid"',
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      } else {
                        validate109.errors = [
                          {
                            instancePath: instancePath + '/eventEpoch',
                            schemaPath: '#/$defs/Uuid/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.serverVersion !== void 0) {
                    let data4 = data.serverVersion;
                    const _errs12 = errors;
                    if (errors === _errs12) {
                      if (typeof data4 === 'string') {
                        if (func2(data4) > 64) {
                          validate109.errors = [
                            {
                              instancePath: instancePath + '/serverVersion',
                              schemaPath: '#/properties/serverVersion/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 64 },
                              message: 'must NOT have more than 64 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func2(data4) < 1) {
                            validate109.errors = [
                              {
                                instancePath: instancePath + '/serverVersion',
                                schemaPath: '#/properties/serverVersion/minLength',
                                keyword: 'minLength',
                                params: { limit: 1 },
                                message: 'must NOT have fewer than 1 characters',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate109.errors = [
                          {
                            instancePath: instancePath + '/serverVersion',
                            schemaPath: '#/properties/serverVersion/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.protocol !== void 0) {
                      let data5 = data.protocol;
                      const _errs14 = errors;
                      const _errs15 = errors;
                      if (errors === _errs15) {
                        if (data5 && typeof data5 == 'object' && !Array.isArray(data5)) {
                          let missing1;
                          if (
                            (data5.min === void 0 && (missing1 = 'min')) ||
                            (data5.max === void 0 && (missing1 = 'max'))
                          ) {
                            validate109.errors = [
                              {
                                instancePath: instancePath + '/protocol',
                                schemaPath: '#/$defs/ProtocolRange/required',
                                keyword: 'required',
                                params: { missingProperty: missing1 },
                                message: "must have required property '" + missing1 + "'",
                              },
                            ];
                            return false;
                          } else {
                            const _errs17 = errors;
                            for (const key1 in data5) {
                              if (!(key1 === 'min' || key1 === 'max')) {
                                validate109.errors = [
                                  {
                                    instancePath: instancePath + '/protocol',
                                    schemaPath: '#/$defs/ProtocolRange/additionalProperties',
                                    keyword: 'additionalProperties',
                                    params: { additionalProperty: key1 },
                                    message: 'must NOT have additional properties',
                                  },
                                ];
                                return false;
                                break;
                              }
                            }
                            if (_errs17 === errors) {
                              if (data5.min !== void 0) {
                                const _errs18 = errors;
                                if (0 !== data5.min) {
                                  validate109.errors = [
                                    {
                                      instancePath: instancePath + '/protocol/min',
                                      schemaPath: '#/$defs/ProtocolRange/properties/min/const',
                                      keyword: 'const',
                                      params: { allowedValue: 0 },
                                      message: 'must be equal to constant',
                                    },
                                  ];
                                  return false;
                                }
                                var valid5 = _errs18 === errors;
                              } else {
                                var valid5 = true;
                              }
                              if (valid5) {
                                if (data5.max !== void 0) {
                                  const _errs19 = errors;
                                  if (0 !== data5.max) {
                                    validate109.errors = [
                                      {
                                        instancePath: instancePath + '/protocol/max',
                                        schemaPath: '#/$defs/ProtocolRange/properties/max/const',
                                        keyword: 'const',
                                        params: { allowedValue: 0 },
                                        message: 'must be equal to constant',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid5 = _errs19 === errors;
                                } else {
                                  var valid5 = true;
                                }
                              }
                            }
                          }
                        } else {
                          validate109.errors = [
                            {
                              instancePath: instancePath + '/protocol',
                              schemaPath: '#/$defs/ProtocolRange/type',
                              keyword: 'type',
                              params: { type: 'object' },
                              message: 'must be object',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.readiness !== void 0) {
                        let data8 = data.readiness;
                        const _errs20 = errors;
                        const _errs21 = errors;
                        const _errs23 = errors;
                        let valid7 = false;
                        let passing0 = null;
                        const _errs24 = errors;
                        if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                          if (data8.ready !== void 0) {
                            const _errs25 = errors;
                            if (false !== data8.ready) {
                              const err0 = {
                                instancePath: instancePath + '/readiness/ready',
                                schemaPath: '#/$defs/Readiness/oneOf/0/properties/ready/const',
                                keyword: 'const',
                                params: { allowedValue: false },
                                message: 'must be equal to constant',
                              };
                              if (vErrors === null) {
                                vErrors = [err0];
                              } else {
                                vErrors.push(err0);
                              }
                              errors++;
                            }
                            var valid8 = _errs25 === errors;
                          } else {
                            var valid8 = true;
                          }
                          if (valid8) {
                            if (data8.phase !== void 0) {
                              const _errs26 = errors;
                              if ('starting' !== data8.phase) {
                                const err1 = {
                                  instancePath: instancePath + '/readiness/phase',
                                  schemaPath: '#/$defs/Readiness/oneOf/0/properties/phase/const',
                                  keyword: 'const',
                                  params: { allowedValue: 'starting' },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err1];
                                } else {
                                  vErrors.push(err1);
                                }
                                errors++;
                              }
                              var valid8 = _errs26 === errors;
                            } else {
                              var valid8 = true;
                            }
                            if (valid8) {
                              if (data8.reason !== void 0) {
                                const _errs27 = errors;
                                if ('STARTING' !== data8.reason) {
                                  const err2 = {
                                    instancePath: instancePath + '/readiness/reason',
                                    schemaPath: '#/$defs/Readiness/oneOf/0/properties/reason/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'STARTING' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err2];
                                  } else {
                                    vErrors.push(err2);
                                  }
                                  errors++;
                                }
                                var valid8 = _errs27 === errors;
                              } else {
                                var valid8 = true;
                              }
                            }
                          }
                        }
                        var _valid0 = _errs24 === errors;
                        if (_valid0) {
                          valid7 = true;
                          passing0 = 0;
                          var props0 = {};
                          props0.ready = true;
                          props0.phase = true;
                          props0.reason = true;
                        }
                        const _errs28 = errors;
                        if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                          if (data8.ready !== void 0) {
                            const _errs29 = errors;
                            if (true !== data8.ready) {
                              const err3 = {
                                instancePath: instancePath + '/readiness/ready',
                                schemaPath: '#/$defs/Readiness/oneOf/1/properties/ready/const',
                                keyword: 'const',
                                params: { allowedValue: true },
                                message: 'must be equal to constant',
                              };
                              if (vErrors === null) {
                                vErrors = [err3];
                              } else {
                                vErrors.push(err3);
                              }
                              errors++;
                            }
                            var valid9 = _errs29 === errors;
                          } else {
                            var valid9 = true;
                          }
                          if (valid9) {
                            if (data8.phase !== void 0) {
                              const _errs30 = errors;
                              if ('ready' !== data8.phase) {
                                const err4 = {
                                  instancePath: instancePath + '/readiness/phase',
                                  schemaPath: '#/$defs/Readiness/oneOf/1/properties/phase/const',
                                  keyword: 'const',
                                  params: { allowedValue: 'ready' },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err4];
                                } else {
                                  vErrors.push(err4);
                                }
                                errors++;
                              }
                              var valid9 = _errs30 === errors;
                            } else {
                              var valid9 = true;
                            }
                            if (valid9) {
                              if (data8.reason !== void 0) {
                                const _errs31 = errors;
                                if ('READY' !== data8.reason) {
                                  const err5 = {
                                    instancePath: instancePath + '/readiness/reason',
                                    schemaPath: '#/$defs/Readiness/oneOf/1/properties/reason/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'READY' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err5];
                                  } else {
                                    vErrors.push(err5);
                                  }
                                  errors++;
                                }
                                var valid9 = _errs31 === errors;
                              } else {
                                var valid9 = true;
                              }
                            }
                          }
                        }
                        var _valid0 = _errs28 === errors;
                        if (_valid0 && valid7) {
                          valid7 = false;
                          passing0 = [passing0, 1];
                        } else {
                          if (_valid0) {
                            valid7 = true;
                            passing0 = 1;
                            if (props0 !== true) {
                              props0 = props0 || {};
                              props0.ready = true;
                              props0.phase = true;
                              props0.reason = true;
                            }
                          }
                          const _errs32 = errors;
                          if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                            if (data8.ready !== void 0) {
                              const _errs33 = errors;
                              if (false !== data8.ready) {
                                const err6 = {
                                  instancePath: instancePath + '/readiness/ready',
                                  schemaPath: '#/$defs/Readiness/oneOf/2/properties/ready/const',
                                  keyword: 'const',
                                  params: { allowedValue: false },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err6];
                                } else {
                                  vErrors.push(err6);
                                }
                                errors++;
                              }
                              var valid10 = _errs33 === errors;
                            } else {
                              var valid10 = true;
                            }
                            if (valid10) {
                              if (data8.phase !== void 0) {
                                const _errs34 = errors;
                                if ('stopping' !== data8.phase) {
                                  const err7 = {
                                    instancePath: instancePath + '/readiness/phase',
                                    schemaPath: '#/$defs/Readiness/oneOf/2/properties/phase/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'stopping' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err7];
                                  } else {
                                    vErrors.push(err7);
                                  }
                                  errors++;
                                }
                                var valid10 = _errs34 === errors;
                              } else {
                                var valid10 = true;
                              }
                              if (valid10) {
                                if (data8.reason !== void 0) {
                                  const _errs35 = errors;
                                  if ('STOPPING' !== data8.reason) {
                                    const err8 = {
                                      instancePath: instancePath + '/readiness/reason',
                                      schemaPath:
                                        '#/$defs/Readiness/oneOf/2/properties/reason/const',
                                      keyword: 'const',
                                      params: { allowedValue: 'STOPPING' },
                                      message: 'must be equal to constant',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err8];
                                    } else {
                                      vErrors.push(err8);
                                    }
                                    errors++;
                                  }
                                  var valid10 = _errs35 === errors;
                                } else {
                                  var valid10 = true;
                                }
                              }
                            }
                          }
                          var _valid0 = _errs32 === errors;
                          if (_valid0 && valid7) {
                            valid7 = false;
                            passing0 = [passing0, 2];
                          } else {
                            if (_valid0) {
                              valid7 = true;
                              passing0 = 2;
                              if (props0 !== true) {
                                props0 = props0 || {};
                                props0.ready = true;
                                props0.phase = true;
                                props0.reason = true;
                              }
                            }
                            const _errs36 = errors;
                            if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                              if (data8.ready !== void 0) {
                                const _errs37 = errors;
                                if (false !== data8.ready) {
                                  const err9 = {
                                    instancePath: instancePath + '/readiness/ready',
                                    schemaPath: '#/$defs/Readiness/oneOf/3/properties/ready/const',
                                    keyword: 'const',
                                    params: { allowedValue: false },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err9];
                                  } else {
                                    vErrors.push(err9);
                                  }
                                  errors++;
                                }
                                var valid11 = _errs37 === errors;
                              } else {
                                var valid11 = true;
                              }
                              if (valid11) {
                                if (data8.phase !== void 0) {
                                  const _errs38 = errors;
                                  if ('failed' !== data8.phase) {
                                    const err10 = {
                                      instancePath: instancePath + '/readiness/phase',
                                      schemaPath:
                                        '#/$defs/Readiness/oneOf/3/properties/phase/const',
                                      keyword: 'const',
                                      params: { allowedValue: 'failed' },
                                      message: 'must be equal to constant',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err10];
                                    } else {
                                      vErrors.push(err10);
                                    }
                                    errors++;
                                  }
                                  var valid11 = _errs38 === errors;
                                } else {
                                  var valid11 = true;
                                }
                                if (valid11) {
                                  if (data8.reason !== void 0) {
                                    const _errs39 = errors;
                                    if ('PERSISTENCE_UNAVAILABLE' !== data8.reason) {
                                      const err11 = {
                                        instancePath: instancePath + '/readiness/reason',
                                        schemaPath:
                                          '#/$defs/Readiness/oneOf/3/properties/reason/const',
                                        keyword: 'const',
                                        params: { allowedValue: 'PERSISTENCE_UNAVAILABLE' },
                                        message: 'must be equal to constant',
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err11];
                                      } else {
                                        vErrors.push(err11);
                                      }
                                      errors++;
                                    }
                                    var valid11 = _errs39 === errors;
                                  } else {
                                    var valid11 = true;
                                  }
                                }
                              }
                            }
                            var _valid0 = _errs36 === errors;
                            if (_valid0 && valid7) {
                              valid7 = false;
                              passing0 = [passing0, 3];
                            } else {
                              if (_valid0) {
                                valid7 = true;
                                passing0 = 3;
                                if (props0 !== true) {
                                  props0 = props0 || {};
                                  props0.ready = true;
                                  props0.phase = true;
                                  props0.reason = true;
                                }
                              }
                            }
                          }
                        }
                        if (!valid7) {
                          const err12 = {
                            instancePath: instancePath + '/readiness',
                            schemaPath: '#/$defs/Readiness/oneOf',
                            keyword: 'oneOf',
                            params: { passingSchemas: passing0 },
                            message: 'must match exactly one schema in oneOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err12];
                          } else {
                            vErrors.push(err12);
                          }
                          errors++;
                          validate109.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs23;
                          if (vErrors !== null) {
                            if (_errs23) {
                              vErrors.length = _errs23;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        if (errors === _errs21) {
                          if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                            let missing2;
                            if (
                              (data8.ready === void 0 && (missing2 = 'ready')) ||
                              (data8.phase === void 0 && (missing2 = 'phase')) ||
                              (data8.reason === void 0 && (missing2 = 'reason'))
                            ) {
                              validate109.errors = [
                                {
                                  instancePath: instancePath + '/readiness',
                                  schemaPath: '#/$defs/Readiness/required',
                                  keyword: 'required',
                                  params: { missingProperty: missing2 },
                                  message: "must have required property '" + missing2 + "'",
                                },
                              ];
                              return false;
                            } else {
                              const _errs40 = errors;
                              for (const key2 in data8) {
                                if (!(key2 === 'ready' || key2 === 'phase' || key2 === 'reason')) {
                                  validate109.errors = [
                                    {
                                      instancePath: instancePath + '/readiness',
                                      schemaPath: '#/$defs/Readiness/additionalProperties',
                                      keyword: 'additionalProperties',
                                      params: { additionalProperty: key2 },
                                      message: 'must NOT have additional properties',
                                    },
                                  ];
                                  return false;
                                  break;
                                }
                              }
                              if (_errs40 === errors) {
                                if (data8.ready !== void 0) {
                                  const _errs41 = errors;
                                  if (typeof data8.ready !== 'boolean') {
                                    validate109.errors = [
                                      {
                                        instancePath: instancePath + '/readiness/ready',
                                        schemaPath: '#/$defs/Readiness/properties/ready/type',
                                        keyword: 'type',
                                        params: { type: 'boolean' },
                                        message: 'must be boolean',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid12 = _errs41 === errors;
                                } else {
                                  var valid12 = true;
                                }
                                if (valid12) {
                                  if (data8.phase !== void 0) {
                                    let data22 = data8.phase;
                                    const _errs43 = errors;
                                    if (!(
                                      data22 === 'starting' ||
                                      data22 === 'ready' ||
                                      data22 === 'stopping' ||
                                      data22 === 'failed'
                                    )) {
                                      validate109.errors = [
                                        {
                                          instancePath: instancePath + '/readiness/phase',
                                          schemaPath: '#/$defs/Readiness/properties/phase/enum',
                                          keyword: 'enum',
                                          params: { allowedValues: schema37.properties.phase.enum },
                                          message: 'must be equal to one of the allowed values',
                                        },
                                      ];
                                      return false;
                                    }
                                    var valid12 = _errs43 === errors;
                                  } else {
                                    var valid12 = true;
                                  }
                                  if (valid12) {
                                    if (data8.reason !== void 0) {
                                      let data23 = data8.reason;
                                      const _errs44 = errors;
                                      if (!(
                                        data23 === 'STARTING' ||
                                        data23 === 'READY' ||
                                        data23 === 'STOPPING' ||
                                        data23 === 'PERSISTENCE_UNAVAILABLE'
                                      )) {
                                        validate109.errors = [
                                          {
                                            instancePath: instancePath + '/readiness/reason',
                                            schemaPath: '#/$defs/Readiness/properties/reason/enum',
                                            keyword: 'enum',
                                            params: {
                                              allowedValues: schema37.properties.reason.enum,
                                            },
                                            message: 'must be equal to one of the allowed values',
                                          },
                                        ];
                                        return false;
                                      }
                                      var valid12 = _errs44 === errors;
                                    } else {
                                      var valid12 = true;
                                    }
                                  }
                                }
                              }
                            }
                          } else {
                            validate109.errors = [
                              {
                                instancePath: instancePath + '/readiness',
                                schemaPath: '#/$defs/Readiness/type',
                                keyword: 'type',
                                params: { type: 'object' },
                                message: 'must be object',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs20 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.capabilities !== void 0) {
                          let data24 = data.capabilities;
                          const _errs45 = errors;
                          const _errs46 = errors;
                          if (errors === _errs46) {
                            if (data24 && typeof data24 == 'object' && !Array.isArray(data24)) {
                              let missing3;
                              if (
                                (data24.commands === void 0 && (missing3 = 'commands')) ||
                                (data24.events === void 0 && (missing3 = 'events')) ||
                                (data24.pairing === void 0 && (missing3 = 'pairing')) ||
                                (data24.nodeTypes === void 0 && (missing3 = 'nodeTypes')) ||
                                (data24.harnesses === void 0 && (missing3 = 'harnesses'))
                              ) {
                                validate109.errors = [
                                  {
                                    instancePath: instancePath + '/capabilities',
                                    schemaPath: '#/$defs/ServerCapabilities/required',
                                    keyword: 'required',
                                    params: { missingProperty: missing3 },
                                    message: "must have required property '" + missing3 + "'",
                                  },
                                ];
                                return false;
                              } else {
                                const _errs48 = errors;
                                for (const key3 in data24) {
                                  if (!(
                                    key3 === 'commands' ||
                                    key3 === 'events' ||
                                    key3 === 'pairing' ||
                                    key3 === 'nodeTypes' ||
                                    key3 === 'harnesses'
                                  )) {
                                    validate109.errors = [
                                      {
                                        instancePath: instancePath + '/capabilities',
                                        schemaPath:
                                          '#/$defs/ServerCapabilities/additionalProperties',
                                        keyword: 'additionalProperties',
                                        params: { additionalProperty: key3 },
                                        message: 'must NOT have additional properties',
                                      },
                                    ];
                                    return false;
                                    break;
                                  }
                                }
                                if (_errs48 === errors) {
                                  if (data24.commands !== void 0) {
                                    const _errs49 = errors;
                                    if (typeof data24.commands !== 'boolean') {
                                      validate109.errors = [
                                        {
                                          instancePath: instancePath + '/capabilities/commands',
                                          schemaPath:
                                            '#/$defs/ServerCapabilities/properties/commands/type',
                                          keyword: 'type',
                                          params: { type: 'boolean' },
                                          message: 'must be boolean',
                                        },
                                      ];
                                      return false;
                                    }
                                    var valid14 = _errs49 === errors;
                                  } else {
                                    var valid14 = true;
                                  }
                                  if (valid14) {
                                    if (data24.events !== void 0) {
                                      const _errs51 = errors;
                                      if (typeof data24.events !== 'boolean') {
                                        validate109.errors = [
                                          {
                                            instancePath: instancePath + '/capabilities/events',
                                            schemaPath:
                                              '#/$defs/ServerCapabilities/properties/events/type',
                                            keyword: 'type',
                                            params: { type: 'boolean' },
                                            message: 'must be boolean',
                                          },
                                        ];
                                        return false;
                                      }
                                      var valid14 = _errs51 === errors;
                                    } else {
                                      var valid14 = true;
                                    }
                                    if (valid14) {
                                      if (data24.pairing !== void 0) {
                                        const _errs53 = errors;
                                        if (typeof data24.pairing !== 'boolean') {
                                          validate109.errors = [
                                            {
                                              instancePath: instancePath + '/capabilities/pairing',
                                              schemaPath:
                                                '#/$defs/ServerCapabilities/properties/pairing/type',
                                              keyword: 'type',
                                              params: { type: 'boolean' },
                                              message: 'must be boolean',
                                            },
                                          ];
                                          return false;
                                        }
                                        var valid14 = _errs53 === errors;
                                      } else {
                                        var valid14 = true;
                                      }
                                      if (valid14) {
                                        if (data24.nodeTypes !== void 0) {
                                          let data28 = data24.nodeTypes;
                                          const _errs55 = errors;
                                          if (errors === _errs55) {
                                            if (Array.isArray(data28)) {
                                              if (data28.length > 0) {
                                                validate109.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/capabilities/nodeTypes',
                                                    schemaPath:
                                                      '#/$defs/ServerCapabilities/properties/nodeTypes/maxItems',
                                                    keyword: 'maxItems',
                                                    params: { limit: 0 },
                                                    message: 'must NOT have more than 0 items',
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                var valid15 = true;
                                                const len0 = data28.length;
                                                for (let i0 = 0; i0 < len0; i0++) {
                                                  let data29 = data28[i0];
                                                  const _errs57 = errors;
                                                  if (!(
                                                    data29 &&
                                                    typeof data29 == 'object' &&
                                                    !Array.isArray(data29)
                                                  )) {
                                                    validate109.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          '/capabilities/nodeTypes/' +
                                                          i0,
                                                        schemaPath:
                                                          '#/$defs/ServerCapabilities/properties/nodeTypes/items/type',
                                                        keyword: 'type',
                                                        params: { type: 'object' },
                                                        message: 'must be object',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                  var valid15 = _errs57 === errors;
                                                  if (!valid15) {
                                                    break;
                                                  }
                                                }
                                              }
                                            } else {
                                              validate109.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + '/capabilities/nodeTypes',
                                                  schemaPath:
                                                    '#/$defs/ServerCapabilities/properties/nodeTypes/type',
                                                  keyword: 'type',
                                                  params: { type: 'array' },
                                                  message: 'must be array',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                          var valid14 = _errs55 === errors;
                                        } else {
                                          var valid14 = true;
                                        }
                                        if (valid14) {
                                          if (data24.harnesses !== void 0) {
                                            let data30 = data24.harnesses;
                                            const _errs59 = errors;
                                            if (errors === _errs59) {
                                              if (Array.isArray(data30)) {
                                                if (data30.length > 0) {
                                                  validate109.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath + '/capabilities/harnesses',
                                                      schemaPath:
                                                        '#/$defs/ServerCapabilities/properties/harnesses/maxItems',
                                                      keyword: 'maxItems',
                                                      params: { limit: 0 },
                                                      message: 'must NOT have more than 0 items',
                                                    },
                                                  ];
                                                  return false;
                                                } else {
                                                  var valid16 = true;
                                                  const len1 = data30.length;
                                                  for (let i1 = 0; i1 < len1; i1++) {
                                                    let data31 = data30[i1];
                                                    const _errs61 = errors;
                                                    if (!(
                                                      data31 &&
                                                      typeof data31 == 'object' &&
                                                      !Array.isArray(data31)
                                                    )) {
                                                      validate109.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            '/capabilities/harnesses/' +
                                                            i1,
                                                          schemaPath:
                                                            '#/$defs/ServerCapabilities/properties/harnesses/items/type',
                                                          keyword: 'type',
                                                          params: { type: 'object' },
                                                          message: 'must be object',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                    var valid16 = _errs61 === errors;
                                                    if (!valid16) {
                                                      break;
                                                    }
                                                  }
                                                }
                                              } else {
                                                validate109.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/capabilities/harnesses',
                                                    schemaPath:
                                                      '#/$defs/ServerCapabilities/properties/harnesses/type',
                                                    keyword: 'type',
                                                    params: { type: 'array' },
                                                    message: 'must be array',
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                            var valid14 = _errs59 === errors;
                                          } else {
                                            var valid14 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            } else {
                              validate109.errors = [
                                {
                                  instancePath: instancePath + '/capabilities',
                                  schemaPath: '#/$defs/ServerCapabilities/type',
                                  keyword: 'type',
                                  params: { type: 'object' },
                                  message: 'must be object',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs45 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.time !== void 0) {
                            let data32 = data.time;
                            const _errs63 = errors;
                            const _errs64 = errors;
                            if (errors === _errs64) {
                              if (data32 && typeof data32 == 'object' && !Array.isArray(data32)) {
                                let missing4;
                                if (
                                  (data32.epochMs === void 0 && (missing4 = 'epochMs')) ||
                                  (data32.iso === void 0 && (missing4 = 'iso'))
                                ) {
                                  validate109.errors = [
                                    {
                                      instancePath: instancePath + '/time',
                                      schemaPath: '#/$defs/Timestamp/required',
                                      keyword: 'required',
                                      params: { missingProperty: missing4 },
                                      message: "must have required property '" + missing4 + "'",
                                    },
                                  ];
                                  return false;
                                } else {
                                  const _errs66 = errors;
                                  for (const key4 in data32) {
                                    if (!(key4 === 'epochMs' || key4 === 'iso')) {
                                      validate109.errors = [
                                        {
                                          instancePath: instancePath + '/time',
                                          schemaPath: '#/$defs/Timestamp/additionalProperties',
                                          keyword: 'additionalProperties',
                                          params: { additionalProperty: key4 },
                                          message: 'must NOT have additional properties',
                                        },
                                      ];
                                      return false;
                                      break;
                                    }
                                  }
                                  if (_errs66 === errors) {
                                    if (data32.epochMs !== void 0) {
                                      let data33 = data32.epochMs;
                                      const _errs67 = errors;
                                      if (!(
                                        typeof data33 == 'number' &&
                                        !(data33 % 1) &&
                                        !isNaN(data33) &&
                                        isFinite(data33)
                                      )) {
                                        validate109.errors = [
                                          {
                                            instancePath: instancePath + '/time/epochMs',
                                            schemaPath: '#/$defs/Timestamp/properties/epochMs/type',
                                            keyword: 'type',
                                            params: { type: 'integer' },
                                            message: 'must be integer',
                                          },
                                        ];
                                        return false;
                                      }
                                      if (errors === _errs67) {
                                        if (typeof data33 == 'number' && isFinite(data33)) {
                                          if (data33 > 864e13 || isNaN(data33)) {
                                            validate109.errors = [
                                              {
                                                instancePath: instancePath + '/time/epochMs',
                                                schemaPath:
                                                  '#/$defs/Timestamp/properties/epochMs/maximum',
                                                keyword: 'maximum',
                                                params: { comparison: '<=', limit: 864e13 },
                                                message: 'must be <= 8640000000000000',
                                              },
                                            ];
                                            return false;
                                          } else {
                                            if (data33 < 0 || isNaN(data33)) {
                                              validate109.errors = [
                                                {
                                                  instancePath: instancePath + '/time/epochMs',
                                                  schemaPath:
                                                    '#/$defs/Timestamp/properties/epochMs/minimum',
                                                  keyword: 'minimum',
                                                  params: { comparison: '>=', limit: 0 },
                                                  message: 'must be >= 0',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                        }
                                      }
                                      var valid18 = _errs67 === errors;
                                    } else {
                                      var valid18 = true;
                                    }
                                    if (valid18) {
                                      if (data32.iso !== void 0) {
                                        let data34 = data32.iso;
                                        const _errs69 = errors;
                                        if (errors === _errs69) {
                                          if (errors === _errs69) {
                                            if (typeof data34 === 'string') {
                                              if (func2(data34) > 32) {
                                                validate109.errors = [
                                                  {
                                                    instancePath: instancePath + '/time/iso',
                                                    schemaPath:
                                                      '#/$defs/Timestamp/properties/iso/maxLength',
                                                    keyword: 'maxLength',
                                                    params: { limit: 32 },
                                                    message:
                                                      'must NOT have more than 32 characters',
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                if (!formats6.validate.test(data34)) {
                                                  validate109.errors = [
                                                    {
                                                      instancePath: instancePath + '/time/iso',
                                                      schemaPath:
                                                        '#/$defs/Timestamp/properties/iso/format',
                                                      keyword: 'format',
                                                      params: { format: 'date-time' },
                                                      message: 'must match format "date-time"',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            } else {
                                              validate109.errors = [
                                                {
                                                  instancePath: instancePath + '/time/iso',
                                                  schemaPath:
                                                    '#/$defs/Timestamp/properties/iso/type',
                                                  keyword: 'type',
                                                  params: { type: 'string' },
                                                  message: 'must be string',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                        }
                                        var valid18 = _errs69 === errors;
                                      } else {
                                        var valid18 = true;
                                      }
                                    }
                                  }
                                }
                              } else {
                                validate109.errors = [
                                  {
                                    instancePath: instancePath + '/time',
                                    schemaPath: '#/$defs/Timestamp/type',
                                    keyword: 'type',
                                    params: { type: 'object' },
                                    message: 'must be object',
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs63 === errors;
                          } else {
                            var valid0 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate109.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate109.errors = vErrors;
  return errors === 0;
}
validate109.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateServerHealth = validate110;
function validate110(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate110.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.serverId === void 0 && (missing0 = 'serverId')) ||
        (data.eventEpoch === void 0 && (missing0 = 'eventEpoch')) ||
        (data.protocol === void 0 && (missing0 = 'protocol')) ||
        (data.liveness === void 0 && (missing0 = 'liveness')) ||
        (data.readiness === void 0 && (missing0 = 'readiness')) ||
        (data.time === void 0 && (missing0 = 'time'))
      ) {
        validate110.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'serverId' ||
            key0 === 'eventEpoch' ||
            key0 === 'protocol' ||
            key0 === 'liveness' ||
            key0 === 'readiness' ||
            key0 === 'time'
          )) {
            validate110.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate110.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate110.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate110.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate110.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate110.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.serverId !== void 0) {
                let data2 = data.serverId;
                const _errs6 = errors;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (errors === _errs7) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        validate110.errors = [
                          {
                            instancePath: instancePath + '/serverId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func2(data2) < 36) {
                          validate110.errors = [
                            {
                              instancePath: instancePath + '/serverId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!formats0.test(data2)) {
                            validate110.errors = [
                              {
                                instancePath: instancePath + '/serverId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    } else {
                      validate110.errors = [
                        {
                          instancePath: instancePath + '/serverId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.eventEpoch !== void 0) {
                  let data3 = data.eventEpoch;
                  const _errs9 = errors;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (errors === _errs10) {
                      if (typeof data3 === 'string') {
                        if (func2(data3) > 36) {
                          validate110.errors = [
                            {
                              instancePath: instancePath + '/eventEpoch',
                              schemaPath: '#/$defs/Uuid/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 36 },
                              message: 'must NOT have more than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func2(data3) < 36) {
                            validate110.errors = [
                              {
                                instancePath: instancePath + '/eventEpoch',
                                schemaPath: '#/$defs/Uuid/minLength',
                                keyword: 'minLength',
                                params: { limit: 36 },
                                message: 'must NOT have fewer than 36 characters',
                              },
                            ];
                            return false;
                          } else {
                            if (!formats0.test(data3)) {
                              validate110.errors = [
                                {
                                  instancePath: instancePath + '/eventEpoch',
                                  schemaPath: '#/$defs/Uuid/format',
                                  keyword: 'format',
                                  params: { format: 'uuid' },
                                  message: 'must match format "uuid"',
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      } else {
                        validate110.errors = [
                          {
                            instancePath: instancePath + '/eventEpoch',
                            schemaPath: '#/$defs/Uuid/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.protocol !== void 0) {
                    let data4 = data.protocol;
                    const _errs12 = errors;
                    const _errs13 = errors;
                    if (errors === _errs13) {
                      if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
                        let missing1;
                        if (
                          (data4.min === void 0 && (missing1 = 'min')) ||
                          (data4.max === void 0 && (missing1 = 'max'))
                        ) {
                          validate110.errors = [
                            {
                              instancePath: instancePath + '/protocol',
                              schemaPath: '#/$defs/ProtocolRange/required',
                              keyword: 'required',
                              params: { missingProperty: missing1 },
                              message: "must have required property '" + missing1 + "'",
                            },
                          ];
                          return false;
                        } else {
                          const _errs15 = errors;
                          for (const key1 in data4) {
                            if (!(key1 === 'min' || key1 === 'max')) {
                              validate110.errors = [
                                {
                                  instancePath: instancePath + '/protocol',
                                  schemaPath: '#/$defs/ProtocolRange/additionalProperties',
                                  keyword: 'additionalProperties',
                                  params: { additionalProperty: key1 },
                                  message: 'must NOT have additional properties',
                                },
                              ];
                              return false;
                              break;
                            }
                          }
                          if (_errs15 === errors) {
                            if (data4.min !== void 0) {
                              const _errs16 = errors;
                              if (0 !== data4.min) {
                                validate110.errors = [
                                  {
                                    instancePath: instancePath + '/protocol/min',
                                    schemaPath: '#/$defs/ProtocolRange/properties/min/const',
                                    keyword: 'const',
                                    params: { allowedValue: 0 },
                                    message: 'must be equal to constant',
                                  },
                                ];
                                return false;
                              }
                              var valid5 = _errs16 === errors;
                            } else {
                              var valid5 = true;
                            }
                            if (valid5) {
                              if (data4.max !== void 0) {
                                const _errs17 = errors;
                                if (0 !== data4.max) {
                                  validate110.errors = [
                                    {
                                      instancePath: instancePath + '/protocol/max',
                                      schemaPath: '#/$defs/ProtocolRange/properties/max/const',
                                      keyword: 'const',
                                      params: { allowedValue: 0 },
                                      message: 'must be equal to constant',
                                    },
                                  ];
                                  return false;
                                }
                                var valid5 = _errs17 === errors;
                              } else {
                                var valid5 = true;
                              }
                            }
                          }
                        }
                      } else {
                        validate110.errors = [
                          {
                            instancePath: instancePath + '/protocol',
                            schemaPath: '#/$defs/ProtocolRange/type',
                            keyword: 'type',
                            params: { type: 'object' },
                            message: 'must be object',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.liveness !== void 0) {
                      const _errs18 = errors;
                      if ('alive' !== data.liveness) {
                        validate110.errors = [
                          {
                            instancePath: instancePath + '/liveness',
                            schemaPath: '#/properties/liveness/const',
                            keyword: 'const',
                            params: { allowedValue: 'alive' },
                            message: 'must be equal to constant',
                          },
                        ];
                        return false;
                      }
                      var valid0 = _errs18 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.readiness !== void 0) {
                        let data8 = data.readiness;
                        const _errs19 = errors;
                        const _errs20 = errors;
                        const _errs22 = errors;
                        let valid7 = false;
                        let passing0 = null;
                        const _errs23 = errors;
                        if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                          if (data8.ready !== void 0) {
                            const _errs24 = errors;
                            if (false !== data8.ready) {
                              const err0 = {
                                instancePath: instancePath + '/readiness/ready',
                                schemaPath: '#/$defs/Readiness/oneOf/0/properties/ready/const',
                                keyword: 'const',
                                params: { allowedValue: false },
                                message: 'must be equal to constant',
                              };
                              if (vErrors === null) {
                                vErrors = [err0];
                              } else {
                                vErrors.push(err0);
                              }
                              errors++;
                            }
                            var valid8 = _errs24 === errors;
                          } else {
                            var valid8 = true;
                          }
                          if (valid8) {
                            if (data8.phase !== void 0) {
                              const _errs25 = errors;
                              if ('starting' !== data8.phase) {
                                const err1 = {
                                  instancePath: instancePath + '/readiness/phase',
                                  schemaPath: '#/$defs/Readiness/oneOf/0/properties/phase/const',
                                  keyword: 'const',
                                  params: { allowedValue: 'starting' },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err1];
                                } else {
                                  vErrors.push(err1);
                                }
                                errors++;
                              }
                              var valid8 = _errs25 === errors;
                            } else {
                              var valid8 = true;
                            }
                            if (valid8) {
                              if (data8.reason !== void 0) {
                                const _errs26 = errors;
                                if ('STARTING' !== data8.reason) {
                                  const err2 = {
                                    instancePath: instancePath + '/readiness/reason',
                                    schemaPath: '#/$defs/Readiness/oneOf/0/properties/reason/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'STARTING' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err2];
                                  } else {
                                    vErrors.push(err2);
                                  }
                                  errors++;
                                }
                                var valid8 = _errs26 === errors;
                              } else {
                                var valid8 = true;
                              }
                            }
                          }
                        }
                        var _valid0 = _errs23 === errors;
                        if (_valid0) {
                          valid7 = true;
                          passing0 = 0;
                          var props0 = {};
                          props0.ready = true;
                          props0.phase = true;
                          props0.reason = true;
                        }
                        const _errs27 = errors;
                        if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                          if (data8.ready !== void 0) {
                            const _errs28 = errors;
                            if (true !== data8.ready) {
                              const err3 = {
                                instancePath: instancePath + '/readiness/ready',
                                schemaPath: '#/$defs/Readiness/oneOf/1/properties/ready/const',
                                keyword: 'const',
                                params: { allowedValue: true },
                                message: 'must be equal to constant',
                              };
                              if (vErrors === null) {
                                vErrors = [err3];
                              } else {
                                vErrors.push(err3);
                              }
                              errors++;
                            }
                            var valid9 = _errs28 === errors;
                          } else {
                            var valid9 = true;
                          }
                          if (valid9) {
                            if (data8.phase !== void 0) {
                              const _errs29 = errors;
                              if ('ready' !== data8.phase) {
                                const err4 = {
                                  instancePath: instancePath + '/readiness/phase',
                                  schemaPath: '#/$defs/Readiness/oneOf/1/properties/phase/const',
                                  keyword: 'const',
                                  params: { allowedValue: 'ready' },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err4];
                                } else {
                                  vErrors.push(err4);
                                }
                                errors++;
                              }
                              var valid9 = _errs29 === errors;
                            } else {
                              var valid9 = true;
                            }
                            if (valid9) {
                              if (data8.reason !== void 0) {
                                const _errs30 = errors;
                                if ('READY' !== data8.reason) {
                                  const err5 = {
                                    instancePath: instancePath + '/readiness/reason',
                                    schemaPath: '#/$defs/Readiness/oneOf/1/properties/reason/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'READY' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err5];
                                  } else {
                                    vErrors.push(err5);
                                  }
                                  errors++;
                                }
                                var valid9 = _errs30 === errors;
                              } else {
                                var valid9 = true;
                              }
                            }
                          }
                        }
                        var _valid0 = _errs27 === errors;
                        if (_valid0 && valid7) {
                          valid7 = false;
                          passing0 = [passing0, 1];
                        } else {
                          if (_valid0) {
                            valid7 = true;
                            passing0 = 1;
                            if (props0 !== true) {
                              props0 = props0 || {};
                              props0.ready = true;
                              props0.phase = true;
                              props0.reason = true;
                            }
                          }
                          const _errs31 = errors;
                          if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                            if (data8.ready !== void 0) {
                              const _errs32 = errors;
                              if (false !== data8.ready) {
                                const err6 = {
                                  instancePath: instancePath + '/readiness/ready',
                                  schemaPath: '#/$defs/Readiness/oneOf/2/properties/ready/const',
                                  keyword: 'const',
                                  params: { allowedValue: false },
                                  message: 'must be equal to constant',
                                };
                                if (vErrors === null) {
                                  vErrors = [err6];
                                } else {
                                  vErrors.push(err6);
                                }
                                errors++;
                              }
                              var valid10 = _errs32 === errors;
                            } else {
                              var valid10 = true;
                            }
                            if (valid10) {
                              if (data8.phase !== void 0) {
                                const _errs33 = errors;
                                if ('stopping' !== data8.phase) {
                                  const err7 = {
                                    instancePath: instancePath + '/readiness/phase',
                                    schemaPath: '#/$defs/Readiness/oneOf/2/properties/phase/const',
                                    keyword: 'const',
                                    params: { allowedValue: 'stopping' },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err7];
                                  } else {
                                    vErrors.push(err7);
                                  }
                                  errors++;
                                }
                                var valid10 = _errs33 === errors;
                              } else {
                                var valid10 = true;
                              }
                              if (valid10) {
                                if (data8.reason !== void 0) {
                                  const _errs34 = errors;
                                  if ('STOPPING' !== data8.reason) {
                                    const err8 = {
                                      instancePath: instancePath + '/readiness/reason',
                                      schemaPath:
                                        '#/$defs/Readiness/oneOf/2/properties/reason/const',
                                      keyword: 'const',
                                      params: { allowedValue: 'STOPPING' },
                                      message: 'must be equal to constant',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err8];
                                    } else {
                                      vErrors.push(err8);
                                    }
                                    errors++;
                                  }
                                  var valid10 = _errs34 === errors;
                                } else {
                                  var valid10 = true;
                                }
                              }
                            }
                          }
                          var _valid0 = _errs31 === errors;
                          if (_valid0 && valid7) {
                            valid7 = false;
                            passing0 = [passing0, 2];
                          } else {
                            if (_valid0) {
                              valid7 = true;
                              passing0 = 2;
                              if (props0 !== true) {
                                props0 = props0 || {};
                                props0.ready = true;
                                props0.phase = true;
                                props0.reason = true;
                              }
                            }
                            const _errs35 = errors;
                            if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                              if (data8.ready !== void 0) {
                                const _errs36 = errors;
                                if (false !== data8.ready) {
                                  const err9 = {
                                    instancePath: instancePath + '/readiness/ready',
                                    schemaPath: '#/$defs/Readiness/oneOf/3/properties/ready/const',
                                    keyword: 'const',
                                    params: { allowedValue: false },
                                    message: 'must be equal to constant',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err9];
                                  } else {
                                    vErrors.push(err9);
                                  }
                                  errors++;
                                }
                                var valid11 = _errs36 === errors;
                              } else {
                                var valid11 = true;
                              }
                              if (valid11) {
                                if (data8.phase !== void 0) {
                                  const _errs37 = errors;
                                  if ('failed' !== data8.phase) {
                                    const err10 = {
                                      instancePath: instancePath + '/readiness/phase',
                                      schemaPath:
                                        '#/$defs/Readiness/oneOf/3/properties/phase/const',
                                      keyword: 'const',
                                      params: { allowedValue: 'failed' },
                                      message: 'must be equal to constant',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err10];
                                    } else {
                                      vErrors.push(err10);
                                    }
                                    errors++;
                                  }
                                  var valid11 = _errs37 === errors;
                                } else {
                                  var valid11 = true;
                                }
                                if (valid11) {
                                  if (data8.reason !== void 0) {
                                    const _errs38 = errors;
                                    if ('PERSISTENCE_UNAVAILABLE' !== data8.reason) {
                                      const err11 = {
                                        instancePath: instancePath + '/readiness/reason',
                                        schemaPath:
                                          '#/$defs/Readiness/oneOf/3/properties/reason/const',
                                        keyword: 'const',
                                        params: { allowedValue: 'PERSISTENCE_UNAVAILABLE' },
                                        message: 'must be equal to constant',
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err11];
                                      } else {
                                        vErrors.push(err11);
                                      }
                                      errors++;
                                    }
                                    var valid11 = _errs38 === errors;
                                  } else {
                                    var valid11 = true;
                                  }
                                }
                              }
                            }
                            var _valid0 = _errs35 === errors;
                            if (_valid0 && valid7) {
                              valid7 = false;
                              passing0 = [passing0, 3];
                            } else {
                              if (_valid0) {
                                valid7 = true;
                                passing0 = 3;
                                if (props0 !== true) {
                                  props0 = props0 || {};
                                  props0.ready = true;
                                  props0.phase = true;
                                  props0.reason = true;
                                }
                              }
                            }
                          }
                        }
                        if (!valid7) {
                          const err12 = {
                            instancePath: instancePath + '/readiness',
                            schemaPath: '#/$defs/Readiness/oneOf',
                            keyword: 'oneOf',
                            params: { passingSchemas: passing0 },
                            message: 'must match exactly one schema in oneOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err12];
                          } else {
                            vErrors.push(err12);
                          }
                          errors++;
                          validate110.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs22;
                          if (vErrors !== null) {
                            if (_errs22) {
                              vErrors.length = _errs22;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        if (errors === _errs20) {
                          if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
                            let missing2;
                            if (
                              (data8.ready === void 0 && (missing2 = 'ready')) ||
                              (data8.phase === void 0 && (missing2 = 'phase')) ||
                              (data8.reason === void 0 && (missing2 = 'reason'))
                            ) {
                              validate110.errors = [
                                {
                                  instancePath: instancePath + '/readiness',
                                  schemaPath: '#/$defs/Readiness/required',
                                  keyword: 'required',
                                  params: { missingProperty: missing2 },
                                  message: "must have required property '" + missing2 + "'",
                                },
                              ];
                              return false;
                            } else {
                              const _errs39 = errors;
                              for (const key2 in data8) {
                                if (!(key2 === 'ready' || key2 === 'phase' || key2 === 'reason')) {
                                  validate110.errors = [
                                    {
                                      instancePath: instancePath + '/readiness',
                                      schemaPath: '#/$defs/Readiness/additionalProperties',
                                      keyword: 'additionalProperties',
                                      params: { additionalProperty: key2 },
                                      message: 'must NOT have additional properties',
                                    },
                                  ];
                                  return false;
                                  break;
                                }
                              }
                              if (_errs39 === errors) {
                                if (data8.ready !== void 0) {
                                  const _errs40 = errors;
                                  if (typeof data8.ready !== 'boolean') {
                                    validate110.errors = [
                                      {
                                        instancePath: instancePath + '/readiness/ready',
                                        schemaPath: '#/$defs/Readiness/properties/ready/type',
                                        keyword: 'type',
                                        params: { type: 'boolean' },
                                        message: 'must be boolean',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid12 = _errs40 === errors;
                                } else {
                                  var valid12 = true;
                                }
                                if (valid12) {
                                  if (data8.phase !== void 0) {
                                    let data22 = data8.phase;
                                    const _errs42 = errors;
                                    if (!(
                                      data22 === 'starting' ||
                                      data22 === 'ready' ||
                                      data22 === 'stopping' ||
                                      data22 === 'failed'
                                    )) {
                                      validate110.errors = [
                                        {
                                          instancePath: instancePath + '/readiness/phase',
                                          schemaPath: '#/$defs/Readiness/properties/phase/enum',
                                          keyword: 'enum',
                                          params: { allowedValues: schema37.properties.phase.enum },
                                          message: 'must be equal to one of the allowed values',
                                        },
                                      ];
                                      return false;
                                    }
                                    var valid12 = _errs42 === errors;
                                  } else {
                                    var valid12 = true;
                                  }
                                  if (valid12) {
                                    if (data8.reason !== void 0) {
                                      let data23 = data8.reason;
                                      const _errs43 = errors;
                                      if (!(
                                        data23 === 'STARTING' ||
                                        data23 === 'READY' ||
                                        data23 === 'STOPPING' ||
                                        data23 === 'PERSISTENCE_UNAVAILABLE'
                                      )) {
                                        validate110.errors = [
                                          {
                                            instancePath: instancePath + '/readiness/reason',
                                            schemaPath: '#/$defs/Readiness/properties/reason/enum',
                                            keyword: 'enum',
                                            params: {
                                              allowedValues: schema37.properties.reason.enum,
                                            },
                                            message: 'must be equal to one of the allowed values',
                                          },
                                        ];
                                        return false;
                                      }
                                      var valid12 = _errs43 === errors;
                                    } else {
                                      var valid12 = true;
                                    }
                                  }
                                }
                              }
                            }
                          } else {
                            validate110.errors = [
                              {
                                instancePath: instancePath + '/readiness',
                                schemaPath: '#/$defs/Readiness/type',
                                keyword: 'type',
                                params: { type: 'object' },
                                message: 'must be object',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs19 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.time !== void 0) {
                          let data24 = data.time;
                          const _errs44 = errors;
                          const _errs45 = errors;
                          if (errors === _errs45) {
                            if (data24 && typeof data24 == 'object' && !Array.isArray(data24)) {
                              let missing3;
                              if (
                                (data24.epochMs === void 0 && (missing3 = 'epochMs')) ||
                                (data24.iso === void 0 && (missing3 = 'iso'))
                              ) {
                                validate110.errors = [
                                  {
                                    instancePath: instancePath + '/time',
                                    schemaPath: '#/$defs/Timestamp/required',
                                    keyword: 'required',
                                    params: { missingProperty: missing3 },
                                    message: "must have required property '" + missing3 + "'",
                                  },
                                ];
                                return false;
                              } else {
                                const _errs47 = errors;
                                for (const key3 in data24) {
                                  if (!(key3 === 'epochMs' || key3 === 'iso')) {
                                    validate110.errors = [
                                      {
                                        instancePath: instancePath + '/time',
                                        schemaPath: '#/$defs/Timestamp/additionalProperties',
                                        keyword: 'additionalProperties',
                                        params: { additionalProperty: key3 },
                                        message: 'must NOT have additional properties',
                                      },
                                    ];
                                    return false;
                                    break;
                                  }
                                }
                                if (_errs47 === errors) {
                                  if (data24.epochMs !== void 0) {
                                    let data25 = data24.epochMs;
                                    const _errs48 = errors;
                                    if (!(
                                      typeof data25 == 'number' &&
                                      !(data25 % 1) &&
                                      !isNaN(data25) &&
                                      isFinite(data25)
                                    )) {
                                      validate110.errors = [
                                        {
                                          instancePath: instancePath + '/time/epochMs',
                                          schemaPath: '#/$defs/Timestamp/properties/epochMs/type',
                                          keyword: 'type',
                                          params: { type: 'integer' },
                                          message: 'must be integer',
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs48) {
                                      if (typeof data25 == 'number' && isFinite(data25)) {
                                        if (data25 > 864e13 || isNaN(data25)) {
                                          validate110.errors = [
                                            {
                                              instancePath: instancePath + '/time/epochMs',
                                              schemaPath:
                                                '#/$defs/Timestamp/properties/epochMs/maximum',
                                              keyword: 'maximum',
                                              params: { comparison: '<=', limit: 864e13 },
                                              message: 'must be <= 8640000000000000',
                                            },
                                          ];
                                          return false;
                                        } else {
                                          if (data25 < 0 || isNaN(data25)) {
                                            validate110.errors = [
                                              {
                                                instancePath: instancePath + '/time/epochMs',
                                                schemaPath:
                                                  '#/$defs/Timestamp/properties/epochMs/minimum',
                                                keyword: 'minimum',
                                                params: { comparison: '>=', limit: 0 },
                                                message: 'must be >= 0',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                    }
                                    var valid14 = _errs48 === errors;
                                  } else {
                                    var valid14 = true;
                                  }
                                  if (valid14) {
                                    if (data24.iso !== void 0) {
                                      let data26 = data24.iso;
                                      const _errs50 = errors;
                                      if (errors === _errs50) {
                                        if (errors === _errs50) {
                                          if (typeof data26 === 'string') {
                                            if (func2(data26) > 32) {
                                              validate110.errors = [
                                                {
                                                  instancePath: instancePath + '/time/iso',
                                                  schemaPath:
                                                    '#/$defs/Timestamp/properties/iso/maxLength',
                                                  keyword: 'maxLength',
                                                  params: { limit: 32 },
                                                  message: 'must NOT have more than 32 characters',
                                                },
                                              ];
                                              return false;
                                            } else {
                                              if (!formats6.validate.test(data26)) {
                                                validate110.errors = [
                                                  {
                                                    instancePath: instancePath + '/time/iso',
                                                    schemaPath:
                                                      '#/$defs/Timestamp/properties/iso/format',
                                                    keyword: 'format',
                                                    params: { format: 'date-time' },
                                                    message: 'must match format "date-time"',
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                          } else {
                                            validate110.errors = [
                                              {
                                                instancePath: instancePath + '/time/iso',
                                                schemaPath: '#/$defs/Timestamp/properties/iso/type',
                                                keyword: 'type',
                                                params: { type: 'string' },
                                                message: 'must be string',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                      var valid14 = _errs50 === errors;
                                    } else {
                                      var valid14 = true;
                                    }
                                  }
                                }
                              }
                            } else {
                              validate110.errors = [
                                {
                                  instancePath: instancePath + '/time',
                                  schemaPath: '#/$defs/Timestamp/type',
                                  keyword: 'type',
                                  params: { type: 'object' },
                                  message: 'must be object',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs44 === errors;
                        } else {
                          var valid0 = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate110.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate110.errors = vErrors;
  return errors === 0;
}
validate110.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateProtocolError = validate111;
var pattern4 = new RegExp('^[A-Z][A-Z0-9_]{0,63}$', 'u');
function validate111(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate111.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.code === void 0 && (missing0 = 'code')) ||
        (data.message === void 0 && (missing0 = 'message')) ||
        (data.retryable === void 0 && (missing0 = 'retryable')) ||
        (data.diagnostics === void 0 && (missing0 = 'diagnostics'))
      ) {
        validate111.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'code' ||
            key0 === 'message' ||
            key0 === 'retryable' ||
            key0 === 'diagnostics'
          )) {
            validate111.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate111.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate111.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate111.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate111.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate111.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.code !== void 0) {
                let data2 = data.code;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === 'string') {
                    if (!pattern4.test(data2)) {
                      validate111.errors = [
                        {
                          instancePath: instancePath + '/code',
                          schemaPath: '#/properties/code/pattern',
                          keyword: 'pattern',
                          params: { pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
                          message: 'must match pattern "^[A-Z][A-Z0-9_]{0,63}$"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate111.errors = [
                      {
                        instancePath: instancePath + '/code',
                        schemaPath: '#/properties/code/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.message !== void 0) {
                  let data3 = data.message;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 512) {
                        validate111.errors = [
                          {
                            instancePath: instancePath + '/message',
                            schemaPath: '#/properties/message/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 512 },
                            message: 'must NOT have more than 512 characters',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate111.errors = [
                        {
                          instancePath: instancePath + '/message',
                          schemaPath: '#/properties/message/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.retryable !== void 0) {
                    const _errs10 = errors;
                    if (typeof data.retryable !== 'boolean') {
                      validate111.errors = [
                        {
                          instancePath: instancePath + '/retryable',
                          schemaPath: '#/properties/retryable/type',
                          keyword: 'type',
                          params: { type: 'boolean' },
                          message: 'must be boolean',
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.diagnostics !== void 0) {
                      let data5 = data.diagnostics;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (Array.isArray(data5)) {
                          if (data5.length > 32) {
                            validate111.errors = [
                              {
                                instancePath: instancePath + '/diagnostics',
                                schemaPath: '#/properties/diagnostics/maxItems',
                                keyword: 'maxItems',
                                params: { limit: 32 },
                                message: 'must NOT have more than 32 items',
                              },
                            ];
                            return false;
                          } else {
                            var valid2 = true;
                            const len0 = data5.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                              let data6 = data5[i0];
                              const _errs14 = errors;
                              const _errs15 = errors;
                              if (errors === _errs15) {
                                if (data6 && typeof data6 == 'object' && !Array.isArray(data6)) {
                                  let missing1;
                                  if (
                                    (data6.field === void 0 && (missing1 = 'field')) ||
                                    (data6.message === void 0 && (missing1 = 'message'))
                                  ) {
                                    validate111.errors = [
                                      {
                                        instancePath: instancePath + '/diagnostics/' + i0,
                                        schemaPath: '#/$defs/Diagnostic/required',
                                        keyword: 'required',
                                        params: { missingProperty: missing1 },
                                        message: "must have required property '" + missing1 + "'",
                                      },
                                    ];
                                    return false;
                                  } else {
                                    const _errs17 = errors;
                                    for (const key1 in data6) {
                                      if (!(key1 === 'field' || key1 === 'message')) {
                                        validate111.errors = [
                                          {
                                            instancePath: instancePath + '/diagnostics/' + i0,
                                            schemaPath: '#/$defs/Diagnostic/additionalProperties',
                                            keyword: 'additionalProperties',
                                            params: { additionalProperty: key1 },
                                            message: 'must NOT have additional properties',
                                          },
                                        ];
                                        return false;
                                        break;
                                      }
                                    }
                                    if (_errs17 === errors) {
                                      if (data6.field !== void 0) {
                                        let data7 = data6.field;
                                        const _errs18 = errors;
                                        if (errors === _errs18) {
                                          if (typeof data7 === 'string') {
                                            if (func2(data7) > 256) {
                                              validate111.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + '/diagnostics/' + i0 + '/field',
                                                  schemaPath:
                                                    '#/$defs/Diagnostic/properties/field/maxLength',
                                                  keyword: 'maxLength',
                                                  params: { limit: 256 },
                                                  message: 'must NOT have more than 256 characters',
                                                },
                                              ];
                                              return false;
                                            }
                                          } else {
                                            validate111.errors = [
                                              {
                                                instancePath:
                                                  instancePath + '/diagnostics/' + i0 + '/field',
                                                schemaPath:
                                                  '#/$defs/Diagnostic/properties/field/type',
                                                keyword: 'type',
                                                params: { type: 'string' },
                                                message: 'must be string',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                        var valid4 = _errs18 === errors;
                                      } else {
                                        var valid4 = true;
                                      }
                                      if (valid4) {
                                        if (data6.message !== void 0) {
                                          let data8 = data6.message;
                                          const _errs20 = errors;
                                          if (errors === _errs20) {
                                            if (typeof data8 === 'string') {
                                              if (func2(data8) > 512) {
                                                validate111.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath +
                                                      '/diagnostics/' +
                                                      i0 +
                                                      '/message',
                                                    schemaPath:
                                                      '#/$defs/Diagnostic/properties/message/maxLength',
                                                    keyword: 'maxLength',
                                                    params: { limit: 512 },
                                                    message:
                                                      'must NOT have more than 512 characters',
                                                  },
                                                ];
                                                return false;
                                              }
                                            } else {
                                              validate111.errors = [
                                                {
                                                  instancePath:
                                                    instancePath +
                                                    '/diagnostics/' +
                                                    i0 +
                                                    '/message',
                                                  schemaPath:
                                                    '#/$defs/Diagnostic/properties/message/type',
                                                  keyword: 'type',
                                                  params: { type: 'string' },
                                                  message: 'must be string',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                          var valid4 = _errs20 === errors;
                                        } else {
                                          var valid4 = true;
                                        }
                                      }
                                    }
                                  }
                                } else {
                                  validate111.errors = [
                                    {
                                      instancePath: instancePath + '/diagnostics/' + i0,
                                      schemaPath: '#/$defs/Diagnostic/type',
                                      keyword: 'type',
                                      params: { type: 'object' },
                                      message: 'must be object',
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid2 = _errs14 === errors;
                              if (!valid2) {
                                break;
                              }
                            }
                          }
                        } else {
                          validate111.errors = [
                            {
                              instancePath: instancePath + '/diagnostics',
                              schemaPath: '#/properties/diagnostics/type',
                              keyword: 'type',
                              params: { type: 'array' },
                              message: 'must be array',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs12 === errors;
                    } else {
                      var valid0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate111.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate111.errors = vErrors;
  return errors === 0;
}
validate111.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateShutdownAcknowledgement = validate112;
function validate112(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate112.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.accepted === void 0 && (missing0 = 'accepted'))
      ) {
        validate112.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'accepted')) {
            validate112.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate112.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate112.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate112.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate112.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate112.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.accepted !== void 0) {
                const _errs6 = errors;
                if (true !== data.accepted) {
                  validate112.errors = [
                    {
                      instancePath: instancePath + '/accepted',
                      schemaPath: '#/properties/accepted/const',
                      keyword: 'const',
                      params: { allowedValue: true },
                      message: 'must be equal to constant',
                    },
                  ];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate112.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate112.errors = vErrors;
  return errors === 0;
}
validate112.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateServerIdentity = validate138;
function validate138(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate138.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.serverId === void 0 && (missing0 = 'serverId')) ||
        (data.eventEpoch === void 0 && (missing0 = 'eventEpoch'))
      ) {
        validate138.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'serverId' || key0 === 'eventEpoch')) {
            validate138.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.serverId !== void 0) {
            let data0 = data.serverId;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate138.errors = [
                      {
                        instancePath: instancePath + '/serverId',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate138.errors = [
                        {
                          instancePath: instancePath + '/serverId',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate138.errors = [
                          {
                            instancePath: instancePath + '/serverId',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate138.errors = [
                    {
                      instancePath: instancePath + '/serverId',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.eventEpoch !== void 0) {
              let data1 = data.eventEpoch;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate138.errors = [
                        {
                          instancePath: instancePath + '/eventEpoch',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate138.errors = [
                          {
                            instancePath: instancePath + '/eventEpoch',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate138.errors = [
                            {
                              instancePath: instancePath + '/eventEpoch',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate138.errors = [
                      {
                        instancePath: instancePath + '/eventEpoch',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate138.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate138.errors = vErrors;
  return errors === 0;
}
validate138.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateDevice = validate139;
var schema55 = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'createdAt', 'lastSeenAt', 'revokedAt'],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    name: { $ref: '#/$defs/DeviceName' },
    createdAt: { type: 'integer', minimum: 0 },
    lastSeenAt: { type: ['integer', 'null'], minimum: 0 },
    revokedAt: { type: ['integer', 'null'], minimum: 0 },
  },
};
var pattern5 = new RegExp('^[^\\u0000-\\u001f\\u007f]+$', 'u');
function validate139(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate139.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.name === void 0 && (missing0 = 'name')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.lastSeenAt === void 0 && (missing0 = 'lastSeenAt')) ||
        (data.revokedAt === void 0 && (missing0 = 'revokedAt'))
      ) {
        validate139.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'id' ||
            key0 === 'name' ||
            key0 === 'createdAt' ||
            key0 === 'lastSeenAt' ||
            key0 === 'revokedAt'
          )) {
            validate139.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate139.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate139.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate139.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate139.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.name !== void 0) {
              let data1 = data.name;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func2(data1) > 100) {
                    validate139.errors = [
                      {
                        instancePath: instancePath + '/name',
                        schemaPath: '#/$defs/DeviceName/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 100 },
                        message: 'must NOT have more than 100 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data1) < 1) {
                      validate139.errors = [
                        {
                          instancePath: instancePath + '/name',
                          schemaPath: '#/$defs/DeviceName/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!pattern5.test(data1)) {
                        validate139.errors = [
                          {
                            instancePath: instancePath + '/name',
                            schemaPath: '#/$defs/DeviceName/pattern',
                            keyword: 'pattern',
                            params: { pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
                            message: 'must match pattern "^[^\\u0000-\\u001f\\u007f]+$"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate139.errors = [
                    {
                      instancePath: instancePath + '/name',
                      schemaPath: '#/$defs/DeviceName/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.createdAt !== void 0) {
                let data2 = data.createdAt;
                const _errs8 = errors;
                if (!(
                  typeof data2 == 'number' &&
                  !(data2 % 1) &&
                  !isNaN(data2) &&
                  isFinite(data2)
                )) {
                  validate139.errors = [
                    {
                      instancePath: instancePath + '/createdAt',
                      schemaPath: '#/properties/createdAt/type',
                      keyword: 'type',
                      params: { type: 'integer' },
                      message: 'must be integer',
                    },
                  ];
                  return false;
                }
                if (errors === _errs8) {
                  if (typeof data2 == 'number' && isFinite(data2)) {
                    if (data2 < 0 || isNaN(data2)) {
                      validate139.errors = [
                        {
                          instancePath: instancePath + '/createdAt',
                          schemaPath: '#/properties/createdAt/minimum',
                          keyword: 'minimum',
                          params: { comparison: '>=', limit: 0 },
                          message: 'must be >= 0',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.lastSeenAt !== void 0) {
                  let data3 = data.lastSeenAt;
                  const _errs10 = errors;
                  if (
                    !(
                      typeof data3 == 'number' &&
                      !(data3 % 1) &&
                      !isNaN(data3) &&
                      isFinite(data3)
                    ) &&
                    data3 !== null
                  ) {
                    validate139.errors = [
                      {
                        instancePath: instancePath + '/lastSeenAt',
                        schemaPath: '#/properties/lastSeenAt/type',
                        keyword: 'type',
                        params: { type: schema55.properties.lastSeenAt.type },
                        message: 'must be integer,null',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs10) {
                    if (typeof data3 == 'number' && isFinite(data3)) {
                      if (data3 < 0 || isNaN(data3)) {
                        validate139.errors = [
                          {
                            instancePath: instancePath + '/lastSeenAt',
                            schemaPath: '#/properties/lastSeenAt/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 0 },
                            message: 'must be >= 0',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.revokedAt !== void 0) {
                    let data4 = data.revokedAt;
                    const _errs12 = errors;
                    if (
                      !(
                        typeof data4 == 'number' &&
                        !(data4 % 1) &&
                        !isNaN(data4) &&
                        isFinite(data4)
                      ) &&
                      data4 !== null
                    ) {
                      validate139.errors = [
                        {
                          instancePath: instancePath + '/revokedAt',
                          schemaPath: '#/properties/revokedAt/type',
                          keyword: 'type',
                          params: { type: schema55.properties.revokedAt.type },
                          message: 'must be integer,null',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs12) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 0 || isNaN(data4)) {
                          validate139.errors = [
                            {
                              instancePath: instancePath + '/revokedAt',
                              schemaPath: '#/properties/revokedAt/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 0 },
                              message: 'must be >= 0',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate139.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate139.errors = vErrors;
  return errors === 0;
}
validate139.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validatePairRequest = validate113;
var pattern7 = new RegExp('^[A-Za-z0-9_-]{8,100}$', 'u');
function validate113(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate113.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.phrase === void 0 && (missing0 = 'phrase')) ||
        (data.deviceName === void 0 && (missing0 = 'deviceName')) ||
        (data.commandId === void 0 && (missing0 = 'commandId'))
      ) {
        validate113.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'phrase' || key0 === 'deviceName' || key0 === 'commandId')) {
            validate113.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.phrase !== void 0) {
            let data0 = data.phrase;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === 'string') {
                if (func2(data0) > 200) {
                  validate113.errors = [
                    {
                      instancePath: instancePath + '/phrase',
                      schemaPath: '#/properties/phrase/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 200 },
                      message: 'must NOT have more than 200 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func2(data0) < 1) {
                    validate113.errors = [
                      {
                        instancePath: instancePath + '/phrase',
                        schemaPath: '#/properties/phrase/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate113.errors = [
                  {
                    instancePath: instancePath + '/phrase',
                    schemaPath: '#/properties/phrase/type',
                    keyword: 'type',
                    params: { type: 'string' },
                    message: 'must be string',
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.deviceName !== void 0) {
              let data1 = data.deviceName;
              const _errs4 = errors;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === 'string') {
                  if (func2(data1) > 100) {
                    validate113.errors = [
                      {
                        instancePath: instancePath + '/deviceName',
                        schemaPath: '#/$defs/DeviceName/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 100 },
                        message: 'must NOT have more than 100 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data1) < 1) {
                      validate113.errors = [
                        {
                          instancePath: instancePath + '/deviceName',
                          schemaPath: '#/$defs/DeviceName/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!pattern5.test(data1)) {
                        validate113.errors = [
                          {
                            instancePath: instancePath + '/deviceName',
                            schemaPath: '#/$defs/DeviceName/pattern',
                            keyword: 'pattern',
                            params: { pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
                            message: 'must match pattern "^[^\\u0000-\\u001f\\u007f]+$"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate113.errors = [
                    {
                      instancePath: instancePath + '/deviceName',
                      schemaPath: '#/$defs/DeviceName/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.commandId !== void 0) {
                let data2 = data.commandId;
                const _errs7 = errors;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === 'string') {
                    if (!pattern7.test(data2)) {
                      validate113.errors = [
                        {
                          instancePath: instancePath + '/commandId',
                          schemaPath: '#/$defs/CommandId/pattern',
                          keyword: 'pattern',
                          params: { pattern: '^[A-Za-z0-9_-]{8,100}$' },
                          message: 'must match pattern "^[A-Za-z0-9_-]{8,100}$"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate113.errors = [
                      {
                        instancePath: instancePath + '/commandId',
                        schemaPath: '#/$defs/CommandId/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate113.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate113.errors = vErrors;
  return errors === 0;
}
validate113.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validatePairResponse = validate114;
function validate31(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate31.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.name === void 0 && (missing0 = 'name')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.lastSeenAt === void 0 && (missing0 = 'lastSeenAt')) ||
        (data.revokedAt === void 0 && (missing0 = 'revokedAt'))
      ) {
        validate31.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'id' ||
            key0 === 'name' ||
            key0 === 'createdAt' ||
            key0 === 'lastSeenAt' ||
            key0 === 'revokedAt'
          )) {
            validate31.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate31.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate31.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate31.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate31.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.name !== void 0) {
              let data1 = data.name;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func2(data1) > 100) {
                    validate31.errors = [
                      {
                        instancePath: instancePath + '/name',
                        schemaPath: '#/$defs/DeviceName/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 100 },
                        message: 'must NOT have more than 100 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data1) < 1) {
                      validate31.errors = [
                        {
                          instancePath: instancePath + '/name',
                          schemaPath: '#/$defs/DeviceName/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!pattern5.test(data1)) {
                        validate31.errors = [
                          {
                            instancePath: instancePath + '/name',
                            schemaPath: '#/$defs/DeviceName/pattern',
                            keyword: 'pattern',
                            params: { pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
                            message: 'must match pattern "^[^\\u0000-\\u001f\\u007f]+$"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate31.errors = [
                    {
                      instancePath: instancePath + '/name',
                      schemaPath: '#/$defs/DeviceName/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.createdAt !== void 0) {
                let data2 = data.createdAt;
                const _errs8 = errors;
                if (!(
                  typeof data2 == 'number' &&
                  !(data2 % 1) &&
                  !isNaN(data2) &&
                  isFinite(data2)
                )) {
                  validate31.errors = [
                    {
                      instancePath: instancePath + '/createdAt',
                      schemaPath: '#/properties/createdAt/type',
                      keyword: 'type',
                      params: { type: 'integer' },
                      message: 'must be integer',
                    },
                  ];
                  return false;
                }
                if (errors === _errs8) {
                  if (typeof data2 == 'number' && isFinite(data2)) {
                    if (data2 < 0 || isNaN(data2)) {
                      validate31.errors = [
                        {
                          instancePath: instancePath + '/createdAt',
                          schemaPath: '#/properties/createdAt/minimum',
                          keyword: 'minimum',
                          params: { comparison: '>=', limit: 0 },
                          message: 'must be >= 0',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.lastSeenAt !== void 0) {
                  let data3 = data.lastSeenAt;
                  const _errs10 = errors;
                  if (
                    !(
                      typeof data3 == 'number' &&
                      !(data3 % 1) &&
                      !isNaN(data3) &&
                      isFinite(data3)
                    ) &&
                    data3 !== null
                  ) {
                    validate31.errors = [
                      {
                        instancePath: instancePath + '/lastSeenAt',
                        schemaPath: '#/properties/lastSeenAt/type',
                        keyword: 'type',
                        params: { type: schema55.properties.lastSeenAt.type },
                        message: 'must be integer,null',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs10) {
                    if (typeof data3 == 'number' && isFinite(data3)) {
                      if (data3 < 0 || isNaN(data3)) {
                        validate31.errors = [
                          {
                            instancePath: instancePath + '/lastSeenAt',
                            schemaPath: '#/properties/lastSeenAt/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 0 },
                            message: 'must be >= 0',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.revokedAt !== void 0) {
                    let data4 = data.revokedAt;
                    const _errs12 = errors;
                    if (
                      !(
                        typeof data4 == 'number' &&
                        !(data4 % 1) &&
                        !isNaN(data4) &&
                        isFinite(data4)
                      ) &&
                      data4 !== null
                    ) {
                      validate31.errors = [
                        {
                          instancePath: instancePath + '/revokedAt',
                          schemaPath: '#/properties/revokedAt/type',
                          keyword: 'type',
                          params: { type: schema55.properties.revokedAt.type },
                          message: 'must be integer,null',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs12) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 0 || isNaN(data4)) {
                          validate31.errors = [
                            {
                              instancePath: instancePath + '/revokedAt',
                              schemaPath: '#/properties/revokedAt/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 0 },
                              message: 'must be >= 0',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate31.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate31.errors = vErrors;
  return errors === 0;
}
validate31.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var pattern8 = new RegExp('^[A-Za-z0-9_-]{43}$', 'u');
function validate114(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate114.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.device === void 0 && (missing0 = 'device')) ||
        (data.token === void 0 && (missing0 = 'token'))
      ) {
        validate114.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'device' ||
            key0 === 'token'
          )) {
            validate114.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate114.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate114.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate114.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate114.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate114.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.device !== void 0) {
                const _errs6 = errors;
                if (
                  !validate31(data.device, {
                    instancePath: instancePath + '/device',
                    parentData: data,
                    parentDataProperty: 'device',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.token !== void 0) {
                  let data3 = data.token;
                  const _errs7 = errors;
                  if (errors === _errs7) {
                    if (typeof data3 === 'string') {
                      if (!pattern8.test(data3)) {
                        validate114.errors = [
                          {
                            instancePath: instancePath + '/token',
                            schemaPath: '#/properties/token/pattern',
                            keyword: 'pattern',
                            params: { pattern: '^[A-Za-z0-9_-]{43}$' },
                            message: 'must match pattern "^[A-Za-z0-9_-]{43}$"',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate114.errors = [
                        {
                          instancePath: instancePath + '/token',
                          schemaPath: '#/properties/token/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate114.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate114.errors = vErrors;
  return errors === 0;
}
validate114.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validatePairingIssued = validate116;
var pattern9 = new RegExp('^[a-z]+( [a-z]+){7}$', 'u');
function validate116(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate116.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.pairing === void 0 && (missing0 = 'pairing'))
      ) {
        validate116.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'pairing')) {
            validate116.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate116.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate116.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate116.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate116.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate116.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.pairing !== void 0) {
                let data2 = data.pairing;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (data2 && typeof data2 == 'object' && !Array.isArray(data2)) {
                    let missing1;
                    if (
                      (data2.phrase === void 0 && (missing1 = 'phrase')) ||
                      (data2.expiresAt === void 0 && (missing1 = 'expiresAt'))
                    ) {
                      validate116.errors = [
                        {
                          instancePath: instancePath + '/pairing',
                          schemaPath: '#/properties/pairing/required',
                          keyword: 'required',
                          params: { missingProperty: missing1 },
                          message: "must have required property '" + missing1 + "'",
                        },
                      ];
                      return false;
                    } else {
                      const _errs8 = errors;
                      for (const key1 in data2) {
                        if (!(key1 === 'phrase' || key1 === 'expiresAt')) {
                          validate116.errors = [
                            {
                              instancePath: instancePath + '/pairing',
                              schemaPath: '#/properties/pairing/additionalProperties',
                              keyword: 'additionalProperties',
                              params: { additionalProperty: key1 },
                              message: 'must NOT have additional properties',
                            },
                          ];
                          return false;
                          break;
                        }
                      }
                      if (_errs8 === errors) {
                        if (data2.phrase !== void 0) {
                          let data3 = data2.phrase;
                          const _errs9 = errors;
                          if (errors === _errs9) {
                            if (typeof data3 === 'string') {
                              if (!pattern9.test(data3)) {
                                validate116.errors = [
                                  {
                                    instancePath: instancePath + '/pairing/phrase',
                                    schemaPath: '#/properties/pairing/properties/phrase/pattern',
                                    keyword: 'pattern',
                                    params: { pattern: '^[a-z]+( [a-z]+){7}$' },
                                    message: 'must match pattern "^[a-z]+( [a-z]+){7}$"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate116.errors = [
                                {
                                  instancePath: instancePath + '/pairing/phrase',
                                  schemaPath: '#/properties/pairing/properties/phrase/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid2 = _errs9 === errors;
                        } else {
                          var valid2 = true;
                        }
                        if (valid2) {
                          if (data2.expiresAt !== void 0) {
                            let data4 = data2.expiresAt;
                            const _errs11 = errors;
                            if (!(
                              typeof data4 == 'number' &&
                              !(data4 % 1) &&
                              !isNaN(data4) &&
                              isFinite(data4)
                            )) {
                              validate116.errors = [
                                {
                                  instancePath: instancePath + '/pairing/expiresAt',
                                  schemaPath: '#/properties/pairing/properties/expiresAt/type',
                                  keyword: 'type',
                                  params: { type: 'integer' },
                                  message: 'must be integer',
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs11) {
                              if (typeof data4 == 'number' && isFinite(data4)) {
                                if (data4 < 0 || isNaN(data4)) {
                                  validate116.errors = [
                                    {
                                      instancePath: instancePath + '/pairing/expiresAt',
                                      schemaPath:
                                        '#/properties/pairing/properties/expiresAt/minimum',
                                      keyword: 'minimum',
                                      params: { comparison: '>=', limit: 0 },
                                      message: 'must be >= 0',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid2 = _errs11 === errors;
                          } else {
                            var valid2 = true;
                          }
                        }
                      }
                    }
                  } else {
                    validate116.errors = [
                      {
                        instancePath: instancePath + '/pairing',
                        schemaPath: '#/properties/pairing/type',
                        keyword: 'type',
                        params: { type: 'object' },
                        message: 'must be object',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate116.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate116.errors = vErrors;
  return errors === 0;
}
validate116.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateDeviceList = validate117;
function validate117(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate117.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.devices === void 0 && (missing0 = 'devices')) ||
        (data.currentDeviceId === void 0 && (missing0 = 'currentDeviceId'))
      ) {
        validate117.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'devices' ||
            key0 === 'currentDeviceId'
          )) {
            validate117.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate117.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate117.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate117.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate117.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate117.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.devices !== void 0) {
                let data2 = data.devices;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e3) {
                      validate117.errors = [
                        {
                          instancePath: instancePath + '/devices',
                          schemaPath: '#/properties/devices/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e3 },
                          message: 'must NOT have more than 1000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate31(data2[i0], {
                            instancePath: instancePath + '/devices/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate31.errors
                              : vErrors.concat(validate31.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate117.errors = [
                      {
                        instancePath: instancePath + '/devices',
                        schemaPath: '#/properties/devices/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.currentDeviceId !== void 0) {
                  let data4 = data.currentDeviceId;
                  const _errs9 = errors;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (errors === _errs10) {
                      if (typeof data4 === 'string') {
                        if (func2(data4) > 36) {
                          validate117.errors = [
                            {
                              instancePath: instancePath + '/currentDeviceId',
                              schemaPath: '#/$defs/Uuid/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 36 },
                              message: 'must NOT have more than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func2(data4) < 36) {
                            validate117.errors = [
                              {
                                instancePath: instancePath + '/currentDeviceId',
                                schemaPath: '#/$defs/Uuid/minLength',
                                keyword: 'minLength',
                                params: { limit: 36 },
                                message: 'must NOT have fewer than 36 characters',
                              },
                            ];
                            return false;
                          } else {
                            if (!formats0.test(data4)) {
                              validate117.errors = [
                                {
                                  instancePath: instancePath + '/currentDeviceId',
                                  schemaPath: '#/$defs/Uuid/format',
                                  keyword: 'format',
                                  params: { format: 'uuid' },
                                  message: 'must match format "uuid"',
                                },
                              ];
                              return false;
                            }
                          }
                        }
                      } else {
                        validate117.errors = [
                          {
                            instancePath: instancePath + '/currentDeviceId',
                            schemaPath: '#/$defs/Uuid/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate117.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate117.errors = vErrors;
  return errors === 0;
}
validate117.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateDeviceResponse = validate119;
function validate119(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate119.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.device === void 0 && (missing0 = 'device'))
      ) {
        validate119.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'device')) {
            validate119.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate119.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate119.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate119.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate119.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate119.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.device !== void 0) {
                const _errs6 = errors;
                if (
                  !validate31(data.device, {
                    instancePath: instancePath + '/device',
                    parentData: data,
                    parentDataProperty: 'device',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate119.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate119.errors = vErrors;
  return errors === 0;
}
validate119.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateProjectResponse = validate140;
function validate46(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate46.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.name === void 0 && (missing0 = 'name')) ||
        (data.repositoryPath === void 0 && (missing0 = 'repositoryPath')) ||
        (data.baseRef === void 0 && (missing0 = 'baseRef')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt'))
      ) {
        validate46.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'id' ||
            key0 === 'name' ||
            key0 === 'repositoryPath' ||
            key0 === 'baseRef' ||
            key0 === 'createdAt'
          )) {
            validate46.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate46.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate46.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate46.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate46.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.name !== void 0) {
              let data1 = data.name;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === 'string') {
                  if (func2(data1) > 200) {
                    validate46.errors = [
                      {
                        instancePath: instancePath + '/name',
                        schemaPath: '#/properties/name/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 200 },
                        message: 'must NOT have more than 200 characters',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate46.errors = [
                    {
                      instancePath: instancePath + '/name',
                      schemaPath: '#/properties/name/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.repositoryPath !== void 0) {
                let data2 = data.repositoryPath;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data2 === 'string') {
                    if (func2(data2) > 4096) {
                      validate46.errors = [
                        {
                          instancePath: instancePath + '/repositoryPath',
                          schemaPath: '#/properties/repositoryPath/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 4096 },
                          message: 'must NOT have more than 4096 characters',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate46.errors = [
                      {
                        instancePath: instancePath + '/repositoryPath',
                        schemaPath: '#/properties/repositoryPath/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.baseRef !== void 0) {
                  let data3 = data.baseRef;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 256) {
                        validate46.errors = [
                          {
                            instancePath: instancePath + '/baseRef',
                            schemaPath: '#/properties/baseRef/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 256 },
                            message: 'must NOT have more than 256 characters',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate46.errors = [
                        {
                          instancePath: instancePath + '/baseRef',
                          schemaPath: '#/properties/baseRef/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.createdAt !== void 0) {
                    let data4 = data.createdAt;
                    const _errs11 = errors;
                    if (!(
                      typeof data4 == 'number' &&
                      !(data4 % 1) &&
                      !isNaN(data4) &&
                      isFinite(data4)
                    )) {
                      validate46.errors = [
                        {
                          instancePath: instancePath + '/createdAt',
                          schemaPath: '#/properties/createdAt/type',
                          keyword: 'type',
                          params: { type: 'integer' },
                          message: 'must be integer',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs11) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 0 || isNaN(data4)) {
                          validate46.errors = [
                            {
                              instancePath: instancePath + '/createdAt',
                              schemaPath: '#/properties/createdAt/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 0 },
                              message: 'must be >= 0',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate46.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate46.errors = vErrors;
  return errors === 0;
}
validate46.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate140(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate140.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.project === void 0 && (missing0 = 'project'))
      ) {
        validate140.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'project')) {
            validate140.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate140.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate140.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate140.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate140.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate140.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.project !== void 0) {
                const _errs6 = errors;
                if (
                  !validate46(data.project, {
                    instancePath: instancePath + '/project',
                    parentData: data,
                    parentDataProperty: 'project',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate46.errors : vErrors.concat(validate46.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate140.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate140.errors = vErrors;
  return errors === 0;
}
validate140.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateWorkflowResponse = validate121;
var schema72 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'projectId',
    'name',
    'enabled',
    'draftRevision',
    'draft',
    'activeVersionId',
    'versions',
    'createdAt',
  ],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    projectId: { $ref: '#/$defs/Uuid' },
    name: { type: 'string', maxLength: 200 },
    enabled: { type: 'boolean' },
    draftRevision: { type: 'integer', minimum: 0 },
    draft: { type: 'object' },
    activeVersionId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    versions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'number', 'hash', 'createdAt'],
        properties: {
          id: { $ref: '#/$defs/Uuid' },
          number: { type: 'integer', minimum: 1 },
          hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          createdAt: { type: 'integer', minimum: 0 },
        },
      },
      maxItems: 1e5,
    },
    createdAt: { type: 'integer', minimum: 0 },
  },
};
var pattern10 = new RegExp('^[0-9a-f]{64}$', 'u');
function validate48(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.projectId === void 0 && (missing0 = 'projectId')) ||
        (data.name === void 0 && (missing0 = 'name')) ||
        (data.enabled === void 0 && (missing0 = 'enabled')) ||
        (data.draftRevision === void 0 && (missing0 = 'draftRevision')) ||
        (data.draft === void 0 && (missing0 = 'draft')) ||
        (data.activeVersionId === void 0 && (missing0 = 'activeVersionId')) ||
        (data.versions === void 0 && (missing0 = 'versions')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt'))
      ) {
        validate48.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema72.properties, key0)) {
            validate48.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate48.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate48.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.projectId !== void 0) {
              let data1 = data.projectId;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/projectId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate48.errors = [
                          {
                            instancePath: instancePath + '/projectId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate48.errors = [
                            {
                              instancePath: instancePath + '/projectId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/projectId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.name !== void 0) {
                let data2 = data.name;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === 'string') {
                    if (func2(data2) > 200) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/name',
                          schemaPath: '#/properties/name/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 200 },
                          message: 'must NOT have more than 200 characters',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/name',
                        schemaPath: '#/properties/name/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.enabled !== void 0) {
                  const _errs10 = errors;
                  if (typeof data.enabled !== 'boolean') {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/enabled',
                        schemaPath: '#/properties/enabled/type',
                        keyword: 'type',
                        params: { type: 'boolean' },
                        message: 'must be boolean',
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.draftRevision !== void 0) {
                    let data4 = data.draftRevision;
                    const _errs12 = errors;
                    if (!(
                      typeof data4 == 'number' &&
                      !(data4 % 1) &&
                      !isNaN(data4) &&
                      isFinite(data4)
                    )) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/draftRevision',
                          schemaPath: '#/properties/draftRevision/type',
                          keyword: 'type',
                          params: { type: 'integer' },
                          message: 'must be integer',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs12) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 0 || isNaN(data4)) {
                          validate48.errors = [
                            {
                              instancePath: instancePath + '/draftRevision',
                              schemaPath: '#/properties/draftRevision/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 0 },
                              message: 'must be >= 0',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.draft !== void 0) {
                      let data5 = data.draft;
                      const _errs14 = errors;
                      if (!(data5 && typeof data5 == 'object' && !Array.isArray(data5))) {
                        validate48.errors = [
                          {
                            instancePath: instancePath + '/draft',
                            schemaPath: '#/properties/draft/type',
                            keyword: 'type',
                            params: { type: 'object' },
                            message: 'must be object',
                          },
                        ];
                        return false;
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.activeVersionId !== void 0) {
                        let data6 = data.activeVersionId;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        let valid3 = false;
                        const _errs18 = errors;
                        const _errs19 = errors;
                        if (errors === _errs19) {
                          if (errors === _errs19) {
                            if (typeof data6 === 'string') {
                              if (func2(data6) > 36) {
                                const err0 = {
                                  instancePath: instancePath + '/activeVersionId',
                                  schemaPath: '#/$defs/Uuid/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have more than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err0];
                                } else {
                                  vErrors.push(err0);
                                }
                                errors++;
                              } else {
                                if (func2(data6) < 36) {
                                  const err1 = {
                                    instancePath: instancePath + '/activeVersionId',
                                    schemaPath: '#/$defs/Uuid/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have fewer than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err1];
                                  } else {
                                    vErrors.push(err1);
                                  }
                                  errors++;
                                } else {
                                  if (!formats0.test(data6)) {
                                    const err2 = {
                                      instancePath: instancePath + '/activeVersionId',
                                      schemaPath: '#/$defs/Uuid/format',
                                      keyword: 'format',
                                      params: { format: 'uuid' },
                                      message: 'must match format "uuid"',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err2];
                                    } else {
                                      vErrors.push(err2);
                                    }
                                    errors++;
                                  }
                                }
                              }
                            } else {
                              const err3 = {
                                instancePath: instancePath + '/activeVersionId',
                                schemaPath: '#/$defs/Uuid/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              };
                              if (vErrors === null) {
                                vErrors = [err3];
                              } else {
                                vErrors.push(err3);
                              }
                              errors++;
                            }
                          }
                        }
                        var _valid0 = _errs18 === errors;
                        valid3 = valid3 || _valid0;
                        const _errs21 = errors;
                        if (data6 !== null) {
                          const err4 = {
                            instancePath: instancePath + '/activeVersionId',
                            schemaPath: '#/properties/activeVersionId/anyOf/1/type',
                            keyword: 'type',
                            params: { type: 'null' },
                            message: 'must be null',
                          };
                          if (vErrors === null) {
                            vErrors = [err4];
                          } else {
                            vErrors.push(err4);
                          }
                          errors++;
                        }
                        var _valid0 = _errs21 === errors;
                        valid3 = valid3 || _valid0;
                        if (!valid3) {
                          const err5 = {
                            instancePath: instancePath + '/activeVersionId',
                            schemaPath: '#/properties/activeVersionId/anyOf',
                            keyword: 'anyOf',
                            params: {},
                            message: 'must match a schema in anyOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err5];
                          } else {
                            vErrors.push(err5);
                          }
                          errors++;
                          validate48.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs17;
                          if (vErrors !== null) {
                            if (_errs17) {
                              vErrors.length = _errs17;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid0 = _errs16 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.versions !== void 0) {
                          let data7 = data.versions;
                          const _errs23 = errors;
                          if (errors === _errs23) {
                            if (Array.isArray(data7)) {
                              if (data7.length > 1e5) {
                                validate48.errors = [
                                  {
                                    instancePath: instancePath + '/versions',
                                    schemaPath: '#/properties/versions/maxItems',
                                    keyword: 'maxItems',
                                    params: { limit: 1e5 },
                                    message: 'must NOT have more than 100000 items',
                                  },
                                ];
                                return false;
                              } else {
                                var valid5 = true;
                                const len0 = data7.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                  let data8 = data7[i0];
                                  const _errs25 = errors;
                                  if (errors === _errs25) {
                                    if (
                                      data8 &&
                                      typeof data8 == 'object' &&
                                      !Array.isArray(data8)
                                    ) {
                                      let missing1;
                                      if (
                                        (data8.id === void 0 && (missing1 = 'id')) ||
                                        (data8.number === void 0 && (missing1 = 'number')) ||
                                        (data8.hash === void 0 && (missing1 = 'hash')) ||
                                        (data8.createdAt === void 0 && (missing1 = 'createdAt'))
                                      ) {
                                        validate48.errors = [
                                          {
                                            instancePath: instancePath + '/versions/' + i0,
                                            schemaPath: '#/properties/versions/items/required',
                                            keyword: 'required',
                                            params: { missingProperty: missing1 },
                                            message:
                                              "must have required property '" + missing1 + "'",
                                          },
                                        ];
                                        return false;
                                      } else {
                                        const _errs27 = errors;
                                        for (const key1 in data8) {
                                          if (!(
                                            key1 === 'id' ||
                                            key1 === 'number' ||
                                            key1 === 'hash' ||
                                            key1 === 'createdAt'
                                          )) {
                                            validate48.errors = [
                                              {
                                                instancePath: instancePath + '/versions/' + i0,
                                                schemaPath:
                                                  '#/properties/versions/items/additionalProperties',
                                                keyword: 'additionalProperties',
                                                params: { additionalProperty: key1 },
                                                message: 'must NOT have additional properties',
                                              },
                                            ];
                                            return false;
                                            break;
                                          }
                                        }
                                        if (_errs27 === errors) {
                                          if (data8.id !== void 0) {
                                            let data9 = data8.id;
                                            const _errs28 = errors;
                                            const _errs29 = errors;
                                            if (errors === _errs29) {
                                              if (errors === _errs29) {
                                                if (typeof data9 === 'string') {
                                                  if (func2(data9) > 36) {
                                                    validate48.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath + '/versions/' + i0 + '/id',
                                                        schemaPath: '#/$defs/Uuid/maxLength',
                                                        keyword: 'maxLength',
                                                        params: { limit: 36 },
                                                        message:
                                                          'must NOT have more than 36 characters',
                                                      },
                                                    ];
                                                    return false;
                                                  } else {
                                                    if (func2(data9) < 36) {
                                                      validate48.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            '/versions/' +
                                                            i0 +
                                                            '/id',
                                                          schemaPath: '#/$defs/Uuid/minLength',
                                                          keyword: 'minLength',
                                                          params: { limit: 36 },
                                                          message:
                                                            'must NOT have fewer than 36 characters',
                                                        },
                                                      ];
                                                      return false;
                                                    } else {
                                                      if (!formats0.test(data9)) {
                                                        validate48.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath +
                                                              '/versions/' +
                                                              i0 +
                                                              '/id',
                                                            schemaPath: '#/$defs/Uuid/format',
                                                            keyword: 'format',
                                                            params: { format: 'uuid' },
                                                            message: 'must match format "uuid"',
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                    }
                                                  }
                                                } else {
                                                  validate48.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath + '/versions/' + i0 + '/id',
                                                      schemaPath: '#/$defs/Uuid/type',
                                                      keyword: 'type',
                                                      params: { type: 'string' },
                                                      message: 'must be string',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            }
                                            var valid6 = _errs28 === errors;
                                          } else {
                                            var valid6 = true;
                                          }
                                          if (valid6) {
                                            if (data8.number !== void 0) {
                                              let data10 = data8.number;
                                              const _errs31 = errors;
                                              if (!(
                                                typeof data10 == 'number' &&
                                                !(data10 % 1) &&
                                                !isNaN(data10) &&
                                                isFinite(data10)
                                              )) {
                                                validate48.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/versions/' + i0 + '/number',
                                                    schemaPath:
                                                      '#/properties/versions/items/properties/number/type',
                                                    keyword: 'type',
                                                    params: { type: 'integer' },
                                                    message: 'must be integer',
                                                  },
                                                ];
                                                return false;
                                              }
                                              if (errors === _errs31) {
                                                if (typeof data10 == 'number' && isFinite(data10)) {
                                                  if (data10 < 1 || isNaN(data10)) {
                                                    validate48.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          '/versions/' +
                                                          i0 +
                                                          '/number',
                                                        schemaPath:
                                                          '#/properties/versions/items/properties/number/minimum',
                                                        keyword: 'minimum',
                                                        params: { comparison: '>=', limit: 1 },
                                                        message: 'must be >= 1',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                }
                                              }
                                              var valid6 = _errs31 === errors;
                                            } else {
                                              var valid6 = true;
                                            }
                                            if (valid6) {
                                              if (data8.hash !== void 0) {
                                                let data11 = data8.hash;
                                                const _errs33 = errors;
                                                if (errors === _errs33) {
                                                  if (typeof data11 === 'string') {
                                                    if (!pattern10.test(data11)) {
                                                      validate48.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            '/versions/' +
                                                            i0 +
                                                            '/hash',
                                                          schemaPath:
                                                            '#/properties/versions/items/properties/hash/pattern',
                                                          keyword: 'pattern',
                                                          params: { pattern: '^[0-9a-f]{64}$' },
                                                          message:
                                                            'must match pattern "^[0-9a-f]{64}$"',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  } else {
                                                    validate48.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          '/versions/' +
                                                          i0 +
                                                          '/hash',
                                                        schemaPath:
                                                          '#/properties/versions/items/properties/hash/type',
                                                        keyword: 'type',
                                                        params: { type: 'string' },
                                                        message: 'must be string',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                }
                                                var valid6 = _errs33 === errors;
                                              } else {
                                                var valid6 = true;
                                              }
                                              if (valid6) {
                                                if (data8.createdAt !== void 0) {
                                                  let data12 = data8.createdAt;
                                                  const _errs35 = errors;
                                                  if (!(
                                                    typeof data12 == 'number' &&
                                                    !(data12 % 1) &&
                                                    !isNaN(data12) &&
                                                    isFinite(data12)
                                                  )) {
                                                    validate48.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          '/versions/' +
                                                          i0 +
                                                          '/createdAt',
                                                        schemaPath:
                                                          '#/properties/versions/items/properties/createdAt/type',
                                                        keyword: 'type',
                                                        params: { type: 'integer' },
                                                        message: 'must be integer',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                  if (errors === _errs35) {
                                                    if (
                                                      typeof data12 == 'number' &&
                                                      isFinite(data12)
                                                    ) {
                                                      if (data12 < 0 || isNaN(data12)) {
                                                        validate48.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath +
                                                              '/versions/' +
                                                              i0 +
                                                              '/createdAt',
                                                            schemaPath:
                                                              '#/properties/versions/items/properties/createdAt/minimum',
                                                            keyword: 'minimum',
                                                            params: { comparison: '>=', limit: 0 },
                                                            message: 'must be >= 0',
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                    }
                                                  }
                                                  var valid6 = _errs35 === errors;
                                                } else {
                                                  var valid6 = true;
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    } else {
                                      validate48.errors = [
                                        {
                                          instancePath: instancePath + '/versions/' + i0,
                                          schemaPath: '#/properties/versions/items/type',
                                          keyword: 'type',
                                          params: { type: 'object' },
                                          message: 'must be object',
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                  var valid5 = _errs25 === errors;
                                  if (!valid5) {
                                    break;
                                  }
                                }
                              }
                            } else {
                              validate48.errors = [
                                {
                                  instancePath: instancePath + '/versions',
                                  schemaPath: '#/properties/versions/type',
                                  keyword: 'type',
                                  params: { type: 'array' },
                                  message: 'must be array',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs23 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.createdAt !== void 0) {
                            let data13 = data.createdAt;
                            const _errs37 = errors;
                            if (!(
                              typeof data13 == 'number' &&
                              !(data13 % 1) &&
                              !isNaN(data13) &&
                              isFinite(data13)
                            )) {
                              validate48.errors = [
                                {
                                  instancePath: instancePath + '/createdAt',
                                  schemaPath: '#/properties/createdAt/type',
                                  keyword: 'type',
                                  params: { type: 'integer' },
                                  message: 'must be integer',
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs37) {
                              if (typeof data13 == 'number' && isFinite(data13)) {
                                if (data13 < 0 || isNaN(data13)) {
                                  validate48.errors = [
                                    {
                                      instancePath: instancePath + '/createdAt',
                                      schemaPath: '#/properties/createdAt/minimum',
                                      keyword: 'minimum',
                                      params: { comparison: '>=', limit: 0 },
                                      message: 'must be >= 0',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid0 = _errs37 === errors;
                          } else {
                            var valid0 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate48.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate48.errors = vErrors;
  return errors === 0;
}
validate48.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate121(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate121.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.workflow === void 0 && (missing0 = 'workflow'))
      ) {
        validate121.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'workflow')) {
            validate121.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate121.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate121.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate121.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate121.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate121.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workflow !== void 0) {
                const _errs6 = errors;
                if (
                  !validate48(data.workflow, {
                    instancePath: instancePath + '/workflow',
                    parentData: data,
                    parentDataProperty: 'workflow',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate48.errors : vErrors.concat(validate48.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate121.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate121.errors = vErrors;
  return errors === 0;
}
validate121.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateRunResponse = validate123;
var schema77 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'state',
    'workflowId',
    'versionId',
    'versionNumber',
    'repository',
    'baseCommit',
    'workspace',
    'attention',
    'wait',
    'activeTime',
    'cancelRequested',
    'outcome',
    'createdAt',
    'finishedAt',
    'executions',
    'invocations',
    'controls',
  ],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    state: {
      enum: [
        'QUEUED',
        'RUNNING',
        'WAITING',
        'HELD',
        'NEEDS_HUMAN',
        'FAILED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'COMPLETED',
      ],
    },
    workflowId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    versionId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    versionNumber: { type: ['integer', 'null'], minimum: 1 },
    repository: { type: 'string', maxLength: 4096 },
    baseCommit: { type: ['string', 'null'], maxLength: 64 },
    workspace: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'path', 'state'],
          properties: {
            id: { $ref: '#/$defs/Uuid' },
            path: { type: ['string', 'null'], maxLength: 4096 },
            state: { type: ['string', 'null'], maxLength: 20 },
          },
        },
      ],
    },
    attention: { type: ['object', 'null'] },
    wait: { type: ['object', 'null'] },
    activeTime: {
      type: 'object',
      additionalProperties: false,
      required: ['usedMs', 'limitMs'],
      properties: {
        usedMs: { type: 'integer', minimum: 0 },
        limitMs: { type: 'integer', minimum: 0 },
      },
    },
    cancelRequested: { type: 'boolean' },
    outcome: {},
    createdAt: { type: 'integer', minimum: 0 },
    finishedAt: { type: ['integer', 'null'], minimum: 0 },
    executions: { type: 'array', items: { $ref: '#/$defs/Execution' }, maxItems: 1e5 },
    invocations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'state', 'correlationId', 'submissions', 'acceptedSubmissions'],
        properties: {
          id: { $ref: '#/$defs/Uuid' },
          kind: { enum: ['goal', 'correction', 'continuation'] },
          state: { type: 'string', maxLength: 20 },
          correlationId: { type: 'string', maxLength: 200 },
          submissions: { type: 'integer', minimum: 0 },
          acceptedSubmissions: { type: 'integer', minimum: 0 },
        },
      },
      maxItems: 1e5,
    },
    controls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'executionId', 'actor', 'payload', 'createdAt'],
        properties: {
          id: { $ref: '#/$defs/Uuid' },
          kind: { enum: ['cancel', 'retry', 'fail', 'complete', 'extend'] },
          executionId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
          actor: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'id'],
            properties: {
              kind: { type: 'string', maxLength: 20 },
              id: { type: 'string', maxLength: 100 },
            },
          },
          payload: {},
          createdAt: { type: 'integer', minimum: 0 },
        },
      },
      maxItems: 1e5,
    },
  },
};
var schema82 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'node',
    'type',
    'sequence',
    'state',
    'port',
    'predecessorId',
    'connectionId',
    'sources',
    'output',
    'error',
    'attempts',
  ],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    node: { type: 'string', maxLength: 200 },
    type: { type: 'string', maxLength: 200 },
    sequence: { type: 'integer', minimum: 1 },
    state: { enum: ['PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED'] },
    port: { type: ['string', 'null'], maxLength: 100 },
    predecessorId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    connectionId: { type: ['string', 'null'], maxLength: 200 },
    sources: { type: ['object', 'null'] },
    output: {},
    error: {},
    attempts: { type: 'array', items: { $ref: '#/$defs/Attempt' }, maxItems: 1e3 },
  },
};
var schema85 = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'state', 'error'],
  properties: {
    number: { type: 'integer', minimum: 1 },
    state: {
      enum: ['PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED'],
    },
    error: {},
  },
};
function validate51(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate51.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.node === void 0 && (missing0 = 'node')) ||
        (data.type === void 0 && (missing0 = 'type')) ||
        (data.sequence === void 0 && (missing0 = 'sequence')) ||
        (data.state === void 0 && (missing0 = 'state')) ||
        (data.port === void 0 && (missing0 = 'port')) ||
        (data.predecessorId === void 0 && (missing0 = 'predecessorId')) ||
        (data.connectionId === void 0 && (missing0 = 'connectionId')) ||
        (data.sources === void 0 && (missing0 = 'sources')) ||
        (data.output === void 0 && (missing0 = 'output')) ||
        (data.error === void 0 && (missing0 = 'error')) ||
        (data.attempts === void 0 && (missing0 = 'attempts'))
      ) {
        validate51.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema82.properties, key0)) {
            validate51.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate51.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate51.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate51.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate51.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.node !== void 0) {
              let data1 = data.node;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === 'string') {
                  if (func2(data1) > 200) {
                    validate51.errors = [
                      {
                        instancePath: instancePath + '/node',
                        schemaPath: '#/properties/node/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 200 },
                        message: 'must NOT have more than 200 characters',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate51.errors = [
                    {
                      instancePath: instancePath + '/node',
                      schemaPath: '#/properties/node/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.type !== void 0) {
                let data2 = data.type;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data2 === 'string') {
                    if (func2(data2) > 200) {
                      validate51.errors = [
                        {
                          instancePath: instancePath + '/type',
                          schemaPath: '#/properties/type/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 200 },
                          message: 'must NOT have more than 200 characters',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate51.errors = [
                      {
                        instancePath: instancePath + '/type',
                        schemaPath: '#/properties/type/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.sequence !== void 0) {
                  let data3 = data.sequence;
                  const _errs9 = errors;
                  if (!(
                    typeof data3 == 'number' &&
                    !(data3 % 1) &&
                    !isNaN(data3) &&
                    isFinite(data3)
                  )) {
                    validate51.errors = [
                      {
                        instancePath: instancePath + '/sequence',
                        schemaPath: '#/properties/sequence/type',
                        keyword: 'type',
                        params: { type: 'integer' },
                        message: 'must be integer',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs9) {
                    if (typeof data3 == 'number' && isFinite(data3)) {
                      if (data3 < 1 || isNaN(data3)) {
                        validate51.errors = [
                          {
                            instancePath: instancePath + '/sequence',
                            schemaPath: '#/properties/sequence/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 1 },
                            message: 'must be >= 1',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.state !== void 0) {
                    let data4 = data.state;
                    const _errs11 = errors;
                    if (!(
                      data4 === 'PENDING' ||
                      data4 === 'RUNNING' ||
                      data4 === 'WAITING' ||
                      data4 === 'COMPLETED' ||
                      data4 === 'FAILED' ||
                      data4 === 'CANCELLED'
                    )) {
                      validate51.errors = [
                        {
                          instancePath: instancePath + '/state',
                          schemaPath: '#/properties/state/enum',
                          keyword: 'enum',
                          params: { allowedValues: schema82.properties.state.enum },
                          message: 'must be equal to one of the allowed values',
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.port !== void 0) {
                      let data5 = data.port;
                      const _errs12 = errors;
                      if (typeof data5 !== 'string' && data5 !== null) {
                        validate51.errors = [
                          {
                            instancePath: instancePath + '/port',
                            schemaPath: '#/properties/port/type',
                            keyword: 'type',
                            params: { type: schema82.properties.port.type },
                            message: 'must be string,null',
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs12) {
                        if (typeof data5 === 'string') {
                          if (func2(data5) > 100) {
                            validate51.errors = [
                              {
                                instancePath: instancePath + '/port',
                                schemaPath: '#/properties/port/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 100 },
                                message: 'must NOT have more than 100 characters',
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs12 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.predecessorId !== void 0) {
                        let data6 = data.predecessorId;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        let valid2 = false;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        if (errors === _errs17) {
                          if (errors === _errs17) {
                            if (typeof data6 === 'string') {
                              if (func2(data6) > 36) {
                                const err0 = {
                                  instancePath: instancePath + '/predecessorId',
                                  schemaPath: '#/$defs/Uuid/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have more than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err0];
                                } else {
                                  vErrors.push(err0);
                                }
                                errors++;
                              } else {
                                if (func2(data6) < 36) {
                                  const err1 = {
                                    instancePath: instancePath + '/predecessorId',
                                    schemaPath: '#/$defs/Uuid/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have fewer than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err1];
                                  } else {
                                    vErrors.push(err1);
                                  }
                                  errors++;
                                } else {
                                  if (!formats0.test(data6)) {
                                    const err2 = {
                                      instancePath: instancePath + '/predecessorId',
                                      schemaPath: '#/$defs/Uuid/format',
                                      keyword: 'format',
                                      params: { format: 'uuid' },
                                      message: 'must match format "uuid"',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err2];
                                    } else {
                                      vErrors.push(err2);
                                    }
                                    errors++;
                                  }
                                }
                              }
                            } else {
                              const err3 = {
                                instancePath: instancePath + '/predecessorId',
                                schemaPath: '#/$defs/Uuid/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              };
                              if (vErrors === null) {
                                vErrors = [err3];
                              } else {
                                vErrors.push(err3);
                              }
                              errors++;
                            }
                          }
                        }
                        var _valid0 = _errs16 === errors;
                        valid2 = valid2 || _valid0;
                        const _errs19 = errors;
                        if (data6 !== null) {
                          const err4 = {
                            instancePath: instancePath + '/predecessorId',
                            schemaPath: '#/properties/predecessorId/anyOf/1/type',
                            keyword: 'type',
                            params: { type: 'null' },
                            message: 'must be null',
                          };
                          if (vErrors === null) {
                            vErrors = [err4];
                          } else {
                            vErrors.push(err4);
                          }
                          errors++;
                        }
                        var _valid0 = _errs19 === errors;
                        valid2 = valid2 || _valid0;
                        if (!valid2) {
                          const err5 = {
                            instancePath: instancePath + '/predecessorId',
                            schemaPath: '#/properties/predecessorId/anyOf',
                            keyword: 'anyOf',
                            params: {},
                            message: 'must match a schema in anyOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err5];
                          } else {
                            vErrors.push(err5);
                          }
                          errors++;
                          validate51.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs15;
                          if (vErrors !== null) {
                            if (_errs15) {
                              vErrors.length = _errs15;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid0 = _errs14 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.connectionId !== void 0) {
                          let data7 = data.connectionId;
                          const _errs21 = errors;
                          if (typeof data7 !== 'string' && data7 !== null) {
                            validate51.errors = [
                              {
                                instancePath: instancePath + '/connectionId',
                                schemaPath: '#/properties/connectionId/type',
                                keyword: 'type',
                                params: { type: schema82.properties.connectionId.type },
                                message: 'must be string,null',
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs21) {
                            if (typeof data7 === 'string') {
                              if (func2(data7) > 200) {
                                validate51.errors = [
                                  {
                                    instancePath: instancePath + '/connectionId',
                                    schemaPath: '#/properties/connectionId/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 200 },
                                    message: 'must NOT have more than 200 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid0 = _errs21 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.sources !== void 0) {
                            let data8 = data.sources;
                            const _errs23 = errors;
                            if (
                              !(data8 && typeof data8 == 'object' && !Array.isArray(data8)) &&
                              data8 !== null
                            ) {
                              validate51.errors = [
                                {
                                  instancePath: instancePath + '/sources',
                                  schemaPath: '#/properties/sources/type',
                                  keyword: 'type',
                                  params: { type: schema82.properties.sources.type },
                                  message: 'must be object,null',
                                },
                              ];
                              return false;
                            }
                            var valid0 = _errs23 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.attempts !== void 0) {
                              let data9 = data.attempts;
                              const _errs25 = errors;
                              if (errors === _errs25) {
                                if (Array.isArray(data9)) {
                                  if (data9.length > 1e3) {
                                    validate51.errors = [
                                      {
                                        instancePath: instancePath + '/attempts',
                                        schemaPath: '#/properties/attempts/maxItems',
                                        keyword: 'maxItems',
                                        params: { limit: 1e3 },
                                        message: 'must NOT have more than 1000 items',
                                      },
                                    ];
                                    return false;
                                  } else {
                                    var valid4 = true;
                                    const len0 = data9.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                      let data10 = data9[i0];
                                      const _errs27 = errors;
                                      const _errs28 = errors;
                                      if (errors === _errs28) {
                                        if (
                                          data10 &&
                                          typeof data10 == 'object' &&
                                          !Array.isArray(data10)
                                        ) {
                                          let missing1;
                                          if (
                                            (data10.number === void 0 && (missing1 = 'number')) ||
                                            (data10.state === void 0 && (missing1 = 'state')) ||
                                            (data10.error === void 0 && (missing1 = 'error'))
                                          ) {
                                            validate51.errors = [
                                              {
                                                instancePath: instancePath + '/attempts/' + i0,
                                                schemaPath: '#/$defs/Attempt/required',
                                                keyword: 'required',
                                                params: { missingProperty: missing1 },
                                                message:
                                                  "must have required property '" + missing1 + "'",
                                              },
                                            ];
                                            return false;
                                          } else {
                                            const _errs30 = errors;
                                            for (const key1 in data10) {
                                              if (!(
                                                key1 === 'number' ||
                                                key1 === 'state' ||
                                                key1 === 'error'
                                              )) {
                                                validate51.errors = [
                                                  {
                                                    instancePath: instancePath + '/attempts/' + i0,
                                                    schemaPath:
                                                      '#/$defs/Attempt/additionalProperties',
                                                    keyword: 'additionalProperties',
                                                    params: { additionalProperty: key1 },
                                                    message: 'must NOT have additional properties',
                                                  },
                                                ];
                                                return false;
                                                break;
                                              }
                                            }
                                            if (_errs30 === errors) {
                                              if (data10.number !== void 0) {
                                                let data11 = data10.number;
                                                const _errs31 = errors;
                                                if (!(
                                                  typeof data11 == 'number' &&
                                                  !(data11 % 1) &&
                                                  !isNaN(data11) &&
                                                  isFinite(data11)
                                                )) {
                                                  validate51.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath +
                                                        '/attempts/' +
                                                        i0 +
                                                        '/number',
                                                      schemaPath:
                                                        '#/$defs/Attempt/properties/number/type',
                                                      keyword: 'type',
                                                      params: { type: 'integer' },
                                                      message: 'must be integer',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                                if (errors === _errs31) {
                                                  if (
                                                    typeof data11 == 'number' &&
                                                    isFinite(data11)
                                                  ) {
                                                    if (data11 < 1 || isNaN(data11)) {
                                                      validate51.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath +
                                                            '/attempts/' +
                                                            i0 +
                                                            '/number',
                                                          schemaPath:
                                                            '#/$defs/Attempt/properties/number/minimum',
                                                          keyword: 'minimum',
                                                          params: { comparison: '>=', limit: 1 },
                                                          message: 'must be >= 1',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  }
                                                }
                                                var valid6 = _errs31 === errors;
                                              } else {
                                                var valid6 = true;
                                              }
                                              if (valid6) {
                                                if (data10.state !== void 0) {
                                                  let data12 = data10.state;
                                                  const _errs33 = errors;
                                                  if (!(
                                                    data12 === 'PENDING' ||
                                                    data12 === 'RUNNING' ||
                                                    data12 === 'WAITING' ||
                                                    data12 === 'COMPLETED' ||
                                                    data12 === 'FAILED' ||
                                                    data12 === 'INTERRUPTED' ||
                                                    data12 === 'CANCELLED'
                                                  )) {
                                                    validate51.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          '/attempts/' +
                                                          i0 +
                                                          '/state',
                                                        schemaPath:
                                                          '#/$defs/Attempt/properties/state/enum',
                                                        keyword: 'enum',
                                                        params: {
                                                          allowedValues:
                                                            schema85.properties.state.enum,
                                                        },
                                                        message:
                                                          'must be equal to one of the allowed values',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                  var valid6 = _errs33 === errors;
                                                } else {
                                                  var valid6 = true;
                                                }
                                              }
                                            }
                                          }
                                        } else {
                                          validate51.errors = [
                                            {
                                              instancePath: instancePath + '/attempts/' + i0,
                                              schemaPath: '#/$defs/Attempt/type',
                                              keyword: 'type',
                                              params: { type: 'object' },
                                              message: 'must be object',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid4 = _errs27 === errors;
                                      if (!valid4) {
                                        break;
                                      }
                                    }
                                  }
                                } else {
                                  validate51.errors = [
                                    {
                                      instancePath: instancePath + '/attempts',
                                      schemaPath: '#/properties/attempts/type',
                                      keyword: 'type',
                                      params: { type: 'array' },
                                      message: 'must be array',
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs25 === errors;
                            } else {
                              var valid0 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate51.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate51.errors = vErrors;
  return errors === 0;
}
validate51.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate50(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate50.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.state === void 0 && (missing0 = 'state')) ||
        (data.workflowId === void 0 && (missing0 = 'workflowId')) ||
        (data.versionId === void 0 && (missing0 = 'versionId')) ||
        (data.versionNumber === void 0 && (missing0 = 'versionNumber')) ||
        (data.repository === void 0 && (missing0 = 'repository')) ||
        (data.baseCommit === void 0 && (missing0 = 'baseCommit')) ||
        (data.workspace === void 0 && (missing0 = 'workspace')) ||
        (data.attention === void 0 && (missing0 = 'attention')) ||
        (data.wait === void 0 && (missing0 = 'wait')) ||
        (data.activeTime === void 0 && (missing0 = 'activeTime')) ||
        (data.cancelRequested === void 0 && (missing0 = 'cancelRequested')) ||
        (data.outcome === void 0 && (missing0 = 'outcome')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.finishedAt === void 0 && (missing0 = 'finishedAt')) ||
        (data.executions === void 0 && (missing0 = 'executions')) ||
        (data.invocations === void 0 && (missing0 = 'invocations')) ||
        (data.controls === void 0 && (missing0 = 'controls'))
      ) {
        validate50.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema77.properties, key0)) {
            validate50.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate50.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate50.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate50.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate50.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.state !== void 0) {
              let data1 = data.state;
              const _errs5 = errors;
              if (!(
                data1 === 'QUEUED' ||
                data1 === 'RUNNING' ||
                data1 === 'WAITING' ||
                data1 === 'HELD' ||
                data1 === 'NEEDS_HUMAN' ||
                data1 === 'FAILED' ||
                data1 === 'CANCEL_REQUESTED' ||
                data1 === 'CANCELLED' ||
                data1 === 'COMPLETED'
              )) {
                validate50.errors = [
                  {
                    instancePath: instancePath + '/state',
                    schemaPath: '#/properties/state/enum',
                    keyword: 'enum',
                    params: { allowedValues: schema77.properties.state.enum },
                    message: 'must be equal to one of the allowed values',
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workflowId !== void 0) {
                let data2 = data.workflowId;
                const _errs6 = errors;
                const _errs7 = errors;
                let valid2 = false;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (errors === _errs9) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        const err0 = {
                          instancePath: instancePath + '/workflowId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        };
                        if (vErrors === null) {
                          vErrors = [err0];
                        } else {
                          vErrors.push(err0);
                        }
                        errors++;
                      } else {
                        if (func2(data2) < 36) {
                          const err1 = {
                            instancePath: instancePath + '/workflowId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err1];
                          } else {
                            vErrors.push(err1);
                          }
                          errors++;
                        } else {
                          if (!formats0.test(data2)) {
                            const err2 = {
                              instancePath: instancePath + '/workflowId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            };
                            if (vErrors === null) {
                              vErrors = [err2];
                            } else {
                              vErrors.push(err2);
                            }
                            errors++;
                          }
                        }
                      }
                    } else {
                      const err3 = {
                        instancePath: instancePath + '/workflowId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      };
                      if (vErrors === null) {
                        vErrors = [err3];
                      } else {
                        vErrors.push(err3);
                      }
                      errors++;
                    }
                  }
                }
                var _valid0 = _errs8 === errors;
                valid2 = valid2 || _valid0;
                const _errs11 = errors;
                if (data2 !== null) {
                  const err4 = {
                    instancePath: instancePath + '/workflowId',
                    schemaPath: '#/properties/workflowId/anyOf/1/type',
                    keyword: 'type',
                    params: { type: 'null' },
                    message: 'must be null',
                  };
                  if (vErrors === null) {
                    vErrors = [err4];
                  } else {
                    vErrors.push(err4);
                  }
                  errors++;
                }
                var _valid0 = _errs11 === errors;
                valid2 = valid2 || _valid0;
                if (!valid2) {
                  const err5 = {
                    instancePath: instancePath + '/workflowId',
                    schemaPath: '#/properties/workflowId/anyOf',
                    keyword: 'anyOf',
                    params: {},
                    message: 'must match a schema in anyOf',
                  };
                  if (vErrors === null) {
                    vErrors = [err5];
                  } else {
                    vErrors.push(err5);
                  }
                  errors++;
                  validate50.errors = vErrors;
                  return false;
                } else {
                  errors = _errs7;
                  if (vErrors !== null) {
                    if (_errs7) {
                      vErrors.length = _errs7;
                    } else {
                      vErrors = null;
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.versionId !== void 0) {
                  let data3 = data.versionId;
                  const _errs13 = errors;
                  const _errs14 = errors;
                  let valid4 = false;
                  const _errs15 = errors;
                  const _errs16 = errors;
                  if (errors === _errs16) {
                    if (errors === _errs16) {
                      if (typeof data3 === 'string') {
                        if (func2(data3) > 36) {
                          const err6 = {
                            instancePath: instancePath + '/versionId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err6];
                          } else {
                            vErrors.push(err6);
                          }
                          errors++;
                        } else {
                          if (func2(data3) < 36) {
                            const err7 = {
                              instancePath: instancePath + '/versionId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            };
                            if (vErrors === null) {
                              vErrors = [err7];
                            } else {
                              vErrors.push(err7);
                            }
                            errors++;
                          } else {
                            if (!formats0.test(data3)) {
                              const err8 = {
                                instancePath: instancePath + '/versionId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              };
                              if (vErrors === null) {
                                vErrors = [err8];
                              } else {
                                vErrors.push(err8);
                              }
                              errors++;
                            }
                          }
                        }
                      } else {
                        const err9 = {
                          instancePath: instancePath + '/versionId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        };
                        if (vErrors === null) {
                          vErrors = [err9];
                        } else {
                          vErrors.push(err9);
                        }
                        errors++;
                      }
                    }
                  }
                  var _valid1 = _errs15 === errors;
                  valid4 = valid4 || _valid1;
                  const _errs18 = errors;
                  if (data3 !== null) {
                    const err10 = {
                      instancePath: instancePath + '/versionId',
                      schemaPath: '#/properties/versionId/anyOf/1/type',
                      keyword: 'type',
                      params: { type: 'null' },
                      message: 'must be null',
                    };
                    if (vErrors === null) {
                      vErrors = [err10];
                    } else {
                      vErrors.push(err10);
                    }
                    errors++;
                  }
                  var _valid1 = _errs18 === errors;
                  valid4 = valid4 || _valid1;
                  if (!valid4) {
                    const err11 = {
                      instancePath: instancePath + '/versionId',
                      schemaPath: '#/properties/versionId/anyOf',
                      keyword: 'anyOf',
                      params: {},
                      message: 'must match a schema in anyOf',
                    };
                    if (vErrors === null) {
                      vErrors = [err11];
                    } else {
                      vErrors.push(err11);
                    }
                    errors++;
                    validate50.errors = vErrors;
                    return false;
                  } else {
                    errors = _errs14;
                    if (vErrors !== null) {
                      if (_errs14) {
                        vErrors.length = _errs14;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.versionNumber !== void 0) {
                    let data4 = data.versionNumber;
                    const _errs20 = errors;
                    if (
                      !(
                        typeof data4 == 'number' &&
                        !(data4 % 1) &&
                        !isNaN(data4) &&
                        isFinite(data4)
                      ) &&
                      data4 !== null
                    ) {
                      validate50.errors = [
                        {
                          instancePath: instancePath + '/versionNumber',
                          schemaPath: '#/properties/versionNumber/type',
                          keyword: 'type',
                          params: { type: schema77.properties.versionNumber.type },
                          message: 'must be integer,null',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs20) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 1 || isNaN(data4)) {
                          validate50.errors = [
                            {
                              instancePath: instancePath + '/versionNumber',
                              schemaPath: '#/properties/versionNumber/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 1 },
                              message: 'must be >= 1',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs20 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.repository !== void 0) {
                      let data5 = data.repository;
                      const _errs22 = errors;
                      if (errors === _errs22) {
                        if (typeof data5 === 'string') {
                          if (func2(data5) > 4096) {
                            validate50.errors = [
                              {
                                instancePath: instancePath + '/repository',
                                schemaPath: '#/properties/repository/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 4096 },
                                message: 'must NOT have more than 4096 characters',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate50.errors = [
                            {
                              instancePath: instancePath + '/repository',
                              schemaPath: '#/properties/repository/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs22 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.baseCommit !== void 0) {
                        let data6 = data.baseCommit;
                        const _errs24 = errors;
                        if (typeof data6 !== 'string' && data6 !== null) {
                          validate50.errors = [
                            {
                              instancePath: instancePath + '/baseCommit',
                              schemaPath: '#/properties/baseCommit/type',
                              keyword: 'type',
                              params: { type: schema77.properties.baseCommit.type },
                              message: 'must be string,null',
                            },
                          ];
                          return false;
                        }
                        if (errors === _errs24) {
                          if (typeof data6 === 'string') {
                            if (func2(data6) > 64) {
                              validate50.errors = [
                                {
                                  instancePath: instancePath + '/baseCommit',
                                  schemaPath: '#/properties/baseCommit/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 64 },
                                  message: 'must NOT have more than 64 characters',
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid0 = _errs24 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.workspace !== void 0) {
                          let data7 = data.workspace;
                          const _errs26 = errors;
                          const _errs27 = errors;
                          let valid6 = false;
                          const _errs28 = errors;
                          if (data7 !== null) {
                            const err12 = {
                              instancePath: instancePath + '/workspace',
                              schemaPath: '#/properties/workspace/anyOf/0/type',
                              keyword: 'type',
                              params: { type: 'null' },
                              message: 'must be null',
                            };
                            if (vErrors === null) {
                              vErrors = [err12];
                            } else {
                              vErrors.push(err12);
                            }
                            errors++;
                          }
                          var _valid2 = _errs28 === errors;
                          valid6 = valid6 || _valid2;
                          const _errs30 = errors;
                          if (errors === _errs30) {
                            if (data7 && typeof data7 == 'object' && !Array.isArray(data7)) {
                              let missing1;
                              if (
                                (data7.id === void 0 && (missing1 = 'id')) ||
                                (data7.path === void 0 && (missing1 = 'path')) ||
                                (data7.state === void 0 && (missing1 = 'state'))
                              ) {
                                const err13 = {
                                  instancePath: instancePath + '/workspace',
                                  schemaPath: '#/properties/workspace/anyOf/1/required',
                                  keyword: 'required',
                                  params: { missingProperty: missing1 },
                                  message: "must have required property '" + missing1 + "'",
                                };
                                if (vErrors === null) {
                                  vErrors = [err13];
                                } else {
                                  vErrors.push(err13);
                                }
                                errors++;
                              } else {
                                const _errs32 = errors;
                                for (const key1 in data7) {
                                  if (!(key1 === 'id' || key1 === 'path' || key1 === 'state')) {
                                    const err14 = {
                                      instancePath: instancePath + '/workspace',
                                      schemaPath:
                                        '#/properties/workspace/anyOf/1/additionalProperties',
                                      keyword: 'additionalProperties',
                                      params: { additionalProperty: key1 },
                                      message: 'must NOT have additional properties',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err14];
                                    } else {
                                      vErrors.push(err14);
                                    }
                                    errors++;
                                    break;
                                  }
                                }
                                if (_errs32 === errors) {
                                  if (data7.id !== void 0) {
                                    let data8 = data7.id;
                                    const _errs33 = errors;
                                    const _errs34 = errors;
                                    if (errors === _errs34) {
                                      if (errors === _errs34) {
                                        if (typeof data8 === 'string') {
                                          if (func2(data8) > 36) {
                                            const err15 = {
                                              instancePath: instancePath + '/workspace/id',
                                              schemaPath: '#/$defs/Uuid/maxLength',
                                              keyword: 'maxLength',
                                              params: { limit: 36 },
                                              message: 'must NOT have more than 36 characters',
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err15];
                                            } else {
                                              vErrors.push(err15);
                                            }
                                            errors++;
                                          } else {
                                            if (func2(data8) < 36) {
                                              const err16 = {
                                                instancePath: instancePath + '/workspace/id',
                                                schemaPath: '#/$defs/Uuid/minLength',
                                                keyword: 'minLength',
                                                params: { limit: 36 },
                                                message: 'must NOT have fewer than 36 characters',
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err16];
                                              } else {
                                                vErrors.push(err16);
                                              }
                                              errors++;
                                            } else {
                                              if (!formats0.test(data8)) {
                                                const err17 = {
                                                  instancePath: instancePath + '/workspace/id',
                                                  schemaPath: '#/$defs/Uuid/format',
                                                  keyword: 'format',
                                                  params: { format: 'uuid' },
                                                  message: 'must match format "uuid"',
                                                };
                                                if (vErrors === null) {
                                                  vErrors = [err17];
                                                } else {
                                                  vErrors.push(err17);
                                                }
                                                errors++;
                                              }
                                            }
                                          }
                                        } else {
                                          const err18 = {
                                            instancePath: instancePath + '/workspace/id',
                                            schemaPath: '#/$defs/Uuid/type',
                                            keyword: 'type',
                                            params: { type: 'string' },
                                            message: 'must be string',
                                          };
                                          if (vErrors === null) {
                                            vErrors = [err18];
                                          } else {
                                            vErrors.push(err18);
                                          }
                                          errors++;
                                        }
                                      }
                                    }
                                    var valid7 = _errs33 === errors;
                                  } else {
                                    var valid7 = true;
                                  }
                                  if (valid7) {
                                    if (data7.path !== void 0) {
                                      let data9 = data7.path;
                                      const _errs36 = errors;
                                      if (typeof data9 !== 'string' && data9 !== null) {
                                        const err19 = {
                                          instancePath: instancePath + '/workspace/path',
                                          schemaPath:
                                            '#/properties/workspace/anyOf/1/properties/path/type',
                                          keyword: 'type',
                                          params: {
                                            type: schema77.properties.workspace.anyOf[1].properties
                                              .path.type,
                                          },
                                          message: 'must be string,null',
                                        };
                                        if (vErrors === null) {
                                          vErrors = [err19];
                                        } else {
                                          vErrors.push(err19);
                                        }
                                        errors++;
                                      }
                                      if (errors === _errs36) {
                                        if (typeof data9 === 'string') {
                                          if (func2(data9) > 4096) {
                                            const err20 = {
                                              instancePath: instancePath + '/workspace/path',
                                              schemaPath:
                                                '#/properties/workspace/anyOf/1/properties/path/maxLength',
                                              keyword: 'maxLength',
                                              params: { limit: 4096 },
                                              message: 'must NOT have more than 4096 characters',
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err20];
                                            } else {
                                              vErrors.push(err20);
                                            }
                                            errors++;
                                          }
                                        }
                                      }
                                      var valid7 = _errs36 === errors;
                                    } else {
                                      var valid7 = true;
                                    }
                                    if (valid7) {
                                      if (data7.state !== void 0) {
                                        let data10 = data7.state;
                                        const _errs38 = errors;
                                        if (typeof data10 !== 'string' && data10 !== null) {
                                          const err21 = {
                                            instancePath: instancePath + '/workspace/state',
                                            schemaPath:
                                              '#/properties/workspace/anyOf/1/properties/state/type',
                                            keyword: 'type',
                                            params: {
                                              type: schema77.properties.workspace.anyOf[1]
                                                .properties.state.type,
                                            },
                                            message: 'must be string,null',
                                          };
                                          if (vErrors === null) {
                                            vErrors = [err21];
                                          } else {
                                            vErrors.push(err21);
                                          }
                                          errors++;
                                        }
                                        if (errors === _errs38) {
                                          if (typeof data10 === 'string') {
                                            if (func2(data10) > 20) {
                                              const err22 = {
                                                instancePath: instancePath + '/workspace/state',
                                                schemaPath:
                                                  '#/properties/workspace/anyOf/1/properties/state/maxLength',
                                                keyword: 'maxLength',
                                                params: { limit: 20 },
                                                message: 'must NOT have more than 20 characters',
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err22];
                                              } else {
                                                vErrors.push(err22);
                                              }
                                              errors++;
                                            }
                                          }
                                        }
                                        var valid7 = _errs38 === errors;
                                      } else {
                                        var valid7 = true;
                                      }
                                    }
                                  }
                                }
                              }
                            } else {
                              const err23 = {
                                instancePath: instancePath + '/workspace',
                                schemaPath: '#/properties/workspace/anyOf/1/type',
                                keyword: 'type',
                                params: { type: 'object' },
                                message: 'must be object',
                              };
                              if (vErrors === null) {
                                vErrors = [err23];
                              } else {
                                vErrors.push(err23);
                              }
                              errors++;
                            }
                          }
                          var _valid2 = _errs30 === errors;
                          valid6 = valid6 || _valid2;
                          if (!valid6) {
                            const err24 = {
                              instancePath: instancePath + '/workspace',
                              schemaPath: '#/properties/workspace/anyOf',
                              keyword: 'anyOf',
                              params: {},
                              message: 'must match a schema in anyOf',
                            };
                            if (vErrors === null) {
                              vErrors = [err24];
                            } else {
                              vErrors.push(err24);
                            }
                            errors++;
                            validate50.errors = vErrors;
                            return false;
                          } else {
                            errors = _errs27;
                            if (vErrors !== null) {
                              if (_errs27) {
                                vErrors.length = _errs27;
                              } else {
                                vErrors = null;
                              }
                            }
                          }
                          var valid0 = _errs26 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.attention !== void 0) {
                            let data11 = data.attention;
                            const _errs40 = errors;
                            if (
                              !(data11 && typeof data11 == 'object' && !Array.isArray(data11)) &&
                              data11 !== null
                            ) {
                              validate50.errors = [
                                {
                                  instancePath: instancePath + '/attention',
                                  schemaPath: '#/properties/attention/type',
                                  keyword: 'type',
                                  params: { type: schema77.properties.attention.type },
                                  message: 'must be object,null',
                                },
                              ];
                              return false;
                            }
                            var valid0 = _errs40 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.wait !== void 0) {
                              let data12 = data.wait;
                              const _errs42 = errors;
                              if (
                                !(data12 && typeof data12 == 'object' && !Array.isArray(data12)) &&
                                data12 !== null
                              ) {
                                validate50.errors = [
                                  {
                                    instancePath: instancePath + '/wait',
                                    schemaPath: '#/properties/wait/type',
                                    keyword: 'type',
                                    params: { type: schema77.properties.wait.type },
                                    message: 'must be object,null',
                                  },
                                ];
                                return false;
                              }
                              var valid0 = _errs42 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.activeTime !== void 0) {
                                let data13 = data.activeTime;
                                const _errs44 = errors;
                                if (errors === _errs44) {
                                  if (
                                    data13 &&
                                    typeof data13 == 'object' &&
                                    !Array.isArray(data13)
                                  ) {
                                    let missing2;
                                    if (
                                      (data13.usedMs === void 0 && (missing2 = 'usedMs')) ||
                                      (data13.limitMs === void 0 && (missing2 = 'limitMs'))
                                    ) {
                                      validate50.errors = [
                                        {
                                          instancePath: instancePath + '/activeTime',
                                          schemaPath: '#/properties/activeTime/required',
                                          keyword: 'required',
                                          params: { missingProperty: missing2 },
                                          message: "must have required property '" + missing2 + "'",
                                        },
                                      ];
                                      return false;
                                    } else {
                                      const _errs46 = errors;
                                      for (const key2 in data13) {
                                        if (!(key2 === 'usedMs' || key2 === 'limitMs')) {
                                          validate50.errors = [
                                            {
                                              instancePath: instancePath + '/activeTime',
                                              schemaPath:
                                                '#/properties/activeTime/additionalProperties',
                                              keyword: 'additionalProperties',
                                              params: { additionalProperty: key2 },
                                              message: 'must NOT have additional properties',
                                            },
                                          ];
                                          return false;
                                          break;
                                        }
                                      }
                                      if (_errs46 === errors) {
                                        if (data13.usedMs !== void 0) {
                                          let data14 = data13.usedMs;
                                          const _errs47 = errors;
                                          if (!(
                                            typeof data14 == 'number' &&
                                            !(data14 % 1) &&
                                            !isNaN(data14) &&
                                            isFinite(data14)
                                          )) {
                                            validate50.errors = [
                                              {
                                                instancePath: instancePath + '/activeTime/usedMs',
                                                schemaPath:
                                                  '#/properties/activeTime/properties/usedMs/type',
                                                keyword: 'type',
                                                params: { type: 'integer' },
                                                message: 'must be integer',
                                              },
                                            ];
                                            return false;
                                          }
                                          if (errors === _errs47) {
                                            if (typeof data14 == 'number' && isFinite(data14)) {
                                              if (data14 < 0 || isNaN(data14)) {
                                                validate50.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + '/activeTime/usedMs',
                                                    schemaPath:
                                                      '#/properties/activeTime/properties/usedMs/minimum',
                                                    keyword: 'minimum',
                                                    params: { comparison: '>=', limit: 0 },
                                                    message: 'must be >= 0',
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                          }
                                          var valid9 = _errs47 === errors;
                                        } else {
                                          var valid9 = true;
                                        }
                                        if (valid9) {
                                          if (data13.limitMs !== void 0) {
                                            let data15 = data13.limitMs;
                                            const _errs49 = errors;
                                            if (!(
                                              typeof data15 == 'number' &&
                                              !(data15 % 1) &&
                                              !isNaN(data15) &&
                                              isFinite(data15)
                                            )) {
                                              validate50.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + '/activeTime/limitMs',
                                                  schemaPath:
                                                    '#/properties/activeTime/properties/limitMs/type',
                                                  keyword: 'type',
                                                  params: { type: 'integer' },
                                                  message: 'must be integer',
                                                },
                                              ];
                                              return false;
                                            }
                                            if (errors === _errs49) {
                                              if (typeof data15 == 'number' && isFinite(data15)) {
                                                if (data15 < 0 || isNaN(data15)) {
                                                  validate50.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath + '/activeTime/limitMs',
                                                      schemaPath:
                                                        '#/properties/activeTime/properties/limitMs/minimum',
                                                      keyword: 'minimum',
                                                      params: { comparison: '>=', limit: 0 },
                                                      message: 'must be >= 0',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            }
                                            var valid9 = _errs49 === errors;
                                          } else {
                                            var valid9 = true;
                                          }
                                        }
                                      }
                                    }
                                  } else {
                                    validate50.errors = [
                                      {
                                        instancePath: instancePath + '/activeTime',
                                        schemaPath: '#/properties/activeTime/type',
                                        keyword: 'type',
                                        params: { type: 'object' },
                                        message: 'must be object',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs44 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.cancelRequested !== void 0) {
                                  const _errs51 = errors;
                                  if (typeof data.cancelRequested !== 'boolean') {
                                    validate50.errors = [
                                      {
                                        instancePath: instancePath + '/cancelRequested',
                                        schemaPath: '#/properties/cancelRequested/type',
                                        keyword: 'type',
                                        params: { type: 'boolean' },
                                        message: 'must be boolean',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid0 = _errs51 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.createdAt !== void 0) {
                                    let data17 = data.createdAt;
                                    const _errs53 = errors;
                                    if (!(
                                      typeof data17 == 'number' &&
                                      !(data17 % 1) &&
                                      !isNaN(data17) &&
                                      isFinite(data17)
                                    )) {
                                      validate50.errors = [
                                        {
                                          instancePath: instancePath + '/createdAt',
                                          schemaPath: '#/properties/createdAt/type',
                                          keyword: 'type',
                                          params: { type: 'integer' },
                                          message: 'must be integer',
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs53) {
                                      if (typeof data17 == 'number' && isFinite(data17)) {
                                        if (data17 < 0 || isNaN(data17)) {
                                          validate50.errors = [
                                            {
                                              instancePath: instancePath + '/createdAt',
                                              schemaPath: '#/properties/createdAt/minimum',
                                              keyword: 'minimum',
                                              params: { comparison: '>=', limit: 0 },
                                              message: 'must be >= 0',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                    }
                                    var valid0 = _errs53 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.finishedAt !== void 0) {
                                      let data18 = data.finishedAt;
                                      const _errs55 = errors;
                                      if (
                                        !(
                                          typeof data18 == 'number' &&
                                          !(data18 % 1) &&
                                          !isNaN(data18) &&
                                          isFinite(data18)
                                        ) &&
                                        data18 !== null
                                      ) {
                                        validate50.errors = [
                                          {
                                            instancePath: instancePath + '/finishedAt',
                                            schemaPath: '#/properties/finishedAt/type',
                                            keyword: 'type',
                                            params: { type: schema77.properties.finishedAt.type },
                                            message: 'must be integer,null',
                                          },
                                        ];
                                        return false;
                                      }
                                      if (errors === _errs55) {
                                        if (typeof data18 == 'number' && isFinite(data18)) {
                                          if (data18 < 0 || isNaN(data18)) {
                                            validate50.errors = [
                                              {
                                                instancePath: instancePath + '/finishedAt',
                                                schemaPath: '#/properties/finishedAt/minimum',
                                                keyword: 'minimum',
                                                params: { comparison: '>=', limit: 0 },
                                                message: 'must be >= 0',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                      var valid0 = _errs55 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.executions !== void 0) {
                                        let data19 = data.executions;
                                        const _errs57 = errors;
                                        if (errors === _errs57) {
                                          if (Array.isArray(data19)) {
                                            if (data19.length > 1e5) {
                                              validate50.errors = [
                                                {
                                                  instancePath: instancePath + '/executions',
                                                  schemaPath: '#/properties/executions/maxItems',
                                                  keyword: 'maxItems',
                                                  params: { limit: 1e5 },
                                                  message: 'must NOT have more than 100000 items',
                                                },
                                              ];
                                              return false;
                                            } else {
                                              var valid10 = true;
                                              const len0 = data19.length;
                                              for (let i0 = 0; i0 < len0; i0++) {
                                                const _errs59 = errors;
                                                if (
                                                  !validate51(data19[i0], {
                                                    instancePath:
                                                      instancePath + '/executions/' + i0,
                                                    parentData: data19,
                                                    parentDataProperty: i0,
                                                    rootData,
                                                    dynamicAnchors,
                                                  })
                                                ) {
                                                  vErrors =
                                                    vErrors === null
                                                      ? validate51.errors
                                                      : vErrors.concat(validate51.errors);
                                                  errors = vErrors.length;
                                                }
                                                var valid10 = _errs59 === errors;
                                                if (!valid10) {
                                                  break;
                                                }
                                              }
                                            }
                                          } else {
                                            validate50.errors = [
                                              {
                                                instancePath: instancePath + '/executions',
                                                schemaPath: '#/properties/executions/type',
                                                keyword: 'type',
                                                params: { type: 'array' },
                                                message: 'must be array',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                        var valid0 = _errs57 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (data.invocations !== void 0) {
                                          let data21 = data.invocations;
                                          const _errs60 = errors;
                                          if (errors === _errs60) {
                                            if (Array.isArray(data21)) {
                                              if (data21.length > 1e5) {
                                                validate50.errors = [
                                                  {
                                                    instancePath: instancePath + '/invocations',
                                                    schemaPath: '#/properties/invocations/maxItems',
                                                    keyword: 'maxItems',
                                                    params: { limit: 1e5 },
                                                    message: 'must NOT have more than 100000 items',
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                var valid11 = true;
                                                const len1 = data21.length;
                                                for (let i1 = 0; i1 < len1; i1++) {
                                                  let data22 = data21[i1];
                                                  const _errs62 = errors;
                                                  if (errors === _errs62) {
                                                    if (
                                                      data22 &&
                                                      typeof data22 == 'object' &&
                                                      !Array.isArray(data22)
                                                    ) {
                                                      let missing3;
                                                      if (
                                                        (data22.id === void 0 &&
                                                          (missing3 = 'id')) ||
                                                        (data22.kind === void 0 &&
                                                          (missing3 = 'kind')) ||
                                                        (data22.state === void 0 &&
                                                          (missing3 = 'state')) ||
                                                        (data22.correlationId === void 0 &&
                                                          (missing3 = 'correlationId')) ||
                                                        (data22.submissions === void 0 &&
                                                          (missing3 = 'submissions')) ||
                                                        (data22.acceptedSubmissions === void 0 &&
                                                          (missing3 = 'acceptedSubmissions'))
                                                      ) {
                                                        validate50.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath + '/invocations/' + i1,
                                                            schemaPath:
                                                              '#/properties/invocations/items/required',
                                                            keyword: 'required',
                                                            params: { missingProperty: missing3 },
                                                            message:
                                                              "must have required property '" +
                                                              missing3 +
                                                              "'",
                                                          },
                                                        ];
                                                        return false;
                                                      } else {
                                                        const _errs64 = errors;
                                                        for (const key3 in data22) {
                                                          if (!(
                                                            key3 === 'id' ||
                                                            key3 === 'kind' ||
                                                            key3 === 'state' ||
                                                            key3 === 'correlationId' ||
                                                            key3 === 'submissions' ||
                                                            key3 === 'acceptedSubmissions'
                                                          )) {
                                                            validate50.errors = [
                                                              {
                                                                instancePath:
                                                                  instancePath +
                                                                  '/invocations/' +
                                                                  i1,
                                                                schemaPath:
                                                                  '#/properties/invocations/items/additionalProperties',
                                                                keyword: 'additionalProperties',
                                                                params: {
                                                                  additionalProperty: key3,
                                                                },
                                                                message:
                                                                  'must NOT have additional properties',
                                                              },
                                                            ];
                                                            return false;
                                                            break;
                                                          }
                                                        }
                                                        if (_errs64 === errors) {
                                                          if (data22.id !== void 0) {
                                                            let data23 = data22.id;
                                                            const _errs65 = errors;
                                                            const _errs66 = errors;
                                                            if (errors === _errs66) {
                                                              if (errors === _errs66) {
                                                                if (typeof data23 === 'string') {
                                                                  if (func2(data23) > 36) {
                                                                    validate50.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/invocations/' +
                                                                          i1 +
                                                                          '/id',
                                                                        schemaPath:
                                                                          '#/$defs/Uuid/maxLength',
                                                                        keyword: 'maxLength',
                                                                        params: { limit: 36 },
                                                                        message:
                                                                          'must NOT have more than 36 characters',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  } else {
                                                                    if (func2(data23) < 36) {
                                                                      validate50.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/invocations/' +
                                                                            i1 +
                                                                            '/id',
                                                                          schemaPath:
                                                                            '#/$defs/Uuid/minLength',
                                                                          keyword: 'minLength',
                                                                          params: { limit: 36 },
                                                                          message:
                                                                            'must NOT have fewer than 36 characters',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    } else {
                                                                      if (!formats0.test(data23)) {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/invocations/' +
                                                                              i1 +
                                                                              '/id',
                                                                            schemaPath:
                                                                              '#/$defs/Uuid/format',
                                                                            keyword: 'format',
                                                                            params: {
                                                                              format: 'uuid',
                                                                            },
                                                                            message:
                                                                              'must match format "uuid"',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                  }
                                                                } else {
                                                                  validate50.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/invocations/' +
                                                                        i1 +
                                                                        '/id',
                                                                      schemaPath:
                                                                        '#/$defs/Uuid/type',
                                                                      keyword: 'type',
                                                                      params: { type: 'string' },
                                                                      message: 'must be string',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                }
                                                              }
                                                            }
                                                            var valid12 = _errs65 === errors;
                                                          } else {
                                                            var valid12 = true;
                                                          }
                                                          if (valid12) {
                                                            if (data22.kind !== void 0) {
                                                              let data24 = data22.kind;
                                                              const _errs68 = errors;
                                                              if (!(
                                                                data24 === 'goal' ||
                                                                data24 === 'correction' ||
                                                                data24 === 'continuation'
                                                              )) {
                                                                validate50.errors = [
                                                                  {
                                                                    instancePath:
                                                                      instancePath +
                                                                      '/invocations/' +
                                                                      i1 +
                                                                      '/kind',
                                                                    schemaPath:
                                                                      '#/properties/invocations/items/properties/kind/enum',
                                                                    keyword: 'enum',
                                                                    params: {
                                                                      allowedValues:
                                                                        schema77.properties
                                                                          .invocations.items
                                                                          .properties.kind.enum,
                                                                    },
                                                                    message:
                                                                      'must be equal to one of the allowed values',
                                                                  },
                                                                ];
                                                                return false;
                                                              }
                                                              var valid12 = _errs68 === errors;
                                                            } else {
                                                              var valid12 = true;
                                                            }
                                                            if (valid12) {
                                                              if (data22.state !== void 0) {
                                                                let data25 = data22.state;
                                                                const _errs69 = errors;
                                                                if (errors === _errs69) {
                                                                  if (typeof data25 === 'string') {
                                                                    if (func2(data25) > 20) {
                                                                      validate50.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/invocations/' +
                                                                            i1 +
                                                                            '/state',
                                                                          schemaPath:
                                                                            '#/properties/invocations/items/properties/state/maxLength',
                                                                          keyword: 'maxLength',
                                                                          params: { limit: 20 },
                                                                          message:
                                                                            'must NOT have more than 20 characters',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                  } else {
                                                                    validate50.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/invocations/' +
                                                                          i1 +
                                                                          '/state',
                                                                        schemaPath:
                                                                          '#/properties/invocations/items/properties/state/type',
                                                                        keyword: 'type',
                                                                        params: { type: 'string' },
                                                                        message: 'must be string',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  }
                                                                }
                                                                var valid12 = _errs69 === errors;
                                                              } else {
                                                                var valid12 = true;
                                                              }
                                                              if (valid12) {
                                                                if (
                                                                  data22.correlationId !== void 0
                                                                ) {
                                                                  let data26 = data22.correlationId;
                                                                  const _errs71 = errors;
                                                                  if (errors === _errs71) {
                                                                    if (
                                                                      typeof data26 === 'string'
                                                                    ) {
                                                                      if (func2(data26) > 200) {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/invocations/' +
                                                                              i1 +
                                                                              '/correlationId',
                                                                            schemaPath:
                                                                              '#/properties/invocations/items/properties/correlationId/maxLength',
                                                                            keyword: 'maxLength',
                                                                            params: { limit: 200 },
                                                                            message:
                                                                              'must NOT have more than 200 characters',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    } else {
                                                                      validate50.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/invocations/' +
                                                                            i1 +
                                                                            '/correlationId',
                                                                          schemaPath:
                                                                            '#/properties/invocations/items/properties/correlationId/type',
                                                                          keyword: 'type',
                                                                          params: {
                                                                            type: 'string',
                                                                          },
                                                                          message: 'must be string',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                  }
                                                                  var valid12 = _errs71 === errors;
                                                                } else {
                                                                  var valid12 = true;
                                                                }
                                                                if (valid12) {
                                                                  if (
                                                                    data22.submissions !== void 0
                                                                  ) {
                                                                    let data27 = data22.submissions;
                                                                    const _errs73 = errors;
                                                                    if (!(
                                                                      typeof data27 == 'number' &&
                                                                      !(data27 % 1) &&
                                                                      !isNaN(data27) &&
                                                                      isFinite(data27)
                                                                    )) {
                                                                      validate50.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/invocations/' +
                                                                            i1 +
                                                                            '/submissions',
                                                                          schemaPath:
                                                                            '#/properties/invocations/items/properties/submissions/type',
                                                                          keyword: 'type',
                                                                          params: {
                                                                            type: 'integer',
                                                                          },
                                                                          message:
                                                                            'must be integer',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    }
                                                                    if (errors === _errs73) {
                                                                      if (
                                                                        typeof data27 == 'number' &&
                                                                        isFinite(data27)
                                                                      ) {
                                                                        if (
                                                                          data27 < 0 ||
                                                                          isNaN(data27)
                                                                        ) {
                                                                          validate50.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/invocations/' +
                                                                                i1 +
                                                                                '/submissions',
                                                                              schemaPath:
                                                                                '#/properties/invocations/items/properties/submissions/minimum',
                                                                              keyword: 'minimum',
                                                                              params: {
                                                                                comparison: '>=',
                                                                                limit: 0,
                                                                              },
                                                                              message:
                                                                                'must be >= 0',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                    }
                                                                    var valid12 =
                                                                      _errs73 === errors;
                                                                  } else {
                                                                    var valid12 = true;
                                                                  }
                                                                  if (valid12) {
                                                                    if (
                                                                      data22.acceptedSubmissions !==
                                                                      void 0
                                                                    ) {
                                                                      let data28 =
                                                                        data22.acceptedSubmissions;
                                                                      const _errs75 = errors;
                                                                      if (!(
                                                                        typeof data28 == 'number' &&
                                                                        !(data28 % 1) &&
                                                                        !isNaN(data28) &&
                                                                        isFinite(data28)
                                                                      )) {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/invocations/' +
                                                                              i1 +
                                                                              '/acceptedSubmissions',
                                                                            schemaPath:
                                                                              '#/properties/invocations/items/properties/acceptedSubmissions/type',
                                                                            keyword: 'type',
                                                                            params: {
                                                                              type: 'integer',
                                                                            },
                                                                            message:
                                                                              'must be integer',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                      if (errors === _errs75) {
                                                                        if (
                                                                          typeof data28 ==
                                                                            'number' &&
                                                                          isFinite(data28)
                                                                        ) {
                                                                          if (
                                                                            data28 < 0 ||
                                                                            isNaN(data28)
                                                                          ) {
                                                                            validate50.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/invocations/' +
                                                                                  i1 +
                                                                                  '/acceptedSubmissions',
                                                                                schemaPath:
                                                                                  '#/properties/invocations/items/properties/acceptedSubmissions/minimum',
                                                                                keyword: 'minimum',
                                                                                params: {
                                                                                  comparison: '>=',
                                                                                  limit: 0,
                                                                                },
                                                                                message:
                                                                                  'must be >= 0',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                        }
                                                                      }
                                                                      var valid12 =
                                                                        _errs75 === errors;
                                                                    } else {
                                                                      var valid12 = true;
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    } else {
                                                      validate50.errors = [
                                                        {
                                                          instancePath:
                                                            instancePath + '/invocations/' + i1,
                                                          schemaPath:
                                                            '#/properties/invocations/items/type',
                                                          keyword: 'type',
                                                          params: { type: 'object' },
                                                          message: 'must be object',
                                                        },
                                                      ];
                                                      return false;
                                                    }
                                                  }
                                                  var valid11 = _errs62 === errors;
                                                  if (!valid11) {
                                                    break;
                                                  }
                                                }
                                              }
                                            } else {
                                              validate50.errors = [
                                                {
                                                  instancePath: instancePath + '/invocations',
                                                  schemaPath: '#/properties/invocations/type',
                                                  keyword: 'type',
                                                  params: { type: 'array' },
                                                  message: 'must be array',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                          var valid0 = _errs60 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                        if (valid0) {
                                          if (data.controls !== void 0) {
                                            let data29 = data.controls;
                                            const _errs77 = errors;
                                            if (errors === _errs77) {
                                              if (Array.isArray(data29)) {
                                                if (data29.length > 1e5) {
                                                  validate50.errors = [
                                                    {
                                                      instancePath: instancePath + '/controls',
                                                      schemaPath: '#/properties/controls/maxItems',
                                                      keyword: 'maxItems',
                                                      params: { limit: 1e5 },
                                                      message:
                                                        'must NOT have more than 100000 items',
                                                    },
                                                  ];
                                                  return false;
                                                } else {
                                                  var valid14 = true;
                                                  const len2 = data29.length;
                                                  for (let i2 = 0; i2 < len2; i2++) {
                                                    let data30 = data29[i2];
                                                    const _errs79 = errors;
                                                    if (errors === _errs79) {
                                                      if (
                                                        data30 &&
                                                        typeof data30 == 'object' &&
                                                        !Array.isArray(data30)
                                                      ) {
                                                        let missing4;
                                                        if (
                                                          (data30.id === void 0 &&
                                                            (missing4 = 'id')) ||
                                                          (data30.kind === void 0 &&
                                                            (missing4 = 'kind')) ||
                                                          (data30.executionId === void 0 &&
                                                            (missing4 = 'executionId')) ||
                                                          (data30.actor === void 0 &&
                                                            (missing4 = 'actor')) ||
                                                          (data30.payload === void 0 &&
                                                            (missing4 = 'payload')) ||
                                                          (data30.createdAt === void 0 &&
                                                            (missing4 = 'createdAt'))
                                                        ) {
                                                          validate50.errors = [
                                                            {
                                                              instancePath:
                                                                instancePath + '/controls/' + i2,
                                                              schemaPath:
                                                                '#/properties/controls/items/required',
                                                              keyword: 'required',
                                                              params: { missingProperty: missing4 },
                                                              message:
                                                                "must have required property '" +
                                                                missing4 +
                                                                "'",
                                                            },
                                                          ];
                                                          return false;
                                                        } else {
                                                          const _errs81 = errors;
                                                          for (const key4 in data30) {
                                                            if (!(
                                                              key4 === 'id' ||
                                                              key4 === 'kind' ||
                                                              key4 === 'executionId' ||
                                                              key4 === 'actor' ||
                                                              key4 === 'payload' ||
                                                              key4 === 'createdAt'
                                                            )) {
                                                              validate50.errors = [
                                                                {
                                                                  instancePath:
                                                                    instancePath +
                                                                    '/controls/' +
                                                                    i2,
                                                                  schemaPath:
                                                                    '#/properties/controls/items/additionalProperties',
                                                                  keyword: 'additionalProperties',
                                                                  params: {
                                                                    additionalProperty: key4,
                                                                  },
                                                                  message:
                                                                    'must NOT have additional properties',
                                                                },
                                                              ];
                                                              return false;
                                                              break;
                                                            }
                                                          }
                                                          if (_errs81 === errors) {
                                                            if (data30.id !== void 0) {
                                                              let data31 = data30.id;
                                                              const _errs82 = errors;
                                                              const _errs83 = errors;
                                                              if (errors === _errs83) {
                                                                if (errors === _errs83) {
                                                                  if (typeof data31 === 'string') {
                                                                    if (func2(data31) > 36) {
                                                                      validate50.errors = [
                                                                        {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/controls/' +
                                                                            i2 +
                                                                            '/id',
                                                                          schemaPath:
                                                                            '#/$defs/Uuid/maxLength',
                                                                          keyword: 'maxLength',
                                                                          params: { limit: 36 },
                                                                          message:
                                                                            'must NOT have more than 36 characters',
                                                                        },
                                                                      ];
                                                                      return false;
                                                                    } else {
                                                                      if (func2(data31) < 36) {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/controls/' +
                                                                              i2 +
                                                                              '/id',
                                                                            schemaPath:
                                                                              '#/$defs/Uuid/minLength',
                                                                            keyword: 'minLength',
                                                                            params: { limit: 36 },
                                                                            message:
                                                                              'must NOT have fewer than 36 characters',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      } else {
                                                                        if (
                                                                          !formats0.test(data31)
                                                                        ) {
                                                                          validate50.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/controls/' +
                                                                                i2 +
                                                                                '/id',
                                                                              schemaPath:
                                                                                '#/$defs/Uuid/format',
                                                                              keyword: 'format',
                                                                              params: {
                                                                                format: 'uuid',
                                                                              },
                                                                              message:
                                                                                'must match format "uuid"',
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        }
                                                                      }
                                                                    }
                                                                  } else {
                                                                    validate50.errors = [
                                                                      {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/controls/' +
                                                                          i2 +
                                                                          '/id',
                                                                        schemaPath:
                                                                          '#/$defs/Uuid/type',
                                                                        keyword: 'type',
                                                                        params: { type: 'string' },
                                                                        message: 'must be string',
                                                                      },
                                                                    ];
                                                                    return false;
                                                                  }
                                                                }
                                                              }
                                                              var valid15 = _errs82 === errors;
                                                            } else {
                                                              var valid15 = true;
                                                            }
                                                            if (valid15) {
                                                              if (data30.kind !== void 0) {
                                                                let data32 = data30.kind;
                                                                const _errs85 = errors;
                                                                if (!(
                                                                  data32 === 'cancel' ||
                                                                  data32 === 'retry' ||
                                                                  data32 === 'fail' ||
                                                                  data32 === 'complete' ||
                                                                  data32 === 'extend'
                                                                )) {
                                                                  validate50.errors = [
                                                                    {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/controls/' +
                                                                        i2 +
                                                                        '/kind',
                                                                      schemaPath:
                                                                        '#/properties/controls/items/properties/kind/enum',
                                                                      keyword: 'enum',
                                                                      params: {
                                                                        allowedValues:
                                                                          schema77.properties
                                                                            .controls.items
                                                                            .properties.kind.enum,
                                                                      },
                                                                      message:
                                                                        'must be equal to one of the allowed values',
                                                                    },
                                                                  ];
                                                                  return false;
                                                                }
                                                                var valid15 = _errs85 === errors;
                                                              } else {
                                                                var valid15 = true;
                                                              }
                                                              if (valid15) {
                                                                if (data30.executionId !== void 0) {
                                                                  let data33 = data30.executionId;
                                                                  const _errs86 = errors;
                                                                  const _errs87 = errors;
                                                                  let valid17 = false;
                                                                  const _errs88 = errors;
                                                                  const _errs89 = errors;
                                                                  if (errors === _errs89) {
                                                                    if (errors === _errs89) {
                                                                      if (
                                                                        typeof data33 === 'string'
                                                                      ) {
                                                                        if (func2(data33) > 36) {
                                                                          const err25 = {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/controls/' +
                                                                              i2 +
                                                                              '/executionId',
                                                                            schemaPath:
                                                                              '#/$defs/Uuid/maxLength',
                                                                            keyword: 'maxLength',
                                                                            params: { limit: 36 },
                                                                            message:
                                                                              'must NOT have more than 36 characters',
                                                                          };
                                                                          if (vErrors === null) {
                                                                            vErrors = [err25];
                                                                          } else {
                                                                            vErrors.push(err25);
                                                                          }
                                                                          errors++;
                                                                        } else {
                                                                          if (func2(data33) < 36) {
                                                                            const err26 = {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/controls/' +
                                                                                i2 +
                                                                                '/executionId',
                                                                              schemaPath:
                                                                                '#/$defs/Uuid/minLength',
                                                                              keyword: 'minLength',
                                                                              params: { limit: 36 },
                                                                              message:
                                                                                'must NOT have fewer than 36 characters',
                                                                            };
                                                                            if (vErrors === null) {
                                                                              vErrors = [err26];
                                                                            } else {
                                                                              vErrors.push(err26);
                                                                            }
                                                                            errors++;
                                                                          } else {
                                                                            if (
                                                                              !formats0.test(data33)
                                                                            ) {
                                                                              const err27 = {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/controls/' +
                                                                                  i2 +
                                                                                  '/executionId',
                                                                                schemaPath:
                                                                                  '#/$defs/Uuid/format',
                                                                                keyword: 'format',
                                                                                params: {
                                                                                  format: 'uuid',
                                                                                },
                                                                                message:
                                                                                  'must match format "uuid"',
                                                                              };
                                                                              if (
                                                                                vErrors === null
                                                                              ) {
                                                                                vErrors = [err27];
                                                                              } else {
                                                                                vErrors.push(err27);
                                                                              }
                                                                              errors++;
                                                                            }
                                                                          }
                                                                        }
                                                                      } else {
                                                                        const err28 = {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/controls/' +
                                                                            i2 +
                                                                            '/executionId',
                                                                          schemaPath:
                                                                            '#/$defs/Uuid/type',
                                                                          keyword: 'type',
                                                                          params: {
                                                                            type: 'string',
                                                                          },
                                                                          message: 'must be string',
                                                                        };
                                                                        if (vErrors === null) {
                                                                          vErrors = [err28];
                                                                        } else {
                                                                          vErrors.push(err28);
                                                                        }
                                                                        errors++;
                                                                      }
                                                                    }
                                                                  }
                                                                  var _valid3 = _errs88 === errors;
                                                                  valid17 = valid17 || _valid3;
                                                                  const _errs91 = errors;
                                                                  if (data33 !== null) {
                                                                    const err29 = {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/controls/' +
                                                                        i2 +
                                                                        '/executionId',
                                                                      schemaPath:
                                                                        '#/properties/controls/items/properties/executionId/anyOf/1/type',
                                                                      keyword: 'type',
                                                                      params: { type: 'null' },
                                                                      message: 'must be null',
                                                                    };
                                                                    if (vErrors === null) {
                                                                      vErrors = [err29];
                                                                    } else {
                                                                      vErrors.push(err29);
                                                                    }
                                                                    errors++;
                                                                  }
                                                                  var _valid3 = _errs91 === errors;
                                                                  valid17 = valid17 || _valid3;
                                                                  if (!valid17) {
                                                                    const err30 = {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/controls/' +
                                                                        i2 +
                                                                        '/executionId',
                                                                      schemaPath:
                                                                        '#/properties/controls/items/properties/executionId/anyOf',
                                                                      keyword: 'anyOf',
                                                                      params: {},
                                                                      message:
                                                                        'must match a schema in anyOf',
                                                                    };
                                                                    if (vErrors === null) {
                                                                      vErrors = [err30];
                                                                    } else {
                                                                      vErrors.push(err30);
                                                                    }
                                                                    errors++;
                                                                    validate50.errors = vErrors;
                                                                    return false;
                                                                  } else {
                                                                    errors = _errs87;
                                                                    if (vErrors !== null) {
                                                                      if (_errs87) {
                                                                        vErrors.length = _errs87;
                                                                      } else {
                                                                        vErrors = null;
                                                                      }
                                                                    }
                                                                  }
                                                                  var valid15 = _errs86 === errors;
                                                                } else {
                                                                  var valid15 = true;
                                                                }
                                                                if (valid15) {
                                                                  if (data30.actor !== void 0) {
                                                                    let data34 = data30.actor;
                                                                    const _errs93 = errors;
                                                                    if (errors === _errs93) {
                                                                      if (
                                                                        data34 &&
                                                                        typeof data34 == 'object' &&
                                                                        !Array.isArray(data34)
                                                                      ) {
                                                                        let missing5;
                                                                        if (
                                                                          (data34.kind === void 0 &&
                                                                            (missing5 = 'kind')) ||
                                                                          (data34.id === void 0 &&
                                                                            (missing5 = 'id'))
                                                                        ) {
                                                                          validate50.errors = [
                                                                            {
                                                                              instancePath:
                                                                                instancePath +
                                                                                '/controls/' +
                                                                                i2 +
                                                                                '/actor',
                                                                              schemaPath:
                                                                                '#/properties/controls/items/properties/actor/required',
                                                                              keyword: 'required',
                                                                              params: {
                                                                                missingProperty:
                                                                                  missing5,
                                                                              },
                                                                              message:
                                                                                "must have required property '" +
                                                                                missing5 +
                                                                                "'",
                                                                            },
                                                                          ];
                                                                          return false;
                                                                        } else {
                                                                          const _errs95 = errors;
                                                                          for (const key5 in data34) {
                                                                            if (!(
                                                                              key5 === 'kind' ||
                                                                              key5 === 'id'
                                                                            )) {
                                                                              validate50.errors = [
                                                                                {
                                                                                  instancePath:
                                                                                    instancePath +
                                                                                    '/controls/' +
                                                                                    i2 +
                                                                                    '/actor',
                                                                                  schemaPath:
                                                                                    '#/properties/controls/items/properties/actor/additionalProperties',
                                                                                  keyword:
                                                                                    'additionalProperties',
                                                                                  params: {
                                                                                    additionalProperty:
                                                                                      key5,
                                                                                  },
                                                                                  message:
                                                                                    'must NOT have additional properties',
                                                                                },
                                                                              ];
                                                                              return false;
                                                                              break;
                                                                            }
                                                                          }
                                                                          if (_errs95 === errors) {
                                                                            if (
                                                                              data34.kind !== void 0
                                                                            ) {
                                                                              let data35 =
                                                                                data34.kind;
                                                                              const _errs96 =
                                                                                errors;
                                                                              if (
                                                                                errors === _errs96
                                                                              ) {
                                                                                if (
                                                                                  typeof data35 ===
                                                                                  'string'
                                                                                ) {
                                                                                  if (
                                                                                    func2(data35) >
                                                                                    20
                                                                                  ) {
                                                                                    validate50.errors =
                                                                                      [
                                                                                        {
                                                                                          instancePath:
                                                                                            instancePath +
                                                                                            '/controls/' +
                                                                                            i2 +
                                                                                            '/actor/kind',
                                                                                          schemaPath:
                                                                                            '#/properties/controls/items/properties/actor/properties/kind/maxLength',
                                                                                          keyword:
                                                                                            'maxLength',
                                                                                          params: {
                                                                                            limit: 20,
                                                                                          },
                                                                                          message:
                                                                                            'must NOT have more than 20 characters',
                                                                                        },
                                                                                      ];
                                                                                    return false;
                                                                                  }
                                                                                } else {
                                                                                  validate50.errors =
                                                                                    [
                                                                                      {
                                                                                        instancePath:
                                                                                          instancePath +
                                                                                          '/controls/' +
                                                                                          i2 +
                                                                                          '/actor/kind',
                                                                                        schemaPath:
                                                                                          '#/properties/controls/items/properties/actor/properties/kind/type',
                                                                                        keyword:
                                                                                          'type',
                                                                                        params: {
                                                                                          type: 'string',
                                                                                        },
                                                                                        message:
                                                                                          'must be string',
                                                                                      },
                                                                                    ];
                                                                                  return false;
                                                                                }
                                                                              }
                                                                              var valid19 =
                                                                                _errs96 === errors;
                                                                            } else {
                                                                              var valid19 = true;
                                                                            }
                                                                            if (valid19) {
                                                                              if (
                                                                                data34.id !== void 0
                                                                              ) {
                                                                                let data36 =
                                                                                  data34.id;
                                                                                const _errs98 =
                                                                                  errors;
                                                                                if (
                                                                                  errors === _errs98
                                                                                ) {
                                                                                  if (
                                                                                    typeof data36 ===
                                                                                    'string'
                                                                                  ) {
                                                                                    if (
                                                                                      func2(
                                                                                        data36,
                                                                                      ) > 100
                                                                                    ) {
                                                                                      validate50.errors =
                                                                                        [
                                                                                          {
                                                                                            instancePath:
                                                                                              instancePath +
                                                                                              '/controls/' +
                                                                                              i2 +
                                                                                              '/actor/id',
                                                                                            schemaPath:
                                                                                              '#/properties/controls/items/properties/actor/properties/id/maxLength',
                                                                                            keyword:
                                                                                              'maxLength',
                                                                                            params:
                                                                                              {
                                                                                                limit: 100,
                                                                                              },
                                                                                            message:
                                                                                              'must NOT have more than 100 characters',
                                                                                          },
                                                                                        ];
                                                                                      return false;
                                                                                    }
                                                                                  } else {
                                                                                    validate50.errors =
                                                                                      [
                                                                                        {
                                                                                          instancePath:
                                                                                            instancePath +
                                                                                            '/controls/' +
                                                                                            i2 +
                                                                                            '/actor/id',
                                                                                          schemaPath:
                                                                                            '#/properties/controls/items/properties/actor/properties/id/type',
                                                                                          keyword:
                                                                                            'type',
                                                                                          params: {
                                                                                            type: 'string',
                                                                                          },
                                                                                          message:
                                                                                            'must be string',
                                                                                        },
                                                                                      ];
                                                                                    return false;
                                                                                  }
                                                                                }
                                                                                var valid19 =
                                                                                  _errs98 ===
                                                                                  errors;
                                                                              } else {
                                                                                var valid19 = true;
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      } else {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/controls/' +
                                                                              i2 +
                                                                              '/actor',
                                                                            schemaPath:
                                                                              '#/properties/controls/items/properties/actor/type',
                                                                            keyword: 'type',
                                                                            params: {
                                                                              type: 'object',
                                                                            },
                                                                            message:
                                                                              'must be object',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                    }
                                                                    var valid15 =
                                                                      _errs93 === errors;
                                                                  } else {
                                                                    var valid15 = true;
                                                                  }
                                                                  if (valid15) {
                                                                    if (
                                                                      data30.createdAt !== void 0
                                                                    ) {
                                                                      let data37 = data30.createdAt;
                                                                      const _errs100 = errors;
                                                                      if (!(
                                                                        typeof data37 == 'number' &&
                                                                        !(data37 % 1) &&
                                                                        !isNaN(data37) &&
                                                                        isFinite(data37)
                                                                      )) {
                                                                        validate50.errors = [
                                                                          {
                                                                            instancePath:
                                                                              instancePath +
                                                                              '/controls/' +
                                                                              i2 +
                                                                              '/createdAt',
                                                                            schemaPath:
                                                                              '#/properties/controls/items/properties/createdAt/type',
                                                                            keyword: 'type',
                                                                            params: {
                                                                              type: 'integer',
                                                                            },
                                                                            message:
                                                                              'must be integer',
                                                                          },
                                                                        ];
                                                                        return false;
                                                                      }
                                                                      if (errors === _errs100) {
                                                                        if (
                                                                          typeof data37 ==
                                                                            'number' &&
                                                                          isFinite(data37)
                                                                        ) {
                                                                          if (
                                                                            data37 < 0 ||
                                                                            isNaN(data37)
                                                                          ) {
                                                                            validate50.errors = [
                                                                              {
                                                                                instancePath:
                                                                                  instancePath +
                                                                                  '/controls/' +
                                                                                  i2 +
                                                                                  '/createdAt',
                                                                                schemaPath:
                                                                                  '#/properties/controls/items/properties/createdAt/minimum',
                                                                                keyword: 'minimum',
                                                                                params: {
                                                                                  comparison: '>=',
                                                                                  limit: 0,
                                                                                },
                                                                                message:
                                                                                  'must be >= 0',
                                                                              },
                                                                            ];
                                                                            return false;
                                                                          }
                                                                        }
                                                                      }
                                                                      var valid15 =
                                                                        _errs100 === errors;
                                                                    } else {
                                                                      var valid15 = true;
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      } else {
                                                        validate50.errors = [
                                                          {
                                                            instancePath:
                                                              instancePath + '/controls/' + i2,
                                                            schemaPath:
                                                              '#/properties/controls/items/type',
                                                            keyword: 'type',
                                                            params: { type: 'object' },
                                                            message: 'must be object',
                                                          },
                                                        ];
                                                        return false;
                                                      }
                                                    }
                                                    var valid14 = _errs79 === errors;
                                                    if (!valid14) {
                                                      break;
                                                    }
                                                  }
                                                }
                                              } else {
                                                validate50.errors = [
                                                  {
                                                    instancePath: instancePath + '/controls',
                                                    schemaPath: '#/properties/controls/type',
                                                    keyword: 'type',
                                                    params: { type: 'array' },
                                                    message: 'must be array',
                                                  },
                                                ];
                                                return false;
                                              }
                                            }
                                            var valid0 = _errs77 === errors;
                                          } else {
                                            var valid0 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate50.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate50.errors = vErrors;
  return errors === 0;
}
validate50.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate123(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate123.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.run === void 0 && (missing0 = 'run'))
      ) {
        validate123.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'run')) {
            validate123.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate123.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate123.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate123.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate123.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate123.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.run !== void 0) {
                const _errs6 = errors;
                if (
                  !validate50(data.run, {
                    instancePath: instancePath + '/run',
                    parentData: data,
                    parentDataProperty: 'run',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate50.errors : vErrors.concat(validate50.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate123.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate123.errors = vErrors;
  return errors === 0;
}
validate123.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateInteractionResponse = validate127;
var schema89 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'runId',
    'executionId',
    'node',
    'kind',
    'state',
    'revision',
    'title',
    'instructions',
    'form',
    'outcomes',
    'expiresAt',
    'createdAt',
    'settledAt',
    'runState',
    'response',
  ],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    runId: { $ref: '#/$defs/Uuid' },
    executionId: { $ref: '#/$defs/Uuid' },
    node: { type: 'string', maxLength: 200 },
    kind: { enum: ['input', 'approval'] },
    state: { enum: ['PENDING', 'RESPONDED', 'EXPIRED', 'CANCELLED'] },
    revision: { type: 'integer', minimum: 0 },
    title: { type: 'string', maxLength: 200 },
    instructions: { type: ['string', 'null'], maxLength: 2e4 },
    form: { type: 'object' },
    outcomes: {
      anyOf: [
        { type: 'null' },
        { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 10 },
      ],
    },
    expiresAt: { type: ['integer', 'null'], minimum: 0 },
    createdAt: { type: 'integer', minimum: 0 },
    settledAt: { type: ['integer', 'null'], minimum: 0 },
    runState: {
      enum: [
        'QUEUED',
        'RUNNING',
        'WAITING',
        'HELD',
        'NEEDS_HUMAN',
        'FAILED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'COMPLETED',
      ],
    },
    response: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'data', 'actor', 'createdAt'],
          properties: {
            decision: { type: ['string', 'null'], maxLength: 40 },
            data: {},
            actor: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'id'],
              properties: {
                kind: { type: 'string', maxLength: 20 },
                id: { type: 'string', maxLength: 100 },
              },
            },
            createdAt: { type: 'integer', minimum: 0 },
          },
        },
      ],
    },
  },
};
function validate54(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.runId === void 0 && (missing0 = 'runId')) ||
        (data.executionId === void 0 && (missing0 = 'executionId')) ||
        (data.node === void 0 && (missing0 = 'node')) ||
        (data.kind === void 0 && (missing0 = 'kind')) ||
        (data.state === void 0 && (missing0 = 'state')) ||
        (data.revision === void 0 && (missing0 = 'revision')) ||
        (data.title === void 0 && (missing0 = 'title')) ||
        (data.instructions === void 0 && (missing0 = 'instructions')) ||
        (data.form === void 0 && (missing0 = 'form')) ||
        (data.outcomes === void 0 && (missing0 = 'outcomes')) ||
        (data.expiresAt === void 0 && (missing0 = 'expiresAt')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.settledAt === void 0 && (missing0 = 'settledAt')) ||
        (data.runState === void 0 && (missing0 = 'runState')) ||
        (data.response === void 0 && (missing0 = 'response'))
      ) {
        validate54.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema89.properties, key0)) {
            validate54.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate54.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate54.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate54.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.runId !== void 0) {
              let data1 = data.runId;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate54.errors = [
                        {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + '/runId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + '/runId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate54.errors = [
                      {
                        instancePath: instancePath + '/runId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.executionId !== void 0) {
                let data2 = data.executionId;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (errors === _errs9) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + '/executionId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func2(data2) < 36) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + '/executionId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!formats0.test(data2)) {
                            validate54.errors = [
                              {
                                instancePath: instancePath + '/executionId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    } else {
                      validate54.errors = [
                        {
                          instancePath: instancePath + '/executionId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.node !== void 0) {
                  let data3 = data.node;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 200) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + '/node',
                            schemaPath: '#/properties/node/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 200 },
                            message: 'must NOT have more than 200 characters',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate54.errors = [
                        {
                          instancePath: instancePath + '/node',
                          schemaPath: '#/properties/node/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs11 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.kind !== void 0) {
                    let data4 = data.kind;
                    const _errs13 = errors;
                    if (!(data4 === 'input' || data4 === 'approval')) {
                      validate54.errors = [
                        {
                          instancePath: instancePath + '/kind',
                          schemaPath: '#/properties/kind/enum',
                          keyword: 'enum',
                          params: { allowedValues: schema89.properties.kind.enum },
                          message: 'must be equal to one of the allowed values',
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.state !== void 0) {
                      let data5 = data.state;
                      const _errs14 = errors;
                      if (!(
                        data5 === 'PENDING' ||
                        data5 === 'RESPONDED' ||
                        data5 === 'EXPIRED' ||
                        data5 === 'CANCELLED'
                      )) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + '/state',
                            schemaPath: '#/properties/state/enum',
                            keyword: 'enum',
                            params: { allowedValues: schema89.properties.state.enum },
                            message: 'must be equal to one of the allowed values',
                          },
                        ];
                        return false;
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.revision !== void 0) {
                        let data6 = data.revision;
                        const _errs15 = errors;
                        if (!(
                          typeof data6 == 'number' &&
                          !(data6 % 1) &&
                          !isNaN(data6) &&
                          isFinite(data6)
                        )) {
                          validate54.errors = [
                            {
                              instancePath: instancePath + '/revision',
                              schemaPath: '#/properties/revision/type',
                              keyword: 'type',
                              params: { type: 'integer' },
                              message: 'must be integer',
                            },
                          ];
                          return false;
                        }
                        if (errors === _errs15) {
                          if (typeof data6 == 'number' && isFinite(data6)) {
                            if (data6 < 0 || isNaN(data6)) {
                              validate54.errors = [
                                {
                                  instancePath: instancePath + '/revision',
                                  schemaPath: '#/properties/revision/minimum',
                                  keyword: 'minimum',
                                  params: { comparison: '>=', limit: 0 },
                                  message: 'must be >= 0',
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid0 = _errs15 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.title !== void 0) {
                          let data7 = data.title;
                          const _errs17 = errors;
                          if (errors === _errs17) {
                            if (typeof data7 === 'string') {
                              if (func2(data7) > 200) {
                                validate54.errors = [
                                  {
                                    instancePath: instancePath + '/title',
                                    schemaPath: '#/properties/title/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 200 },
                                    message: 'must NOT have more than 200 characters',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate54.errors = [
                                {
                                  instancePath: instancePath + '/title',
                                  schemaPath: '#/properties/title/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs17 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.instructions !== void 0) {
                            let data8 = data.instructions;
                            const _errs19 = errors;
                            if (typeof data8 !== 'string' && data8 !== null) {
                              validate54.errors = [
                                {
                                  instancePath: instancePath + '/instructions',
                                  schemaPath: '#/properties/instructions/type',
                                  keyword: 'type',
                                  params: { type: schema89.properties.instructions.type },
                                  message: 'must be string,null',
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs19) {
                              if (typeof data8 === 'string') {
                                if (func2(data8) > 2e4) {
                                  validate54.errors = [
                                    {
                                      instancePath: instancePath + '/instructions',
                                      schemaPath: '#/properties/instructions/maxLength',
                                      keyword: 'maxLength',
                                      params: { limit: 2e4 },
                                      message: 'must NOT have more than 20000 characters',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid0 = _errs19 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.form !== void 0) {
                              let data9 = data.form;
                              const _errs21 = errors;
                              if (!(data9 && typeof data9 == 'object' && !Array.isArray(data9))) {
                                validate54.errors = [
                                  {
                                    instancePath: instancePath + '/form',
                                    schemaPath: '#/properties/form/type',
                                    keyword: 'type',
                                    params: { type: 'object' },
                                    message: 'must be object',
                                  },
                                ];
                                return false;
                              }
                              var valid0 = _errs21 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.outcomes !== void 0) {
                                let data10 = data.outcomes;
                                const _errs23 = errors;
                                const _errs24 = errors;
                                let valid4 = false;
                                const _errs25 = errors;
                                if (data10 !== null) {
                                  const err0 = {
                                    instancePath: instancePath + '/outcomes',
                                    schemaPath: '#/properties/outcomes/anyOf/0/type',
                                    keyword: 'type',
                                    params: { type: 'null' },
                                    message: 'must be null',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err0];
                                  } else {
                                    vErrors.push(err0);
                                  }
                                  errors++;
                                }
                                var _valid0 = _errs25 === errors;
                                valid4 = valid4 || _valid0;
                                const _errs27 = errors;
                                if (errors === _errs27) {
                                  if (Array.isArray(data10)) {
                                    if (data10.length > 10) {
                                      const err1 = {
                                        instancePath: instancePath + '/outcomes',
                                        schemaPath: '#/properties/outcomes/anyOf/1/maxItems',
                                        keyword: 'maxItems',
                                        params: { limit: 10 },
                                        message: 'must NOT have more than 10 items',
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err1];
                                      } else {
                                        vErrors.push(err1);
                                      }
                                      errors++;
                                    } else {
                                      var valid5 = true;
                                      const len0 = data10.length;
                                      for (let i0 = 0; i0 < len0; i0++) {
                                        let data11 = data10[i0];
                                        const _errs29 = errors;
                                        if (errors === _errs29) {
                                          if (typeof data11 === 'string') {
                                            if (func2(data11) > 40) {
                                              const err2 = {
                                                instancePath: instancePath + '/outcomes/' + i0,
                                                schemaPath:
                                                  '#/properties/outcomes/anyOf/1/items/maxLength',
                                                keyword: 'maxLength',
                                                params: { limit: 40 },
                                                message: 'must NOT have more than 40 characters',
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err2];
                                              } else {
                                                vErrors.push(err2);
                                              }
                                              errors++;
                                            }
                                          } else {
                                            const err3 = {
                                              instancePath: instancePath + '/outcomes/' + i0,
                                              schemaPath:
                                                '#/properties/outcomes/anyOf/1/items/type',
                                              keyword: 'type',
                                              params: { type: 'string' },
                                              message: 'must be string',
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err3];
                                            } else {
                                              vErrors.push(err3);
                                            }
                                            errors++;
                                          }
                                        }
                                        var valid5 = _errs29 === errors;
                                        if (!valid5) {
                                          break;
                                        }
                                      }
                                    }
                                  } else {
                                    const err4 = {
                                      instancePath: instancePath + '/outcomes',
                                      schemaPath: '#/properties/outcomes/anyOf/1/type',
                                      keyword: 'type',
                                      params: { type: 'array' },
                                      message: 'must be array',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err4];
                                    } else {
                                      vErrors.push(err4);
                                    }
                                    errors++;
                                  }
                                }
                                var _valid0 = _errs27 === errors;
                                valid4 = valid4 || _valid0;
                                if (!valid4) {
                                  const err5 = {
                                    instancePath: instancePath + '/outcomes',
                                    schemaPath: '#/properties/outcomes/anyOf',
                                    keyword: 'anyOf',
                                    params: {},
                                    message: 'must match a schema in anyOf',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err5];
                                  } else {
                                    vErrors.push(err5);
                                  }
                                  errors++;
                                  validate54.errors = vErrors;
                                  return false;
                                } else {
                                  errors = _errs24;
                                  if (vErrors !== null) {
                                    if (_errs24) {
                                      vErrors.length = _errs24;
                                    } else {
                                      vErrors = null;
                                    }
                                  }
                                }
                                var valid0 = _errs23 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.expiresAt !== void 0) {
                                  let data12 = data.expiresAt;
                                  const _errs31 = errors;
                                  if (
                                    !(
                                      typeof data12 == 'number' &&
                                      !(data12 % 1) &&
                                      !isNaN(data12) &&
                                      isFinite(data12)
                                    ) &&
                                    data12 !== null
                                  ) {
                                    validate54.errors = [
                                      {
                                        instancePath: instancePath + '/expiresAt',
                                        schemaPath: '#/properties/expiresAt/type',
                                        keyword: 'type',
                                        params: { type: schema89.properties.expiresAt.type },
                                        message: 'must be integer,null',
                                      },
                                    ];
                                    return false;
                                  }
                                  if (errors === _errs31) {
                                    if (typeof data12 == 'number' && isFinite(data12)) {
                                      if (data12 < 0 || isNaN(data12)) {
                                        validate54.errors = [
                                          {
                                            instancePath: instancePath + '/expiresAt',
                                            schemaPath: '#/properties/expiresAt/minimum',
                                            keyword: 'minimum',
                                            params: { comparison: '>=', limit: 0 },
                                            message: 'must be >= 0',
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  }
                                  var valid0 = _errs31 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.createdAt !== void 0) {
                                    let data13 = data.createdAt;
                                    const _errs33 = errors;
                                    if (!(
                                      typeof data13 == 'number' &&
                                      !(data13 % 1) &&
                                      !isNaN(data13) &&
                                      isFinite(data13)
                                    )) {
                                      validate54.errors = [
                                        {
                                          instancePath: instancePath + '/createdAt',
                                          schemaPath: '#/properties/createdAt/type',
                                          keyword: 'type',
                                          params: { type: 'integer' },
                                          message: 'must be integer',
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs33) {
                                      if (typeof data13 == 'number' && isFinite(data13)) {
                                        if (data13 < 0 || isNaN(data13)) {
                                          validate54.errors = [
                                            {
                                              instancePath: instancePath + '/createdAt',
                                              schemaPath: '#/properties/createdAt/minimum',
                                              keyword: 'minimum',
                                              params: { comparison: '>=', limit: 0 },
                                              message: 'must be >= 0',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                    }
                                    var valid0 = _errs33 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.settledAt !== void 0) {
                                      let data14 = data.settledAt;
                                      const _errs35 = errors;
                                      if (
                                        !(
                                          typeof data14 == 'number' &&
                                          !(data14 % 1) &&
                                          !isNaN(data14) &&
                                          isFinite(data14)
                                        ) &&
                                        data14 !== null
                                      ) {
                                        validate54.errors = [
                                          {
                                            instancePath: instancePath + '/settledAt',
                                            schemaPath: '#/properties/settledAt/type',
                                            keyword: 'type',
                                            params: { type: schema89.properties.settledAt.type },
                                            message: 'must be integer,null',
                                          },
                                        ];
                                        return false;
                                      }
                                      if (errors === _errs35) {
                                        if (typeof data14 == 'number' && isFinite(data14)) {
                                          if (data14 < 0 || isNaN(data14)) {
                                            validate54.errors = [
                                              {
                                                instancePath: instancePath + '/settledAt',
                                                schemaPath: '#/properties/settledAt/minimum',
                                                keyword: 'minimum',
                                                params: { comparison: '>=', limit: 0 },
                                                message: 'must be >= 0',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                      }
                                      var valid0 = _errs35 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (data.runState !== void 0) {
                                        let data15 = data.runState;
                                        const _errs37 = errors;
                                        if (!(
                                          data15 === 'QUEUED' ||
                                          data15 === 'RUNNING' ||
                                          data15 === 'WAITING' ||
                                          data15 === 'HELD' ||
                                          data15 === 'NEEDS_HUMAN' ||
                                          data15 === 'FAILED' ||
                                          data15 === 'CANCEL_REQUESTED' ||
                                          data15 === 'CANCELLED' ||
                                          data15 === 'COMPLETED'
                                        )) {
                                          validate54.errors = [
                                            {
                                              instancePath: instancePath + '/runState',
                                              schemaPath: '#/properties/runState/enum',
                                              keyword: 'enum',
                                              params: {
                                                allowedValues: schema89.properties.runState.enum,
                                              },
                                              message: 'must be equal to one of the allowed values',
                                            },
                                          ];
                                          return false;
                                        }
                                        var valid0 = _errs37 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (data.response !== void 0) {
                                          let data16 = data.response;
                                          const _errs38 = errors;
                                          const _errs39 = errors;
                                          let valid6 = false;
                                          const _errs40 = errors;
                                          if (data16 !== null) {
                                            const err6 = {
                                              instancePath: instancePath + '/response',
                                              schemaPath: '#/properties/response/anyOf/0/type',
                                              keyword: 'type',
                                              params: { type: 'null' },
                                              message: 'must be null',
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err6];
                                            } else {
                                              vErrors.push(err6);
                                            }
                                            errors++;
                                          }
                                          var _valid1 = _errs40 === errors;
                                          valid6 = valid6 || _valid1;
                                          const _errs42 = errors;
                                          if (errors === _errs42) {
                                            if (
                                              data16 &&
                                              typeof data16 == 'object' &&
                                              !Array.isArray(data16)
                                            ) {
                                              let missing1;
                                              if (
                                                (data16.decision === void 0 &&
                                                  (missing1 = 'decision')) ||
                                                (data16.data === void 0 && (missing1 = 'data')) ||
                                                (data16.actor === void 0 && (missing1 = 'actor')) ||
                                                (data16.createdAt === void 0 &&
                                                  (missing1 = 'createdAt'))
                                              ) {
                                                const err7 = {
                                                  instancePath: instancePath + '/response',
                                                  schemaPath:
                                                    '#/properties/response/anyOf/1/required',
                                                  keyword: 'required',
                                                  params: { missingProperty: missing1 },
                                                  message:
                                                    "must have required property '" +
                                                    missing1 +
                                                    "'",
                                                };
                                                if (vErrors === null) {
                                                  vErrors = [err7];
                                                } else {
                                                  vErrors.push(err7);
                                                }
                                                errors++;
                                              } else {
                                                const _errs44 = errors;
                                                for (const key1 in data16) {
                                                  if (!(
                                                    key1 === 'decision' ||
                                                    key1 === 'data' ||
                                                    key1 === 'actor' ||
                                                    key1 === 'createdAt'
                                                  )) {
                                                    const err8 = {
                                                      instancePath: instancePath + '/response',
                                                      schemaPath:
                                                        '#/properties/response/anyOf/1/additionalProperties',
                                                      keyword: 'additionalProperties',
                                                      params: { additionalProperty: key1 },
                                                      message:
                                                        'must NOT have additional properties',
                                                    };
                                                    if (vErrors === null) {
                                                      vErrors = [err8];
                                                    } else {
                                                      vErrors.push(err8);
                                                    }
                                                    errors++;
                                                    break;
                                                  }
                                                }
                                                if (_errs44 === errors) {
                                                  if (data16.decision !== void 0) {
                                                    let data17 = data16.decision;
                                                    const _errs45 = errors;
                                                    if (
                                                      typeof data17 !== 'string' &&
                                                      data17 !== null
                                                    ) {
                                                      const err9 = {
                                                        instancePath:
                                                          instancePath + '/response/decision',
                                                        schemaPath:
                                                          '#/properties/response/anyOf/1/properties/decision/type',
                                                        keyword: 'type',
                                                        params: {
                                                          type: schema89.properties.response
                                                            .anyOf[1].properties.decision.type,
                                                        },
                                                        message: 'must be string,null',
                                                      };
                                                      if (vErrors === null) {
                                                        vErrors = [err9];
                                                      } else {
                                                        vErrors.push(err9);
                                                      }
                                                      errors++;
                                                    }
                                                    if (errors === _errs45) {
                                                      if (typeof data17 === 'string') {
                                                        if (func2(data17) > 40) {
                                                          const err10 = {
                                                            instancePath:
                                                              instancePath + '/response/decision',
                                                            schemaPath:
                                                              '#/properties/response/anyOf/1/properties/decision/maxLength',
                                                            keyword: 'maxLength',
                                                            params: { limit: 40 },
                                                            message:
                                                              'must NOT have more than 40 characters',
                                                          };
                                                          if (vErrors === null) {
                                                            vErrors = [err10];
                                                          } else {
                                                            vErrors.push(err10);
                                                          }
                                                          errors++;
                                                        }
                                                      }
                                                    }
                                                    var valid7 = _errs45 === errors;
                                                  } else {
                                                    var valid7 = true;
                                                  }
                                                  if (valid7) {
                                                    if (data16.actor !== void 0) {
                                                      let data18 = data16.actor;
                                                      const _errs47 = errors;
                                                      if (errors === _errs47) {
                                                        if (
                                                          data18 &&
                                                          typeof data18 == 'object' &&
                                                          !Array.isArray(data18)
                                                        ) {
                                                          let missing2;
                                                          if (
                                                            (data18.kind === void 0 &&
                                                              (missing2 = 'kind')) ||
                                                            (data18.id === void 0 &&
                                                              (missing2 = 'id'))
                                                          ) {
                                                            const err11 = {
                                                              instancePath:
                                                                instancePath + '/response/actor',
                                                              schemaPath:
                                                                '#/properties/response/anyOf/1/properties/actor/required',
                                                              keyword: 'required',
                                                              params: { missingProperty: missing2 },
                                                              message:
                                                                "must have required property '" +
                                                                missing2 +
                                                                "'",
                                                            };
                                                            if (vErrors === null) {
                                                              vErrors = [err11];
                                                            } else {
                                                              vErrors.push(err11);
                                                            }
                                                            errors++;
                                                          } else {
                                                            const _errs49 = errors;
                                                            for (const key2 in data18) {
                                                              if (!(
                                                                key2 === 'kind' || key2 === 'id'
                                                              )) {
                                                                const err12 = {
                                                                  instancePath:
                                                                    instancePath +
                                                                    '/response/actor',
                                                                  schemaPath:
                                                                    '#/properties/response/anyOf/1/properties/actor/additionalProperties',
                                                                  keyword: 'additionalProperties',
                                                                  params: {
                                                                    additionalProperty: key2,
                                                                  },
                                                                  message:
                                                                    'must NOT have additional properties',
                                                                };
                                                                if (vErrors === null) {
                                                                  vErrors = [err12];
                                                                } else {
                                                                  vErrors.push(err12);
                                                                }
                                                                errors++;
                                                                break;
                                                              }
                                                            }
                                                            if (_errs49 === errors) {
                                                              if (data18.kind !== void 0) {
                                                                let data19 = data18.kind;
                                                                const _errs50 = errors;
                                                                if (errors === _errs50) {
                                                                  if (typeof data19 === 'string') {
                                                                    if (func2(data19) > 20) {
                                                                      const err13 = {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/response/actor/kind',
                                                                        schemaPath:
                                                                          '#/properties/response/anyOf/1/properties/actor/properties/kind/maxLength',
                                                                        keyword: 'maxLength',
                                                                        params: { limit: 20 },
                                                                        message:
                                                                          'must NOT have more than 20 characters',
                                                                      };
                                                                      if (vErrors === null) {
                                                                        vErrors = [err13];
                                                                      } else {
                                                                        vErrors.push(err13);
                                                                      }
                                                                      errors++;
                                                                    }
                                                                  } else {
                                                                    const err14 = {
                                                                      instancePath:
                                                                        instancePath +
                                                                        '/response/actor/kind',
                                                                      schemaPath:
                                                                        '#/properties/response/anyOf/1/properties/actor/properties/kind/type',
                                                                      keyword: 'type',
                                                                      params: { type: 'string' },
                                                                      message: 'must be string',
                                                                    };
                                                                    if (vErrors === null) {
                                                                      vErrors = [err14];
                                                                    } else {
                                                                      vErrors.push(err14);
                                                                    }
                                                                    errors++;
                                                                  }
                                                                }
                                                                var valid8 = _errs50 === errors;
                                                              } else {
                                                                var valid8 = true;
                                                              }
                                                              if (valid8) {
                                                                if (data18.id !== void 0) {
                                                                  let data20 = data18.id;
                                                                  const _errs52 = errors;
                                                                  if (errors === _errs52) {
                                                                    if (
                                                                      typeof data20 === 'string'
                                                                    ) {
                                                                      if (func2(data20) > 100) {
                                                                        const err15 = {
                                                                          instancePath:
                                                                            instancePath +
                                                                            '/response/actor/id',
                                                                          schemaPath:
                                                                            '#/properties/response/anyOf/1/properties/actor/properties/id/maxLength',
                                                                          keyword: 'maxLength',
                                                                          params: { limit: 100 },
                                                                          message:
                                                                            'must NOT have more than 100 characters',
                                                                        };
                                                                        if (vErrors === null) {
                                                                          vErrors = [err15];
                                                                        } else {
                                                                          vErrors.push(err15);
                                                                        }
                                                                        errors++;
                                                                      }
                                                                    } else {
                                                                      const err16 = {
                                                                        instancePath:
                                                                          instancePath +
                                                                          '/response/actor/id',
                                                                        schemaPath:
                                                                          '#/properties/response/anyOf/1/properties/actor/properties/id/type',
                                                                        keyword: 'type',
                                                                        params: { type: 'string' },
                                                                        message: 'must be string',
                                                                      };
                                                                      if (vErrors === null) {
                                                                        vErrors = [err16];
                                                                      } else {
                                                                        vErrors.push(err16);
                                                                      }
                                                                      errors++;
                                                                    }
                                                                  }
                                                                  var valid8 = _errs52 === errors;
                                                                } else {
                                                                  var valid8 = true;
                                                                }
                                                              }
                                                            }
                                                          }
                                                        } else {
                                                          const err17 = {
                                                            instancePath:
                                                              instancePath + '/response/actor',
                                                            schemaPath:
                                                              '#/properties/response/anyOf/1/properties/actor/type',
                                                            keyword: 'type',
                                                            params: { type: 'object' },
                                                            message: 'must be object',
                                                          };
                                                          if (vErrors === null) {
                                                            vErrors = [err17];
                                                          } else {
                                                            vErrors.push(err17);
                                                          }
                                                          errors++;
                                                        }
                                                      }
                                                      var valid7 = _errs47 === errors;
                                                    } else {
                                                      var valid7 = true;
                                                    }
                                                    if (valid7) {
                                                      if (data16.createdAt !== void 0) {
                                                        let data21 = data16.createdAt;
                                                        const _errs54 = errors;
                                                        if (!(
                                                          typeof data21 == 'number' &&
                                                          !(data21 % 1) &&
                                                          !isNaN(data21) &&
                                                          isFinite(data21)
                                                        )) {
                                                          const err18 = {
                                                            instancePath:
                                                              instancePath + '/response/createdAt',
                                                            schemaPath:
                                                              '#/properties/response/anyOf/1/properties/createdAt/type',
                                                            keyword: 'type',
                                                            params: { type: 'integer' },
                                                            message: 'must be integer',
                                                          };
                                                          if (vErrors === null) {
                                                            vErrors = [err18];
                                                          } else {
                                                            vErrors.push(err18);
                                                          }
                                                          errors++;
                                                        }
                                                        if (errors === _errs54) {
                                                          if (
                                                            typeof data21 == 'number' &&
                                                            isFinite(data21)
                                                          ) {
                                                            if (data21 < 0 || isNaN(data21)) {
                                                              const err19 = {
                                                                instancePath:
                                                                  instancePath +
                                                                  '/response/createdAt',
                                                                schemaPath:
                                                                  '#/properties/response/anyOf/1/properties/createdAt/minimum',
                                                                keyword: 'minimum',
                                                                params: {
                                                                  comparison: '>=',
                                                                  limit: 0,
                                                                },
                                                                message: 'must be >= 0',
                                                              };
                                                              if (vErrors === null) {
                                                                vErrors = [err19];
                                                              } else {
                                                                vErrors.push(err19);
                                                              }
                                                              errors++;
                                                            }
                                                          }
                                                        }
                                                        var valid7 = _errs54 === errors;
                                                      } else {
                                                        var valid7 = true;
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            } else {
                                              const err20 = {
                                                instancePath: instancePath + '/response',
                                                schemaPath: '#/properties/response/anyOf/1/type',
                                                keyword: 'type',
                                                params: { type: 'object' },
                                                message: 'must be object',
                                              };
                                              if (vErrors === null) {
                                                vErrors = [err20];
                                              } else {
                                                vErrors.push(err20);
                                              }
                                              errors++;
                                            }
                                          }
                                          var _valid1 = _errs42 === errors;
                                          valid6 = valid6 || _valid1;
                                          if (!valid6) {
                                            const err21 = {
                                              instancePath: instancePath + '/response',
                                              schemaPath: '#/properties/response/anyOf',
                                              keyword: 'anyOf',
                                              params: {},
                                              message: 'must match a schema in anyOf',
                                            };
                                            if (vErrors === null) {
                                              vErrors = [err21];
                                            } else {
                                              vErrors.push(err21);
                                            }
                                            errors++;
                                            validate54.errors = vErrors;
                                            return false;
                                          } else {
                                            errors = _errs39;
                                            if (vErrors !== null) {
                                              if (_errs39) {
                                                vErrors.length = _errs39;
                                              } else {
                                                vErrors = null;
                                              }
                                            }
                                          }
                                          var valid0 = _errs38 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate54.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate127(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate127.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.interaction === void 0 && (missing0 = 'interaction'))
      ) {
        validate127.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'interaction')) {
            validate127.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate127.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate127.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate127.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate127.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate127.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.interaction !== void 0) {
                const _errs6 = errors;
                if (
                  !validate54(data.interaction, {
                    instancePath: instancePath + '/interaction',
                    parentData: data,
                    parentDataProperty: 'interaction',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate127.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate127.errors = vErrors;
  return errors === 0;
}
validate127.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateWorkspaceResponse = validate142;
var schema93 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'projectId',
    'runId',
    'path',
    'repositoryPath',
    'baseRef',
    'baseCommit',
    'state',
    'createdAt',
    'readyAt',
    'retiredAt',
    'claimed',
  ],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    projectId: { $ref: '#/$defs/Uuid' },
    runId: { $ref: '#/$defs/Uuid' },
    path: { type: 'string', maxLength: 4096 },
    repositoryPath: { type: 'string', maxLength: 4096 },
    baseRef: { type: 'string', maxLength: 256 },
    baseCommit: { type: 'string', pattern: '^[0-9a-f]{40,64}$' },
    state: { enum: ['CREATING', 'READY', 'RETIRED'] },
    createdAt: { type: 'integer', minimum: 0 },
    readyAt: { type: ['integer', 'null'], minimum: 0 },
    retiredAt: { type: ['integer', 'null'], minimum: 0 },
    claimed: { type: 'boolean' },
  },
};
var pattern11 = new RegExp('^[0-9a-f]{40,64}$', 'u');
function validate56(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate56.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.projectId === void 0 && (missing0 = 'projectId')) ||
        (data.runId === void 0 && (missing0 = 'runId')) ||
        (data.path === void 0 && (missing0 = 'path')) ||
        (data.repositoryPath === void 0 && (missing0 = 'repositoryPath')) ||
        (data.baseRef === void 0 && (missing0 = 'baseRef')) ||
        (data.baseCommit === void 0 && (missing0 = 'baseCommit')) ||
        (data.state === void 0 && (missing0 = 'state')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.readyAt === void 0 && (missing0 = 'readyAt')) ||
        (data.retiredAt === void 0 && (missing0 = 'retiredAt')) ||
        (data.claimed === void 0 && (missing0 = 'claimed'))
      ) {
        validate56.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema93.properties, key0)) {
            validate56.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate56.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate56.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate56.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate56.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.projectId !== void 0) {
              let data1 = data.projectId;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate56.errors = [
                        {
                          instancePath: instancePath + '/projectId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate56.errors = [
                          {
                            instancePath: instancePath + '/projectId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate56.errors = [
                            {
                              instancePath: instancePath + '/projectId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate56.errors = [
                      {
                        instancePath: instancePath + '/projectId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.runId !== void 0) {
                let data2 = data.runId;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (errors === _errs9) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        validate56.errors = [
                          {
                            instancePath: instancePath + '/runId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func2(data2) < 36) {
                          validate56.errors = [
                            {
                              instancePath: instancePath + '/runId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!formats0.test(data2)) {
                            validate56.errors = [
                              {
                                instancePath: instancePath + '/runId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              },
                            ];
                            return false;
                          }
                        }
                      }
                    } else {
                      validate56.errors = [
                        {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.path !== void 0) {
                  let data3 = data.path;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 4096) {
                        validate56.errors = [
                          {
                            instancePath: instancePath + '/path',
                            schemaPath: '#/properties/path/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 4096 },
                            message: 'must NOT have more than 4096 characters',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate56.errors = [
                        {
                          instancePath: instancePath + '/path',
                          schemaPath: '#/properties/path/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs11 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.repositoryPath !== void 0) {
                    let data4 = data.repositoryPath;
                    const _errs13 = errors;
                    if (errors === _errs13) {
                      if (typeof data4 === 'string') {
                        if (func2(data4) > 4096) {
                          validate56.errors = [
                            {
                              instancePath: instancePath + '/repositoryPath',
                              schemaPath: '#/properties/repositoryPath/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 4096 },
                              message: 'must NOT have more than 4096 characters',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate56.errors = [
                          {
                            instancePath: instancePath + '/repositoryPath',
                            schemaPath: '#/properties/repositoryPath/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.baseRef !== void 0) {
                      let data5 = data.baseRef;
                      const _errs15 = errors;
                      if (errors === _errs15) {
                        if (typeof data5 === 'string') {
                          if (func2(data5) > 256) {
                            validate56.errors = [
                              {
                                instancePath: instancePath + '/baseRef',
                                schemaPath: '#/properties/baseRef/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 256 },
                                message: 'must NOT have more than 256 characters',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate56.errors = [
                            {
                              instancePath: instancePath + '/baseRef',
                              schemaPath: '#/properties/baseRef/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs15 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.baseCommit !== void 0) {
                        let data6 = data.baseCommit;
                        const _errs17 = errors;
                        if (errors === _errs17) {
                          if (typeof data6 === 'string') {
                            if (!pattern11.test(data6)) {
                              validate56.errors = [
                                {
                                  instancePath: instancePath + '/baseCommit',
                                  schemaPath: '#/properties/baseCommit/pattern',
                                  keyword: 'pattern',
                                  params: { pattern: '^[0-9a-f]{40,64}$' },
                                  message: 'must match pattern "^[0-9a-f]{40,64}$"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate56.errors = [
                              {
                                instancePath: instancePath + '/baseCommit',
                                schemaPath: '#/properties/baseCommit/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs17 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.state !== void 0) {
                          let data7 = data.state;
                          const _errs19 = errors;
                          if (!(data7 === 'CREATING' || data7 === 'READY' || data7 === 'RETIRED')) {
                            validate56.errors = [
                              {
                                instancePath: instancePath + '/state',
                                schemaPath: '#/properties/state/enum',
                                keyword: 'enum',
                                params: { allowedValues: schema93.properties.state.enum },
                                message: 'must be equal to one of the allowed values',
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs19 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.createdAt !== void 0) {
                            let data8 = data.createdAt;
                            const _errs20 = errors;
                            if (!(
                              typeof data8 == 'number' &&
                              !(data8 % 1) &&
                              !isNaN(data8) &&
                              isFinite(data8)
                            )) {
                              validate56.errors = [
                                {
                                  instancePath: instancePath + '/createdAt',
                                  schemaPath: '#/properties/createdAt/type',
                                  keyword: 'type',
                                  params: { type: 'integer' },
                                  message: 'must be integer',
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs20) {
                              if (typeof data8 == 'number' && isFinite(data8)) {
                                if (data8 < 0 || isNaN(data8)) {
                                  validate56.errors = [
                                    {
                                      instancePath: instancePath + '/createdAt',
                                      schemaPath: '#/properties/createdAt/minimum',
                                      keyword: 'minimum',
                                      params: { comparison: '>=', limit: 0 },
                                      message: 'must be >= 0',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid0 = _errs20 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.readyAt !== void 0) {
                              let data9 = data.readyAt;
                              const _errs22 = errors;
                              if (
                                !(
                                  typeof data9 == 'number' &&
                                  !(data9 % 1) &&
                                  !isNaN(data9) &&
                                  isFinite(data9)
                                ) &&
                                data9 !== null
                              ) {
                                validate56.errors = [
                                  {
                                    instancePath: instancePath + '/readyAt',
                                    schemaPath: '#/properties/readyAt/type',
                                    keyword: 'type',
                                    params: { type: schema93.properties.readyAt.type },
                                    message: 'must be integer,null',
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs22) {
                                if (typeof data9 == 'number' && isFinite(data9)) {
                                  if (data9 < 0 || isNaN(data9)) {
                                    validate56.errors = [
                                      {
                                        instancePath: instancePath + '/readyAt',
                                        schemaPath: '#/properties/readyAt/minimum',
                                        keyword: 'minimum',
                                        params: { comparison: '>=', limit: 0 },
                                        message: 'must be >= 0',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                              var valid0 = _errs22 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.retiredAt !== void 0) {
                                let data10 = data.retiredAt;
                                const _errs24 = errors;
                                if (
                                  !(
                                    typeof data10 == 'number' &&
                                    !(data10 % 1) &&
                                    !isNaN(data10) &&
                                    isFinite(data10)
                                  ) &&
                                  data10 !== null
                                ) {
                                  validate56.errors = [
                                    {
                                      instancePath: instancePath + '/retiredAt',
                                      schemaPath: '#/properties/retiredAt/type',
                                      keyword: 'type',
                                      params: { type: schema93.properties.retiredAt.type },
                                      message: 'must be integer,null',
                                    },
                                  ];
                                  return false;
                                }
                                if (errors === _errs24) {
                                  if (typeof data10 == 'number' && isFinite(data10)) {
                                    if (data10 < 0 || isNaN(data10)) {
                                      validate56.errors = [
                                        {
                                          instancePath: instancePath + '/retiredAt',
                                          schemaPath: '#/properties/retiredAt/minimum',
                                          keyword: 'minimum',
                                          params: { comparison: '>=', limit: 0 },
                                          message: 'must be >= 0',
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                }
                                var valid0 = _errs24 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.claimed !== void 0) {
                                  const _errs26 = errors;
                                  if (typeof data.claimed !== 'boolean') {
                                    validate56.errors = [
                                      {
                                        instancePath: instancePath + '/claimed',
                                        schemaPath: '#/properties/claimed/type',
                                        keyword: 'type',
                                        params: { type: 'boolean' },
                                        message: 'must be boolean',
                                      },
                                    ];
                                    return false;
                                  }
                                  var valid0 = _errs26 === errors;
                                } else {
                                  var valid0 = true;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate56.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate56.errors = vErrors;
  return errors === 0;
}
validate56.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate142(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate142.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.workspace === void 0 && (missing0 = 'workspace'))
      ) {
        validate142.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'workspace')) {
            validate142.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate142.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate142.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate142.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate142.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate142.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workspace !== void 0) {
                const _errs6 = errors;
                if (
                  !validate56(data.workspace, {
                    instancePath: instancePath + '/workspace',
                    parentData: data,
                    parentDataProperty: 'workspace',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate142.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate142.errors = vErrors;
  return errors === 0;
}
validate142.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateCommandReceiptResponse = validate129;
function validate58(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate58.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.commandId === void 0 && (missing0 = 'commandId')) ||
        (data.status === void 0 && (missing0 = 'status')) ||
        (data.body === void 0 && (missing0 = 'body')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt'))
      ) {
        validate58.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'commandId' ||
            key0 === 'status' ||
            key0 === 'body' ||
            key0 === 'createdAt'
          )) {
            validate58.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.commandId !== void 0) {
            let data0 = data.commandId;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (!pattern7.test(data0)) {
                  validate58.errors = [
                    {
                      instancePath: instancePath + '/commandId',
                      schemaPath: '#/$defs/CommandId/pattern',
                      keyword: 'pattern',
                      params: { pattern: '^[A-Za-z0-9_-]{8,100}$' },
                      message: 'must match pattern "^[A-Za-z0-9_-]{8,100}$"',
                    },
                  ];
                  return false;
                }
              } else {
                validate58.errors = [
                  {
                    instancePath: instancePath + '/commandId',
                    schemaPath: '#/$defs/CommandId/type',
                    keyword: 'type',
                    params: { type: 'string' },
                    message: 'must be string',
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.status !== void 0) {
              let data1 = data.status;
              const _errs5 = errors;
              if (!(typeof data1 == 'number' && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
                validate58.errors = [
                  {
                    instancePath: instancePath + '/status',
                    schemaPath: '#/properties/status/type',
                    keyword: 'type',
                    params: { type: 'integer' },
                    message: 'must be integer',
                  },
                ];
                return false;
              }
              if (errors === _errs5) {
                if (typeof data1 == 'number' && isFinite(data1)) {
                  if (data1 > 299 || isNaN(data1)) {
                    validate58.errors = [
                      {
                        instancePath: instancePath + '/status',
                        schemaPath: '#/properties/status/maximum',
                        keyword: 'maximum',
                        params: { comparison: '<=', limit: 299 },
                        message: 'must be <= 299',
                      },
                    ];
                    return false;
                  } else {
                    if (data1 < 200 || isNaN(data1)) {
                      validate58.errors = [
                        {
                          instancePath: instancePath + '/status',
                          schemaPath: '#/properties/status/minimum',
                          keyword: 'minimum',
                          params: { comparison: '>=', limit: 200 },
                          message: 'must be >= 200',
                        },
                      ];
                      return false;
                    }
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.body !== void 0) {
                let data2 = data.body;
                const _errs7 = errors;
                if (!(data2 && typeof data2 == 'object' && !Array.isArray(data2))) {
                  validate58.errors = [
                    {
                      instancePath: instancePath + '/body',
                      schemaPath: '#/properties/body/type',
                      keyword: 'type',
                      params: { type: 'object' },
                      message: 'must be object',
                    },
                  ];
                  return false;
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.createdAt !== void 0) {
                  let data3 = data.createdAt;
                  const _errs9 = errors;
                  if (!(
                    typeof data3 == 'number' &&
                    !(data3 % 1) &&
                    !isNaN(data3) &&
                    isFinite(data3)
                  )) {
                    validate58.errors = [
                      {
                        instancePath: instancePath + '/createdAt',
                        schemaPath: '#/properties/createdAt/type',
                        keyword: 'type',
                        params: { type: 'integer' },
                        message: 'must be integer',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs9) {
                    if (typeof data3 == 'number' && isFinite(data3)) {
                      if (data3 < 0 || isNaN(data3)) {
                        validate58.errors = [
                          {
                            instancePath: instancePath + '/createdAt',
                            schemaPath: '#/properties/createdAt/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 0 },
                            message: 'must be >= 0',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate58.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate58.errors = vErrors;
  return errors === 0;
}
validate58.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate129(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate129.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.receipt === void 0 && (missing0 = 'receipt'))
      ) {
        validate129.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'receipt')) {
            validate129.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate129.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate129.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate129.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate129.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate129.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.receipt !== void 0) {
                const _errs6 = errors;
                if (
                  !validate58(data.receipt, {
                    instancePath: instancePath + '/receipt',
                    parentData: data,
                    parentDataProperty: 'receipt',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate129.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate129.errors = vErrors;
  return errors === 0;
}
validate129.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateProjectList = validate144;
function validate144(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate144.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.projects === void 0 && (missing0 = 'projects'))
      ) {
        validate144.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'projects')) {
            validate144.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate144.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate144.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate144.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate144.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate144.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.projects !== void 0) {
                let data2 = data.projects;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate144.errors = [
                        {
                          instancePath: instancePath + '/projects',
                          schemaPath: '#/properties/projects/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate46(data2[i0], {
                            instancePath: instancePath + '/projects/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate46.errors
                              : vErrors.concat(validate46.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate144.errors = [
                      {
                        instancePath: instancePath + '/projects',
                        schemaPath: '#/properties/projects/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate144.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate144.errors = vErrors;
  return errors === 0;
}
validate144.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateWorkflowList = validate146;
function validate82(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate82.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.projectId === void 0 && (missing0 = 'projectId')) ||
        (data.name === void 0 && (missing0 = 'name')) ||
        (data.activeVersionId === void 0 && (missing0 = 'activeVersionId'))
      ) {
        validate82.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'id' ||
            key0 === 'projectId' ||
            key0 === 'name' ||
            key0 === 'activeVersionId'
          )) {
            validate82.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate82.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate82.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate82.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate82.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.projectId !== void 0) {
              let data1 = data.projectId;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate82.errors = [
                        {
                          instancePath: instancePath + '/projectId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate82.errors = [
                          {
                            instancePath: instancePath + '/projectId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate82.errors = [
                            {
                              instancePath: instancePath + '/projectId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate82.errors = [
                      {
                        instancePath: instancePath + '/projectId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.name !== void 0) {
                let data2 = data.name;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === 'string') {
                    if (func2(data2) > 200) {
                      validate82.errors = [
                        {
                          instancePath: instancePath + '/name',
                          schemaPath: '#/properties/name/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 200 },
                          message: 'must NOT have more than 200 characters',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate82.errors = [
                      {
                        instancePath: instancePath + '/name',
                        schemaPath: '#/properties/name/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.activeVersionId !== void 0) {
                  let data3 = data.activeVersionId;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  let valid3 = false;
                  const _errs12 = errors;
                  const _errs13 = errors;
                  if (errors === _errs13) {
                    if (errors === _errs13) {
                      if (typeof data3 === 'string') {
                        if (func2(data3) > 36) {
                          const err0 = {
                            instancePath: instancePath + '/activeVersionId',
                            schemaPath: '#/$defs/Uuid/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 36 },
                            message: 'must NOT have more than 36 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err0];
                          } else {
                            vErrors.push(err0);
                          }
                          errors++;
                        } else {
                          if (func2(data3) < 36) {
                            const err1 = {
                              instancePath: instancePath + '/activeVersionId',
                              schemaPath: '#/$defs/Uuid/minLength',
                              keyword: 'minLength',
                              params: { limit: 36 },
                              message: 'must NOT have fewer than 36 characters',
                            };
                            if (vErrors === null) {
                              vErrors = [err1];
                            } else {
                              vErrors.push(err1);
                            }
                            errors++;
                          } else {
                            if (!formats0.test(data3)) {
                              const err2 = {
                                instancePath: instancePath + '/activeVersionId',
                                schemaPath: '#/$defs/Uuid/format',
                                keyword: 'format',
                                params: { format: 'uuid' },
                                message: 'must match format "uuid"',
                              };
                              if (vErrors === null) {
                                vErrors = [err2];
                              } else {
                                vErrors.push(err2);
                              }
                              errors++;
                            }
                          }
                        }
                      } else {
                        const err3 = {
                          instancePath: instancePath + '/activeVersionId',
                          schemaPath: '#/$defs/Uuid/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        };
                        if (vErrors === null) {
                          vErrors = [err3];
                        } else {
                          vErrors.push(err3);
                        }
                        errors++;
                      }
                    }
                  }
                  var _valid0 = _errs12 === errors;
                  valid3 = valid3 || _valid0;
                  const _errs15 = errors;
                  if (data3 !== null) {
                    const err4 = {
                      instancePath: instancePath + '/activeVersionId',
                      schemaPath: '#/properties/activeVersionId/anyOf/1/type',
                      keyword: 'type',
                      params: { type: 'null' },
                      message: 'must be null',
                    };
                    if (vErrors === null) {
                      vErrors = [err4];
                    } else {
                      vErrors.push(err4);
                    }
                    errors++;
                  }
                  var _valid0 = _errs15 === errors;
                  valid3 = valid3 || _valid0;
                  if (!valid3) {
                    const err5 = {
                      instancePath: instancePath + '/activeVersionId',
                      schemaPath: '#/properties/activeVersionId/anyOf',
                      keyword: 'anyOf',
                      params: {},
                      message: 'must match a schema in anyOf',
                    };
                    if (vErrors === null) {
                      vErrors = [err5];
                    } else {
                      vErrors.push(err5);
                    }
                    errors++;
                    validate82.errors = vErrors;
                    return false;
                  } else {
                    errors = _errs11;
                    if (vErrors !== null) {
                      if (_errs11) {
                        vErrors.length = _errs11;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate82.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate82.errors = vErrors;
  return errors === 0;
}
validate82.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate146(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate146.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.workflows === void 0 && (missing0 = 'workflows'))
      ) {
        validate146.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'workflows')) {
            validate146.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate146.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate146.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate146.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate146.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate146.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workflows !== void 0) {
                let data2 = data.workflows;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate146.errors = [
                        {
                          instancePath: instancePath + '/workflows',
                          schemaPath: '#/properties/workflows/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate82(data2[i0], {
                            instancePath: instancePath + '/workflows/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate82.errors
                              : vErrors.concat(validate82.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate146.errors = [
                      {
                        instancePath: instancePath + '/workflows',
                        schemaPath: '#/properties/workflows/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate146.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate146.errors = vErrors;
  return errors === 0;
}
validate146.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateRunList = validate148;
var schema121 = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'state', 'workflowId', 'createdAt', 'finishedAt'],
  properties: {
    id: { $ref: '#/$defs/Uuid' },
    state: {
      enum: [
        'QUEUED',
        'RUNNING',
        'WAITING',
        'HELD',
        'NEEDS_HUMAN',
        'FAILED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'COMPLETED',
      ],
    },
    workflowId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    createdAt: { type: 'integer', minimum: 0 },
    finishedAt: { type: ['integer', 'null'], minimum: 0 },
  },
};
function validate86(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate86.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.id === void 0 && (missing0 = 'id')) ||
        (data.state === void 0 && (missing0 = 'state')) ||
        (data.workflowId === void 0 && (missing0 = 'workflowId')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt')) ||
        (data.finishedAt === void 0 && (missing0 = 'finishedAt'))
      ) {
        validate86.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'id' ||
            key0 === 'state' ||
            key0 === 'workflowId' ||
            key0 === 'createdAt' ||
            key0 === 'finishedAt'
          )) {
            validate86.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === 'string') {
                  if (func2(data0) > 36) {
                    validate86.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/Uuid/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 36 },
                        message: 'must NOT have more than 36 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func2(data0) < 36) {
                      validate86.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/$defs/Uuid/minLength',
                          keyword: 'minLength',
                          params: { limit: 36 },
                          message: 'must NOT have fewer than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!formats0.test(data0)) {
                        validate86.errors = [
                          {
                            instancePath: instancePath + '/id',
                            schemaPath: '#/$defs/Uuid/format',
                            keyword: 'format',
                            params: { format: 'uuid' },
                            message: 'must match format "uuid"',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                } else {
                  validate86.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/Uuid/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.state !== void 0) {
              let data1 = data.state;
              const _errs5 = errors;
              if (!(
                data1 === 'QUEUED' ||
                data1 === 'RUNNING' ||
                data1 === 'WAITING' ||
                data1 === 'HELD' ||
                data1 === 'NEEDS_HUMAN' ||
                data1 === 'FAILED' ||
                data1 === 'CANCEL_REQUESTED' ||
                data1 === 'CANCELLED' ||
                data1 === 'COMPLETED'
              )) {
                validate86.errors = [
                  {
                    instancePath: instancePath + '/state',
                    schemaPath: '#/properties/state/enum',
                    keyword: 'enum',
                    params: { allowedValues: schema121.properties.state.enum },
                    message: 'must be equal to one of the allowed values',
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workflowId !== void 0) {
                let data2 = data.workflowId;
                const _errs6 = errors;
                const _errs7 = errors;
                let valid2 = false;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (errors === _errs9) {
                    if (typeof data2 === 'string') {
                      if (func2(data2) > 36) {
                        const err0 = {
                          instancePath: instancePath + '/workflowId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        };
                        if (vErrors === null) {
                          vErrors = [err0];
                        } else {
                          vErrors.push(err0);
                        }
                        errors++;
                      } else {
                        if (func2(data2) < 36) {
                          const err1 = {
                            instancePath: instancePath + '/workflowId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err1];
                          } else {
                            vErrors.push(err1);
                          }
                          errors++;
                        } else {
                          if (!formats0.test(data2)) {
                            const err2 = {
                              instancePath: instancePath + '/workflowId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            };
                            if (vErrors === null) {
                              vErrors = [err2];
                            } else {
                              vErrors.push(err2);
                            }
                            errors++;
                          }
                        }
                      }
                    } else {
                      const err3 = {
                        instancePath: instancePath + '/workflowId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      };
                      if (vErrors === null) {
                        vErrors = [err3];
                      } else {
                        vErrors.push(err3);
                      }
                      errors++;
                    }
                  }
                }
                var _valid0 = _errs8 === errors;
                valid2 = valid2 || _valid0;
                const _errs11 = errors;
                if (data2 !== null) {
                  const err4 = {
                    instancePath: instancePath + '/workflowId',
                    schemaPath: '#/properties/workflowId/anyOf/1/type',
                    keyword: 'type',
                    params: { type: 'null' },
                    message: 'must be null',
                  };
                  if (vErrors === null) {
                    vErrors = [err4];
                  } else {
                    vErrors.push(err4);
                  }
                  errors++;
                }
                var _valid0 = _errs11 === errors;
                valid2 = valid2 || _valid0;
                if (!valid2) {
                  const err5 = {
                    instancePath: instancePath + '/workflowId',
                    schemaPath: '#/properties/workflowId/anyOf',
                    keyword: 'anyOf',
                    params: {},
                    message: 'must match a schema in anyOf',
                  };
                  if (vErrors === null) {
                    vErrors = [err5];
                  } else {
                    vErrors.push(err5);
                  }
                  errors++;
                  validate86.errors = vErrors;
                  return false;
                } else {
                  errors = _errs7;
                  if (vErrors !== null) {
                    if (_errs7) {
                      vErrors.length = _errs7;
                    } else {
                      vErrors = null;
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.createdAt !== void 0) {
                  let data3 = data.createdAt;
                  const _errs13 = errors;
                  if (!(
                    typeof data3 == 'number' &&
                    !(data3 % 1) &&
                    !isNaN(data3) &&
                    isFinite(data3)
                  )) {
                    validate86.errors = [
                      {
                        instancePath: instancePath + '/createdAt',
                        schemaPath: '#/properties/createdAt/type',
                        keyword: 'type',
                        params: { type: 'integer' },
                        message: 'must be integer',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs13) {
                    if (typeof data3 == 'number' && isFinite(data3)) {
                      if (data3 < 0 || isNaN(data3)) {
                        validate86.errors = [
                          {
                            instancePath: instancePath + '/createdAt',
                            schemaPath: '#/properties/createdAt/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 0 },
                            message: 'must be >= 0',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.finishedAt !== void 0) {
                    let data4 = data.finishedAt;
                    const _errs15 = errors;
                    if (
                      !(
                        typeof data4 == 'number' &&
                        !(data4 % 1) &&
                        !isNaN(data4) &&
                        isFinite(data4)
                      ) &&
                      data4 !== null
                    ) {
                      validate86.errors = [
                        {
                          instancePath: instancePath + '/finishedAt',
                          schemaPath: '#/properties/finishedAt/type',
                          keyword: 'type',
                          params: { type: schema121.properties.finishedAt.type },
                          message: 'must be integer,null',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs15) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 0 || isNaN(data4)) {
                          validate86.errors = [
                            {
                              instancePath: instancePath + '/finishedAt',
                              schemaPath: '#/properties/finishedAt/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 0 },
                              message: 'must be >= 0',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs15 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate86.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate86.errors = vErrors;
  return errors === 0;
}
validate86.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate148(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate148.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.runs === void 0 && (missing0 = 'runs'))
      ) {
        validate148.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'runs')) {
            validate148.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate148.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate148.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate148.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate148.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate148.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.runs !== void 0) {
                let data2 = data.runs;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate148.errors = [
                        {
                          instancePath: instancePath + '/runs',
                          schemaPath: '#/properties/runs/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate86(data2[i0], {
                            instancePath: instancePath + '/runs/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate86.errors
                              : vErrors.concat(validate86.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate148.errors = [
                      {
                        instancePath: instancePath + '/runs',
                        schemaPath: '#/properties/runs/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate148.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate148.errors = vErrors;
  return errors === 0;
}
validate148.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateInteractionList = validate150;
function validate150(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate150.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.interactions === void 0 && (missing0 = 'interactions'))
      ) {
        validate150.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'interactions')) {
            validate150.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate150.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate150.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate150.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate150.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate150.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.interactions !== void 0) {
                let data2 = data.interactions;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate150.errors = [
                        {
                          instancePath: instancePath + '/interactions',
                          schemaPath: '#/properties/interactions/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate54(data2[i0], {
                            instancePath: instancePath + '/interactions/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate54.errors
                              : vErrors.concat(validate54.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate150.errors = [
                      {
                        instancePath: instancePath + '/interactions',
                        schemaPath: '#/properties/interactions/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate150.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate150.errors = vErrors;
  return errors === 0;
}
validate150.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateWorkspaceList = validate152;
function validate152(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate152.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.workspaces === void 0 && (missing0 = 'workspaces'))
      ) {
        validate152.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === 'schemaVersion' || key0 === 'requestId' || key0 === 'workspaces')) {
            validate152.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate152.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate152.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate152.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate152.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate152.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workspaces !== void 0) {
                let data2 = data.workspaces;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate152.errors = [
                        {
                          instancePath: instancePath + '/workspaces',
                          schemaPath: '#/properties/workspaces/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate56(data2[i0], {
                            instancePath: instancePath + '/workspaces/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate56.errors
                              : vErrors.concat(validate56.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate152.errors = [
                      {
                        instancePath: instancePath + '/workspaces',
                        schemaPath: '#/properties/workspaces/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate152.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate152.errors = vErrors;
  return errors === 0;
}
validate152.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateExecutionPage = validate125;
var schema128 = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'requestId', 'executions', 'next'],
  properties: {
    schemaVersion: { const: 1 },
    requestId: { $ref: '#/$defs/Uuid' },
    executions: { type: 'array', items: { $ref: '#/$defs/Execution' }, maxItems: 500 },
    next: { type: ['integer', 'null'], minimum: 1 },
  },
};
function validate125(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate125.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.executions === void 0 && (missing0 = 'executions')) ||
        (data.next === void 0 && (missing0 = 'next'))
      ) {
        validate125.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'executions' ||
            key0 === 'next'
          )) {
            validate125.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate125.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate125.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate125.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate125.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate125.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.executions !== void 0) {
                let data2 = data.executions;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 500) {
                      validate125.errors = [
                        {
                          instancePath: instancePath + '/executions',
                          schemaPath: '#/properties/executions/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 500 },
                          message: 'must NOT have more than 500 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate51(data2[i0], {
                            instancePath: instancePath + '/executions/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate51.errors
                              : vErrors.concat(validate51.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate125.errors = [
                      {
                        instancePath: instancePath + '/executions',
                        schemaPath: '#/properties/executions/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.next !== void 0) {
                  let data4 = data.next;
                  const _errs9 = errors;
                  if (
                    !(
                      typeof data4 == 'number' &&
                      !(data4 % 1) &&
                      !isNaN(data4) &&
                      isFinite(data4)
                    ) &&
                    data4 !== null
                  ) {
                    validate125.errors = [
                      {
                        instancePath: instancePath + '/next',
                        schemaPath: '#/properties/next/type',
                        keyword: 'type',
                        params: { type: schema128.properties.next.type },
                        message: 'must be integer,null',
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs9) {
                    if (typeof data4 == 'number' && isFinite(data4)) {
                      if (data4 < 1 || isNaN(data4)) {
                        validate125.errors = [
                          {
                            instancePath: instancePath + '/next',
                            schemaPath: '#/properties/next/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 1 },
                            message: 'must be >= 1',
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate125.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate125.errors = vErrors;
  return errors === 0;
}
validate125.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateEvent = validate154;
var schema130 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'cursor',
    'epoch',
    'sequence',
    'type',
    'schemaVersion',
    'runId',
    'executionId',
    'sessionId',
    'payload',
    'createdAt',
  ],
  properties: {
    cursor: { $ref: '#/$defs/EventCursor' },
    epoch: { $ref: '#/$defs/Uuid' },
    sequence: { type: 'integer', minimum: 1 },
    type: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$', maxLength: 100 },
    schemaVersion: { type: 'integer', minimum: 1 },
    runId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    executionId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    sessionId: { anyOf: [{ $ref: '#/$defs/Uuid' }, { type: 'null' }] },
    payload: { type: 'object' },
    createdAt: { type: 'integer', minimum: 0 },
  },
};
var pattern13 = new RegExp(
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
  'u',
);
var pattern14 = new RegExp('^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$', 'u');
function validate154(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate154.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.cursor === void 0 && (missing0 = 'cursor')) ||
        (data.epoch === void 0 && (missing0 = 'epoch')) ||
        (data.sequence === void 0 && (missing0 = 'sequence')) ||
        (data.type === void 0 && (missing0 = 'type')) ||
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.runId === void 0 && (missing0 = 'runId')) ||
        (data.executionId === void 0 && (missing0 = 'executionId')) ||
        (data.sessionId === void 0 && (missing0 = 'sessionId')) ||
        (data.payload === void 0 && (missing0 = 'payload')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt'))
      ) {
        validate154.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema130.properties, key0)) {
            validate154.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.cursor !== void 0) {
            let data0 = data.cursor;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func2(data0) > 53) {
                  validate154.errors = [
                    {
                      instancePath: instancePath + '/cursor',
                      schemaPath: '#/$defs/EventCursor/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 53 },
                      message: 'must NOT have more than 53 characters',
                    },
                  ];
                  return false;
                } else {
                  if (!pattern13.test(data0)) {
                    validate154.errors = [
                      {
                        instancePath: instancePath + '/cursor',
                        schemaPath: '#/$defs/EventCursor/pattern',
                        keyword: 'pattern',
                        params: {
                          pattern:
                            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
                        },
                        message:
                          'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$"',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate154.errors = [
                  {
                    instancePath: instancePath + '/cursor',
                    schemaPath: '#/$defs/EventCursor/type',
                    keyword: 'type',
                    params: { type: 'string' },
                    message: 'must be string',
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.epoch !== void 0) {
              let data1 = data.epoch;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate154.errors = [
                        {
                          instancePath: instancePath + '/epoch',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate154.errors = [
                          {
                            instancePath: instancePath + '/epoch',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate154.errors = [
                            {
                              instancePath: instancePath + '/epoch',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate154.errors = [
                      {
                        instancePath: instancePath + '/epoch',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.sequence !== void 0) {
                let data2 = data.sequence;
                const _errs8 = errors;
                if (!(
                  typeof data2 == 'number' &&
                  !(data2 % 1) &&
                  !isNaN(data2) &&
                  isFinite(data2)
                )) {
                  validate154.errors = [
                    {
                      instancePath: instancePath + '/sequence',
                      schemaPath: '#/properties/sequence/type',
                      keyword: 'type',
                      params: { type: 'integer' },
                      message: 'must be integer',
                    },
                  ];
                  return false;
                }
                if (errors === _errs8) {
                  if (typeof data2 == 'number' && isFinite(data2)) {
                    if (data2 < 1 || isNaN(data2)) {
                      validate154.errors = [
                        {
                          instancePath: instancePath + '/sequence',
                          schemaPath: '#/properties/sequence/minimum',
                          keyword: 'minimum',
                          params: { comparison: '>=', limit: 1 },
                          message: 'must be >= 1',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.type !== void 0) {
                  let data3 = data.type;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 100) {
                        validate154.errors = [
                          {
                            instancePath: instancePath + '/type',
                            schemaPath: '#/properties/type/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 100 },
                            message: 'must NOT have more than 100 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!pattern14.test(data3)) {
                          validate154.errors = [
                            {
                              instancePath: instancePath + '/type',
                              schemaPath: '#/properties/type/pattern',
                              keyword: 'pattern',
                              params: { pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$' },
                              message:
                                'must match pattern "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$"',
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate154.errors = [
                        {
                          instancePath: instancePath + '/type',
                          schemaPath: '#/properties/type/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.schemaVersion !== void 0) {
                    let data4 = data.schemaVersion;
                    const _errs12 = errors;
                    if (!(
                      typeof data4 == 'number' &&
                      !(data4 % 1) &&
                      !isNaN(data4) &&
                      isFinite(data4)
                    )) {
                      validate154.errors = [
                        {
                          instancePath: instancePath + '/schemaVersion',
                          schemaPath: '#/properties/schemaVersion/type',
                          keyword: 'type',
                          params: { type: 'integer' },
                          message: 'must be integer',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs12) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 1 || isNaN(data4)) {
                          validate154.errors = [
                            {
                              instancePath: instancePath + '/schemaVersion',
                              schemaPath: '#/properties/schemaVersion/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 1 },
                              message: 'must be >= 1',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.runId !== void 0) {
                      let data5 = data.runId;
                      const _errs14 = errors;
                      const _errs15 = errors;
                      let valid3 = false;
                      const _errs16 = errors;
                      const _errs17 = errors;
                      if (errors === _errs17) {
                        if (errors === _errs17) {
                          if (typeof data5 === 'string') {
                            if (func2(data5) > 36) {
                              const err0 = {
                                instancePath: instancePath + '/runId',
                                schemaPath: '#/$defs/Uuid/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 36 },
                                message: 'must NOT have more than 36 characters',
                              };
                              if (vErrors === null) {
                                vErrors = [err0];
                              } else {
                                vErrors.push(err0);
                              }
                              errors++;
                            } else {
                              if (func2(data5) < 36) {
                                const err1 = {
                                  instancePath: instancePath + '/runId',
                                  schemaPath: '#/$defs/Uuid/minLength',
                                  keyword: 'minLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have fewer than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err1];
                                } else {
                                  vErrors.push(err1);
                                }
                                errors++;
                              } else {
                                if (!formats0.test(data5)) {
                                  const err2 = {
                                    instancePath: instancePath + '/runId',
                                    schemaPath: '#/$defs/Uuid/format',
                                    keyword: 'format',
                                    params: { format: 'uuid' },
                                    message: 'must match format "uuid"',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err2];
                                  } else {
                                    vErrors.push(err2);
                                  }
                                  errors++;
                                }
                              }
                            }
                          } else {
                            const err3 = {
                              instancePath: instancePath + '/runId',
                              schemaPath: '#/$defs/Uuid/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            };
                            if (vErrors === null) {
                              vErrors = [err3];
                            } else {
                              vErrors.push(err3);
                            }
                            errors++;
                          }
                        }
                      }
                      var _valid0 = _errs16 === errors;
                      valid3 = valid3 || _valid0;
                      const _errs19 = errors;
                      if (data5 !== null) {
                        const err4 = {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/properties/runId/anyOf/1/type',
                          keyword: 'type',
                          params: { type: 'null' },
                          message: 'must be null',
                        };
                        if (vErrors === null) {
                          vErrors = [err4];
                        } else {
                          vErrors.push(err4);
                        }
                        errors++;
                      }
                      var _valid0 = _errs19 === errors;
                      valid3 = valid3 || _valid0;
                      if (!valid3) {
                        const err5 = {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/properties/runId/anyOf',
                          keyword: 'anyOf',
                          params: {},
                          message: 'must match a schema in anyOf',
                        };
                        if (vErrors === null) {
                          vErrors = [err5];
                        } else {
                          vErrors.push(err5);
                        }
                        errors++;
                        validate154.errors = vErrors;
                        return false;
                      } else {
                        errors = _errs15;
                        if (vErrors !== null) {
                          if (_errs15) {
                            vErrors.length = _errs15;
                          } else {
                            vErrors = null;
                          }
                        }
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.executionId !== void 0) {
                        let data6 = data.executionId;
                        const _errs21 = errors;
                        const _errs22 = errors;
                        let valid5 = false;
                        const _errs23 = errors;
                        const _errs24 = errors;
                        if (errors === _errs24) {
                          if (errors === _errs24) {
                            if (typeof data6 === 'string') {
                              if (func2(data6) > 36) {
                                const err6 = {
                                  instancePath: instancePath + '/executionId',
                                  schemaPath: '#/$defs/Uuid/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have more than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err6];
                                } else {
                                  vErrors.push(err6);
                                }
                                errors++;
                              } else {
                                if (func2(data6) < 36) {
                                  const err7 = {
                                    instancePath: instancePath + '/executionId',
                                    schemaPath: '#/$defs/Uuid/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have fewer than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err7];
                                  } else {
                                    vErrors.push(err7);
                                  }
                                  errors++;
                                } else {
                                  if (!formats0.test(data6)) {
                                    const err8 = {
                                      instancePath: instancePath + '/executionId',
                                      schemaPath: '#/$defs/Uuid/format',
                                      keyword: 'format',
                                      params: { format: 'uuid' },
                                      message: 'must match format "uuid"',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err8];
                                    } else {
                                      vErrors.push(err8);
                                    }
                                    errors++;
                                  }
                                }
                              }
                            } else {
                              const err9 = {
                                instancePath: instancePath + '/executionId',
                                schemaPath: '#/$defs/Uuid/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              };
                              if (vErrors === null) {
                                vErrors = [err9];
                              } else {
                                vErrors.push(err9);
                              }
                              errors++;
                            }
                          }
                        }
                        var _valid1 = _errs23 === errors;
                        valid5 = valid5 || _valid1;
                        const _errs26 = errors;
                        if (data6 !== null) {
                          const err10 = {
                            instancePath: instancePath + '/executionId',
                            schemaPath: '#/properties/executionId/anyOf/1/type',
                            keyword: 'type',
                            params: { type: 'null' },
                            message: 'must be null',
                          };
                          if (vErrors === null) {
                            vErrors = [err10];
                          } else {
                            vErrors.push(err10);
                          }
                          errors++;
                        }
                        var _valid1 = _errs26 === errors;
                        valid5 = valid5 || _valid1;
                        if (!valid5) {
                          const err11 = {
                            instancePath: instancePath + '/executionId',
                            schemaPath: '#/properties/executionId/anyOf',
                            keyword: 'anyOf',
                            params: {},
                            message: 'must match a schema in anyOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err11];
                          } else {
                            vErrors.push(err11);
                          }
                          errors++;
                          validate154.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs22;
                          if (vErrors !== null) {
                            if (_errs22) {
                              vErrors.length = _errs22;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid0 = _errs21 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.sessionId !== void 0) {
                          let data7 = data.sessionId;
                          const _errs28 = errors;
                          const _errs29 = errors;
                          let valid7 = false;
                          const _errs30 = errors;
                          const _errs31 = errors;
                          if (errors === _errs31) {
                            if (errors === _errs31) {
                              if (typeof data7 === 'string') {
                                if (func2(data7) > 36) {
                                  const err12 = {
                                    instancePath: instancePath + '/sessionId',
                                    schemaPath: '#/$defs/Uuid/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have more than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err12];
                                  } else {
                                    vErrors.push(err12);
                                  }
                                  errors++;
                                } else {
                                  if (func2(data7) < 36) {
                                    const err13 = {
                                      instancePath: instancePath + '/sessionId',
                                      schemaPath: '#/$defs/Uuid/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 36 },
                                      message: 'must NOT have fewer than 36 characters',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err13];
                                    } else {
                                      vErrors.push(err13);
                                    }
                                    errors++;
                                  } else {
                                    if (!formats0.test(data7)) {
                                      const err14 = {
                                        instancePath: instancePath + '/sessionId',
                                        schemaPath: '#/$defs/Uuid/format',
                                        keyword: 'format',
                                        params: { format: 'uuid' },
                                        message: 'must match format "uuid"',
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err14];
                                      } else {
                                        vErrors.push(err14);
                                      }
                                      errors++;
                                    }
                                  }
                                }
                              } else {
                                const err15 = {
                                  instancePath: instancePath + '/sessionId',
                                  schemaPath: '#/$defs/Uuid/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                };
                                if (vErrors === null) {
                                  vErrors = [err15];
                                } else {
                                  vErrors.push(err15);
                                }
                                errors++;
                              }
                            }
                          }
                          var _valid2 = _errs30 === errors;
                          valid7 = valid7 || _valid2;
                          const _errs33 = errors;
                          if (data7 !== null) {
                            const err16 = {
                              instancePath: instancePath + '/sessionId',
                              schemaPath: '#/properties/sessionId/anyOf/1/type',
                              keyword: 'type',
                              params: { type: 'null' },
                              message: 'must be null',
                            };
                            if (vErrors === null) {
                              vErrors = [err16];
                            } else {
                              vErrors.push(err16);
                            }
                            errors++;
                          }
                          var _valid2 = _errs33 === errors;
                          valid7 = valid7 || _valid2;
                          if (!valid7) {
                            const err17 = {
                              instancePath: instancePath + '/sessionId',
                              schemaPath: '#/properties/sessionId/anyOf',
                              keyword: 'anyOf',
                              params: {},
                              message: 'must match a schema in anyOf',
                            };
                            if (vErrors === null) {
                              vErrors = [err17];
                            } else {
                              vErrors.push(err17);
                            }
                            errors++;
                            validate154.errors = vErrors;
                            return false;
                          } else {
                            errors = _errs29;
                            if (vErrors !== null) {
                              if (_errs29) {
                                vErrors.length = _errs29;
                              } else {
                                vErrors = null;
                              }
                            }
                          }
                          var valid0 = _errs28 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.payload !== void 0) {
                            let data8 = data.payload;
                            const _errs35 = errors;
                            if (!(data8 && typeof data8 == 'object' && !Array.isArray(data8))) {
                              validate154.errors = [
                                {
                                  instancePath: instancePath + '/payload',
                                  schemaPath: '#/properties/payload/type',
                                  keyword: 'type',
                                  params: { type: 'object' },
                                  message: 'must be object',
                                },
                              ];
                              return false;
                            }
                            var valid0 = _errs35 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.createdAt !== void 0) {
                              let data9 = data.createdAt;
                              const _errs37 = errors;
                              if (!(
                                typeof data9 == 'number' &&
                                !(data9 % 1) &&
                                !isNaN(data9) &&
                                isFinite(data9)
                              )) {
                                validate154.errors = [
                                  {
                                    instancePath: instancePath + '/createdAt',
                                    schemaPath: '#/properties/createdAt/type',
                                    keyword: 'type',
                                    params: { type: 'integer' },
                                    message: 'must be integer',
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs37) {
                                if (typeof data9 == 'number' && isFinite(data9)) {
                                  if (data9 < 0 || isNaN(data9)) {
                                    validate154.errors = [
                                      {
                                        instancePath: instancePath + '/createdAt',
                                        schemaPath: '#/properties/createdAt/minimum',
                                        keyword: 'minimum',
                                        params: { comparison: '>=', limit: 0 },
                                        message: 'must be >= 0',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                              var valid0 = _errs37 === errors;
                            } else {
                              var valid0 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate154.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate154.errors = vErrors;
  return errors === 0;
}
validate154.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateEventPage = validate131;
function validate98(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate98.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.cursor === void 0 && (missing0 = 'cursor')) ||
        (data.epoch === void 0 && (missing0 = 'epoch')) ||
        (data.sequence === void 0 && (missing0 = 'sequence')) ||
        (data.type === void 0 && (missing0 = 'type')) ||
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.runId === void 0 && (missing0 = 'runId')) ||
        (data.executionId === void 0 && (missing0 = 'executionId')) ||
        (data.sessionId === void 0 && (missing0 = 'sessionId')) ||
        (data.payload === void 0 && (missing0 = 'payload')) ||
        (data.createdAt === void 0 && (missing0 = 'createdAt'))
      ) {
        validate98.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema130.properties, key0)) {
            validate98.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.cursor !== void 0) {
            let data0 = data.cursor;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func2(data0) > 53) {
                  validate98.errors = [
                    {
                      instancePath: instancePath + '/cursor',
                      schemaPath: '#/$defs/EventCursor/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 53 },
                      message: 'must NOT have more than 53 characters',
                    },
                  ];
                  return false;
                } else {
                  if (!pattern13.test(data0)) {
                    validate98.errors = [
                      {
                        instancePath: instancePath + '/cursor',
                        schemaPath: '#/$defs/EventCursor/pattern',
                        keyword: 'pattern',
                        params: {
                          pattern:
                            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
                        },
                        message:
                          'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$"',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate98.errors = [
                  {
                    instancePath: instancePath + '/cursor',
                    schemaPath: '#/$defs/EventCursor/type',
                    keyword: 'type',
                    params: { type: 'string' },
                    message: 'must be string',
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.epoch !== void 0) {
              let data1 = data.epoch;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate98.errors = [
                        {
                          instancePath: instancePath + '/epoch',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate98.errors = [
                          {
                            instancePath: instancePath + '/epoch',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate98.errors = [
                            {
                              instancePath: instancePath + '/epoch',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate98.errors = [
                      {
                        instancePath: instancePath + '/epoch',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.sequence !== void 0) {
                let data2 = data.sequence;
                const _errs8 = errors;
                if (!(
                  typeof data2 == 'number' &&
                  !(data2 % 1) &&
                  !isNaN(data2) &&
                  isFinite(data2)
                )) {
                  validate98.errors = [
                    {
                      instancePath: instancePath + '/sequence',
                      schemaPath: '#/properties/sequence/type',
                      keyword: 'type',
                      params: { type: 'integer' },
                      message: 'must be integer',
                    },
                  ];
                  return false;
                }
                if (errors === _errs8) {
                  if (typeof data2 == 'number' && isFinite(data2)) {
                    if (data2 < 1 || isNaN(data2)) {
                      validate98.errors = [
                        {
                          instancePath: instancePath + '/sequence',
                          schemaPath: '#/properties/sequence/minimum',
                          keyword: 'minimum',
                          params: { comparison: '>=', limit: 1 },
                          message: 'must be >= 1',
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.type !== void 0) {
                  let data3 = data.type;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (typeof data3 === 'string') {
                      if (func2(data3) > 100) {
                        validate98.errors = [
                          {
                            instancePath: instancePath + '/type',
                            schemaPath: '#/properties/type/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 100 },
                            message: 'must NOT have more than 100 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!pattern14.test(data3)) {
                          validate98.errors = [
                            {
                              instancePath: instancePath + '/type',
                              schemaPath: '#/properties/type/pattern',
                              keyword: 'pattern',
                              params: { pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$' },
                              message:
                                'must match pattern "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$"',
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate98.errors = [
                        {
                          instancePath: instancePath + '/type',
                          schemaPath: '#/properties/type/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.schemaVersion !== void 0) {
                    let data4 = data.schemaVersion;
                    const _errs12 = errors;
                    if (!(
                      typeof data4 == 'number' &&
                      !(data4 % 1) &&
                      !isNaN(data4) &&
                      isFinite(data4)
                    )) {
                      validate98.errors = [
                        {
                          instancePath: instancePath + '/schemaVersion',
                          schemaPath: '#/properties/schemaVersion/type',
                          keyword: 'type',
                          params: { type: 'integer' },
                          message: 'must be integer',
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs12) {
                      if (typeof data4 == 'number' && isFinite(data4)) {
                        if (data4 < 1 || isNaN(data4)) {
                          validate98.errors = [
                            {
                              instancePath: instancePath + '/schemaVersion',
                              schemaPath: '#/properties/schemaVersion/minimum',
                              keyword: 'minimum',
                              params: { comparison: '>=', limit: 1 },
                              message: 'must be >= 1',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.runId !== void 0) {
                      let data5 = data.runId;
                      const _errs14 = errors;
                      const _errs15 = errors;
                      let valid3 = false;
                      const _errs16 = errors;
                      const _errs17 = errors;
                      if (errors === _errs17) {
                        if (errors === _errs17) {
                          if (typeof data5 === 'string') {
                            if (func2(data5) > 36) {
                              const err0 = {
                                instancePath: instancePath + '/runId',
                                schemaPath: '#/$defs/Uuid/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 36 },
                                message: 'must NOT have more than 36 characters',
                              };
                              if (vErrors === null) {
                                vErrors = [err0];
                              } else {
                                vErrors.push(err0);
                              }
                              errors++;
                            } else {
                              if (func2(data5) < 36) {
                                const err1 = {
                                  instancePath: instancePath + '/runId',
                                  schemaPath: '#/$defs/Uuid/minLength',
                                  keyword: 'minLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have fewer than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err1];
                                } else {
                                  vErrors.push(err1);
                                }
                                errors++;
                              } else {
                                if (!formats0.test(data5)) {
                                  const err2 = {
                                    instancePath: instancePath + '/runId',
                                    schemaPath: '#/$defs/Uuid/format',
                                    keyword: 'format',
                                    params: { format: 'uuid' },
                                    message: 'must match format "uuid"',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err2];
                                  } else {
                                    vErrors.push(err2);
                                  }
                                  errors++;
                                }
                              }
                            }
                          } else {
                            const err3 = {
                              instancePath: instancePath + '/runId',
                              schemaPath: '#/$defs/Uuid/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            };
                            if (vErrors === null) {
                              vErrors = [err3];
                            } else {
                              vErrors.push(err3);
                            }
                            errors++;
                          }
                        }
                      }
                      var _valid0 = _errs16 === errors;
                      valid3 = valid3 || _valid0;
                      const _errs19 = errors;
                      if (data5 !== null) {
                        const err4 = {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/properties/runId/anyOf/1/type',
                          keyword: 'type',
                          params: { type: 'null' },
                          message: 'must be null',
                        };
                        if (vErrors === null) {
                          vErrors = [err4];
                        } else {
                          vErrors.push(err4);
                        }
                        errors++;
                      }
                      var _valid0 = _errs19 === errors;
                      valid3 = valid3 || _valid0;
                      if (!valid3) {
                        const err5 = {
                          instancePath: instancePath + '/runId',
                          schemaPath: '#/properties/runId/anyOf',
                          keyword: 'anyOf',
                          params: {},
                          message: 'must match a schema in anyOf',
                        };
                        if (vErrors === null) {
                          vErrors = [err5];
                        } else {
                          vErrors.push(err5);
                        }
                        errors++;
                        validate98.errors = vErrors;
                        return false;
                      } else {
                        errors = _errs15;
                        if (vErrors !== null) {
                          if (_errs15) {
                            vErrors.length = _errs15;
                          } else {
                            vErrors = null;
                          }
                        }
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.executionId !== void 0) {
                        let data6 = data.executionId;
                        const _errs21 = errors;
                        const _errs22 = errors;
                        let valid5 = false;
                        const _errs23 = errors;
                        const _errs24 = errors;
                        if (errors === _errs24) {
                          if (errors === _errs24) {
                            if (typeof data6 === 'string') {
                              if (func2(data6) > 36) {
                                const err6 = {
                                  instancePath: instancePath + '/executionId',
                                  schemaPath: '#/$defs/Uuid/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 36 },
                                  message: 'must NOT have more than 36 characters',
                                };
                                if (vErrors === null) {
                                  vErrors = [err6];
                                } else {
                                  vErrors.push(err6);
                                }
                                errors++;
                              } else {
                                if (func2(data6) < 36) {
                                  const err7 = {
                                    instancePath: instancePath + '/executionId',
                                    schemaPath: '#/$defs/Uuid/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have fewer than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err7];
                                  } else {
                                    vErrors.push(err7);
                                  }
                                  errors++;
                                } else {
                                  if (!formats0.test(data6)) {
                                    const err8 = {
                                      instancePath: instancePath + '/executionId',
                                      schemaPath: '#/$defs/Uuid/format',
                                      keyword: 'format',
                                      params: { format: 'uuid' },
                                      message: 'must match format "uuid"',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err8];
                                    } else {
                                      vErrors.push(err8);
                                    }
                                    errors++;
                                  }
                                }
                              }
                            } else {
                              const err9 = {
                                instancePath: instancePath + '/executionId',
                                schemaPath: '#/$defs/Uuid/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              };
                              if (vErrors === null) {
                                vErrors = [err9];
                              } else {
                                vErrors.push(err9);
                              }
                              errors++;
                            }
                          }
                        }
                        var _valid1 = _errs23 === errors;
                        valid5 = valid5 || _valid1;
                        const _errs26 = errors;
                        if (data6 !== null) {
                          const err10 = {
                            instancePath: instancePath + '/executionId',
                            schemaPath: '#/properties/executionId/anyOf/1/type',
                            keyword: 'type',
                            params: { type: 'null' },
                            message: 'must be null',
                          };
                          if (vErrors === null) {
                            vErrors = [err10];
                          } else {
                            vErrors.push(err10);
                          }
                          errors++;
                        }
                        var _valid1 = _errs26 === errors;
                        valid5 = valid5 || _valid1;
                        if (!valid5) {
                          const err11 = {
                            instancePath: instancePath + '/executionId',
                            schemaPath: '#/properties/executionId/anyOf',
                            keyword: 'anyOf',
                            params: {},
                            message: 'must match a schema in anyOf',
                          };
                          if (vErrors === null) {
                            vErrors = [err11];
                          } else {
                            vErrors.push(err11);
                          }
                          errors++;
                          validate98.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs22;
                          if (vErrors !== null) {
                            if (_errs22) {
                              vErrors.length = _errs22;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid0 = _errs21 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.sessionId !== void 0) {
                          let data7 = data.sessionId;
                          const _errs28 = errors;
                          const _errs29 = errors;
                          let valid7 = false;
                          const _errs30 = errors;
                          const _errs31 = errors;
                          if (errors === _errs31) {
                            if (errors === _errs31) {
                              if (typeof data7 === 'string') {
                                if (func2(data7) > 36) {
                                  const err12 = {
                                    instancePath: instancePath + '/sessionId',
                                    schemaPath: '#/$defs/Uuid/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 36 },
                                    message: 'must NOT have more than 36 characters',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err12];
                                  } else {
                                    vErrors.push(err12);
                                  }
                                  errors++;
                                } else {
                                  if (func2(data7) < 36) {
                                    const err13 = {
                                      instancePath: instancePath + '/sessionId',
                                      schemaPath: '#/$defs/Uuid/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 36 },
                                      message: 'must NOT have fewer than 36 characters',
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err13];
                                    } else {
                                      vErrors.push(err13);
                                    }
                                    errors++;
                                  } else {
                                    if (!formats0.test(data7)) {
                                      const err14 = {
                                        instancePath: instancePath + '/sessionId',
                                        schemaPath: '#/$defs/Uuid/format',
                                        keyword: 'format',
                                        params: { format: 'uuid' },
                                        message: 'must match format "uuid"',
                                      };
                                      if (vErrors === null) {
                                        vErrors = [err14];
                                      } else {
                                        vErrors.push(err14);
                                      }
                                      errors++;
                                    }
                                  }
                                }
                              } else {
                                const err15 = {
                                  instancePath: instancePath + '/sessionId',
                                  schemaPath: '#/$defs/Uuid/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                };
                                if (vErrors === null) {
                                  vErrors = [err15];
                                } else {
                                  vErrors.push(err15);
                                }
                                errors++;
                              }
                            }
                          }
                          var _valid2 = _errs30 === errors;
                          valid7 = valid7 || _valid2;
                          const _errs33 = errors;
                          if (data7 !== null) {
                            const err16 = {
                              instancePath: instancePath + '/sessionId',
                              schemaPath: '#/properties/sessionId/anyOf/1/type',
                              keyword: 'type',
                              params: { type: 'null' },
                              message: 'must be null',
                            };
                            if (vErrors === null) {
                              vErrors = [err16];
                            } else {
                              vErrors.push(err16);
                            }
                            errors++;
                          }
                          var _valid2 = _errs33 === errors;
                          valid7 = valid7 || _valid2;
                          if (!valid7) {
                            const err17 = {
                              instancePath: instancePath + '/sessionId',
                              schemaPath: '#/properties/sessionId/anyOf',
                              keyword: 'anyOf',
                              params: {},
                              message: 'must match a schema in anyOf',
                            };
                            if (vErrors === null) {
                              vErrors = [err17];
                            } else {
                              vErrors.push(err17);
                            }
                            errors++;
                            validate98.errors = vErrors;
                            return false;
                          } else {
                            errors = _errs29;
                            if (vErrors !== null) {
                              if (_errs29) {
                                vErrors.length = _errs29;
                              } else {
                                vErrors = null;
                              }
                            }
                          }
                          var valid0 = _errs28 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.payload !== void 0) {
                            let data8 = data.payload;
                            const _errs35 = errors;
                            if (!(data8 && typeof data8 == 'object' && !Array.isArray(data8))) {
                              validate98.errors = [
                                {
                                  instancePath: instancePath + '/payload',
                                  schemaPath: '#/properties/payload/type',
                                  keyword: 'type',
                                  params: { type: 'object' },
                                  message: 'must be object',
                                },
                              ];
                              return false;
                            }
                            var valid0 = _errs35 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.createdAt !== void 0) {
                              let data9 = data.createdAt;
                              const _errs37 = errors;
                              if (!(
                                typeof data9 == 'number' &&
                                !(data9 % 1) &&
                                !isNaN(data9) &&
                                isFinite(data9)
                              )) {
                                validate98.errors = [
                                  {
                                    instancePath: instancePath + '/createdAt',
                                    schemaPath: '#/properties/createdAt/type',
                                    keyword: 'type',
                                    params: { type: 'integer' },
                                    message: 'must be integer',
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs37) {
                                if (typeof data9 == 'number' && isFinite(data9)) {
                                  if (data9 < 0 || isNaN(data9)) {
                                    validate98.errors = [
                                      {
                                        instancePath: instancePath + '/createdAt',
                                        schemaPath: '#/properties/createdAt/minimum',
                                        keyword: 'minimum',
                                        params: { comparison: '>=', limit: 0 },
                                        message: 'must be >= 0',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                              var valid0 = _errs37 === errors;
                            } else {
                              var valid0 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate98.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate98.errors = vErrors;
  return errors === 0;
}
validate98.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate131(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate131.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.events === void 0 && (missing0 = 'events')) ||
        (data.next === void 0 && (missing0 = 'next')) ||
        (data.highWater === void 0 && (missing0 = 'highWater'))
      ) {
        validate131.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'events' ||
            key0 === 'next' ||
            key0 === 'highWater'
          )) {
            validate131.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate131.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate131.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate131.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate131.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate131.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.events !== void 0) {
                let data2 = data.events;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e3) {
                      validate131.errors = [
                        {
                          instancePath: instancePath + '/events',
                          schemaPath: '#/properties/events/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e3 },
                          message: 'must NOT have more than 1000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        const _errs8 = errors;
                        if (
                          !validate98(data2[i0], {
                            instancePath: instancePath + '/events/' + i0,
                            parentData: data2,
                            parentDataProperty: i0,
                            rootData,
                            dynamicAnchors,
                          })
                        ) {
                          vErrors =
                            vErrors === null
                              ? validate98.errors
                              : vErrors.concat(validate98.errors);
                          errors = vErrors.length;
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                    }
                  } else {
                    validate131.errors = [
                      {
                        instancePath: instancePath + '/events',
                        schemaPath: '#/properties/events/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.next !== void 0) {
                  let data4 = data.next;
                  const _errs9 = errors;
                  const _errs10 = errors;
                  let valid3 = false;
                  const _errs11 = errors;
                  const _errs12 = errors;
                  if (errors === _errs12) {
                    if (typeof data4 === 'string') {
                      if (func2(data4) > 53) {
                        const err0 = {
                          instancePath: instancePath + '/next',
                          schemaPath: '#/$defs/EventCursor/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 53 },
                          message: 'must NOT have more than 53 characters',
                        };
                        if (vErrors === null) {
                          vErrors = [err0];
                        } else {
                          vErrors.push(err0);
                        }
                        errors++;
                      } else {
                        if (!pattern13.test(data4)) {
                          const err1 = {
                            instancePath: instancePath + '/next',
                            schemaPath: '#/$defs/EventCursor/pattern',
                            keyword: 'pattern',
                            params: {
                              pattern:
                                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
                            },
                            message:
                              'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$"',
                          };
                          if (vErrors === null) {
                            vErrors = [err1];
                          } else {
                            vErrors.push(err1);
                          }
                          errors++;
                        }
                      }
                    } else {
                      const err2 = {
                        instancePath: instancePath + '/next',
                        schemaPath: '#/$defs/EventCursor/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      };
                      if (vErrors === null) {
                        vErrors = [err2];
                      } else {
                        vErrors.push(err2);
                      }
                      errors++;
                    }
                  }
                  var _valid0 = _errs11 === errors;
                  valid3 = valid3 || _valid0;
                  const _errs14 = errors;
                  if (data4 !== null) {
                    const err3 = {
                      instancePath: instancePath + '/next',
                      schemaPath: '#/properties/next/anyOf/1/type',
                      keyword: 'type',
                      params: { type: 'null' },
                      message: 'must be null',
                    };
                    if (vErrors === null) {
                      vErrors = [err3];
                    } else {
                      vErrors.push(err3);
                    }
                    errors++;
                  }
                  var _valid0 = _errs14 === errors;
                  valid3 = valid3 || _valid0;
                  if (!valid3) {
                    const err4 = {
                      instancePath: instancePath + '/next',
                      schemaPath: '#/properties/next/anyOf',
                      keyword: 'anyOf',
                      params: {},
                      message: 'must match a schema in anyOf',
                    };
                    if (vErrors === null) {
                      vErrors = [err4];
                    } else {
                      vErrors.push(err4);
                    }
                    errors++;
                    validate131.errors = vErrors;
                    return false;
                  } else {
                    errors = _errs10;
                    if (vErrors !== null) {
                      if (_errs10) {
                        vErrors.length = _errs10;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.highWater !== void 0) {
                    let data5 = data.highWater;
                    const _errs16 = errors;
                    const _errs17 = errors;
                    if (errors === _errs17) {
                      if (typeof data5 === 'string') {
                        if (func2(data5) > 53) {
                          validate131.errors = [
                            {
                              instancePath: instancePath + '/highWater',
                              schemaPath: '#/$defs/EventCursor/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 53 },
                              message: 'must NOT have more than 53 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!pattern13.test(data5)) {
                            validate131.errors = [
                              {
                                instancePath: instancePath + '/highWater',
                                schemaPath: '#/$defs/EventCursor/pattern',
                                keyword: 'pattern',
                                params: {
                                  pattern:
                                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
                                },
                                message:
                                  'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$"',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate131.errors = [
                          {
                            instancePath: instancePath + '/highWater',
                            schemaPath: '#/$defs/EventCursor/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs16 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate131.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate131.errors = vErrors;
  return errors === 0;
}
validate131.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateSnapshot = validate133;
function validate133(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate133.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        (data.schemaVersion === void 0 && (missing0 = 'schemaVersion')) ||
        (data.requestId === void 0 && (missing0 = 'requestId')) ||
        (data.cursor === void 0 && (missing0 = 'cursor')) ||
        (data.projects === void 0 && (missing0 = 'projects')) ||
        (data.workflows === void 0 && (missing0 = 'workflows')) ||
        (data.runs === void 0 && (missing0 = 'runs')) ||
        (data.interactions === void 0 && (missing0 = 'interactions'))
      ) {
        validate133.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'requestId' ||
            key0 === 'cursor' ||
            key0 === 'projects' ||
            key0 === 'workflows' ||
            key0 === 'runs' ||
            key0 === 'interactions'
          )) {
            validate133.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate133.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 1 },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.requestId !== void 0) {
              let data1 = data.requestId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (errors === _errs4) {
                  if (typeof data1 === 'string') {
                    if (func2(data1) > 36) {
                      validate133.errors = [
                        {
                          instancePath: instancePath + '/requestId',
                          schemaPath: '#/$defs/Uuid/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 36 },
                          message: 'must NOT have more than 36 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func2(data1) < 36) {
                        validate133.errors = [
                          {
                            instancePath: instancePath + '/requestId',
                            schemaPath: '#/$defs/Uuid/minLength',
                            keyword: 'minLength',
                            params: { limit: 36 },
                            message: 'must NOT have fewer than 36 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (!formats0.test(data1)) {
                          validate133.errors = [
                            {
                              instancePath: instancePath + '/requestId',
                              schemaPath: '#/$defs/Uuid/format',
                              keyword: 'format',
                              params: { format: 'uuid' },
                              message: 'must match format "uuid"',
                            },
                          ];
                          return false;
                        }
                      }
                    }
                  } else {
                    validate133.errors = [
                      {
                        instancePath: instancePath + '/requestId',
                        schemaPath: '#/$defs/Uuid/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.cursor !== void 0) {
                let data2 = data.cursor;
                const _errs6 = errors;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data2 === 'string') {
                    if (func2(data2) > 53) {
                      validate133.errors = [
                        {
                          instancePath: instancePath + '/cursor',
                          schemaPath: '#/$defs/EventCursor/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 53 },
                          message: 'must NOT have more than 53 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (!pattern13.test(data2)) {
                        validate133.errors = [
                          {
                            instancePath: instancePath + '/cursor',
                            schemaPath: '#/$defs/EventCursor/pattern',
                            keyword: 'pattern',
                            params: {
                              pattern:
                                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$',
                            },
                            message:
                              'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,15})$"',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate133.errors = [
                      {
                        instancePath: instancePath + '/cursor',
                        schemaPath: '#/$defs/EventCursor/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.projects !== void 0) {
                  let data3 = data.projects;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (Array.isArray(data3)) {
                      if (data3.length > 1e4) {
                        validate133.errors = [
                          {
                            instancePath: instancePath + '/projects',
                            schemaPath: '#/properties/projects/maxItems',
                            keyword: 'maxItems',
                            params: { limit: 1e4 },
                            message: 'must NOT have more than 10000 items',
                          },
                        ];
                        return false;
                      } else {
                        var valid3 = true;
                        const len0 = data3.length;
                        for (let i0 = 0; i0 < len0; i0++) {
                          const _errs11 = errors;
                          if (
                            !validate46(data3[i0], {
                              instancePath: instancePath + '/projects/' + i0,
                              parentData: data3,
                              parentDataProperty: i0,
                              rootData,
                              dynamicAnchors,
                            })
                          ) {
                            vErrors =
                              vErrors === null
                                ? validate46.errors
                                : vErrors.concat(validate46.errors);
                            errors = vErrors.length;
                          }
                          var valid3 = _errs11 === errors;
                          if (!valid3) {
                            break;
                          }
                        }
                      }
                    } else {
                      validate133.errors = [
                        {
                          instancePath: instancePath + '/projects',
                          schemaPath: '#/properties/projects/type',
                          keyword: 'type',
                          params: { type: 'array' },
                          message: 'must be array',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.workflows !== void 0) {
                    let data5 = data.workflows;
                    const _errs12 = errors;
                    if (errors === _errs12) {
                      if (Array.isArray(data5)) {
                        if (data5.length > 1e4) {
                          validate133.errors = [
                            {
                              instancePath: instancePath + '/workflows',
                              schemaPath: '#/properties/workflows/maxItems',
                              keyword: 'maxItems',
                              params: { limit: 1e4 },
                              message: 'must NOT have more than 10000 items',
                            },
                          ];
                          return false;
                        } else {
                          var valid4 = true;
                          const len1 = data5.length;
                          for (let i1 = 0; i1 < len1; i1++) {
                            const _errs14 = errors;
                            if (
                              !validate82(data5[i1], {
                                instancePath: instancePath + '/workflows/' + i1,
                                parentData: data5,
                                parentDataProperty: i1,
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate82.errors
                                  : vErrors.concat(validate82.errors);
                              errors = vErrors.length;
                            }
                            var valid4 = _errs14 === errors;
                            if (!valid4) {
                              break;
                            }
                          }
                        }
                      } else {
                        validate133.errors = [
                          {
                            instancePath: instancePath + '/workflows',
                            schemaPath: '#/properties/workflows/type',
                            keyword: 'type',
                            params: { type: 'array' },
                            message: 'must be array',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.runs !== void 0) {
                      let data7 = data.runs;
                      const _errs15 = errors;
                      if (errors === _errs15) {
                        if (Array.isArray(data7)) {
                          if (data7.length > 1e4) {
                            validate133.errors = [
                              {
                                instancePath: instancePath + '/runs',
                                schemaPath: '#/properties/runs/maxItems',
                                keyword: 'maxItems',
                                params: { limit: 1e4 },
                                message: 'must NOT have more than 10000 items',
                              },
                            ];
                            return false;
                          } else {
                            var valid5 = true;
                            const len2 = data7.length;
                            for (let i2 = 0; i2 < len2; i2++) {
                              const _errs17 = errors;
                              if (
                                !validate86(data7[i2], {
                                  instancePath: instancePath + '/runs/' + i2,
                                  parentData: data7,
                                  parentDataProperty: i2,
                                  rootData,
                                  dynamicAnchors,
                                })
                              ) {
                                vErrors =
                                  vErrors === null
                                    ? validate86.errors
                                    : vErrors.concat(validate86.errors);
                                errors = vErrors.length;
                              }
                              var valid5 = _errs17 === errors;
                              if (!valid5) {
                                break;
                              }
                            }
                          }
                        } else {
                          validate133.errors = [
                            {
                              instancePath: instancePath + '/runs',
                              schemaPath: '#/properties/runs/type',
                              keyword: 'type',
                              params: { type: 'array' },
                              message: 'must be array',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs15 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.interactions !== void 0) {
                        let data9 = data.interactions;
                        const _errs18 = errors;
                        if (errors === _errs18) {
                          if (Array.isArray(data9)) {
                            if (data9.length > 1e4) {
                              validate133.errors = [
                                {
                                  instancePath: instancePath + '/interactions',
                                  schemaPath: '#/properties/interactions/maxItems',
                                  keyword: 'maxItems',
                                  params: { limit: 1e4 },
                                  message: 'must NOT have more than 10000 items',
                                },
                              ];
                              return false;
                            } else {
                              var valid6 = true;
                              const len3 = data9.length;
                              for (let i3 = 0; i3 < len3; i3++) {
                                const _errs20 = errors;
                                if (
                                  !validate54(data9[i3], {
                                    instancePath: instancePath + '/interactions/' + i3,
                                    parentData: data9,
                                    parentDataProperty: i3,
                                    rootData,
                                    dynamicAnchors,
                                  })
                                ) {
                                  vErrors =
                                    vErrors === null
                                      ? validate54.errors
                                      : vErrors.concat(validate54.errors);
                                  errors = vErrors.length;
                                }
                                var valid6 = _errs20 === errors;
                                if (!valid6) {
                                  break;
                                }
                              }
                            }
                          } else {
                            validate133.errors = [
                              {
                                instancePath: instancePath + '/interactions',
                                schemaPath: '#/properties/interactions/type',
                                keyword: 'type',
                                params: { type: 'array' },
                                message: 'must be array',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs18 === errors;
                      } else {
                        var valid0 = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate133.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate133.errors = vErrors;
  return errors === 0;
}
validate133.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export {
  validateCommandReceiptResponse,
  validateDevice,
  validateDeviceList,
  validateDeviceResponse,
  validateEvent,
  validateEventPage,
  validateExecutionPage,
  validateInteractionList,
  validateInteractionResponse,
  validatePairRequest,
  validatePairResponse,
  validatePairingIssued,
  validateProjectList,
  validateProjectResponse,
  validateProtocolError,
  validateRunList,
  validateRunResponse,
  validateServerHealth,
  validateServerIdentity,
  validateServerInfo,
  validateShutdownAcknowledgement,
  validateSnapshot,
  validateWorkflowList,
  validateWorkflowResponse,
  validateWorkspaceList,
  validateWorkspaceResponse,
};
