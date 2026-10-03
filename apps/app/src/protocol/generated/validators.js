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
var validateServerInfo = validate31;
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
          if (!func1.call(schema32.properties, key0)) {
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
          if (data.schemaVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.schemaVersion) {
              validate31.errors = [
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
                      validate31.errors = [
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
                        validate31.errors = [
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
                          validate31.errors = [
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
                    validate31.errors = [
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
                        validate31.errors = [
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
                          validate31.errors = [
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
                            validate31.errors = [
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
                      validate31.errors = [
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
                          validate31.errors = [
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
                            validate31.errors = [
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
                              validate31.errors = [
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
                        validate31.errors = [
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
                          validate31.errors = [
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
                            validate31.errors = [
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
                        validate31.errors = [
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
                            validate31.errors = [
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
                                validate31.errors = [
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
                                  validate31.errors = [
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
                                    validate31.errors = [
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
                          validate31.errors = [
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
                          validate31.errors = vErrors;
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
                              validate31.errors = [
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
                                  validate31.errors = [
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
                                    validate31.errors = [
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
                                      validate31.errors = [
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
                                        validate31.errors = [
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
                            validate31.errors = [
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
                                validate31.errors = [
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
                                    validate31.errors = [
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
                                    if (false !== data24.commands) {
                                      validate31.errors = [
                                        {
                                          instancePath: instancePath + '/capabilities/commands',
                                          schemaPath:
                                            '#/$defs/ServerCapabilities/properties/commands/const',
                                          keyword: 'const',
                                          params: { allowedValue: false },
                                          message: 'must be equal to constant',
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
                                      const _errs50 = errors;
                                      if (false !== data24.events) {
                                        validate31.errors = [
                                          {
                                            instancePath: instancePath + '/capabilities/events',
                                            schemaPath:
                                              '#/$defs/ServerCapabilities/properties/events/const',
                                            keyword: 'const',
                                            params: { allowedValue: false },
                                            message: 'must be equal to constant',
                                          },
                                        ];
                                        return false;
                                      }
                                      var valid14 = _errs50 === errors;
                                    } else {
                                      var valid14 = true;
                                    }
                                    if (valid14) {
                                      if (data24.pairing !== void 0) {
                                        const _errs51 = errors;
                                        if (false !== data24.pairing) {
                                          validate31.errors = [
                                            {
                                              instancePath: instancePath + '/capabilities/pairing',
                                              schemaPath:
                                                '#/$defs/ServerCapabilities/properties/pairing/const',
                                              keyword: 'const',
                                              params: { allowedValue: false },
                                              message: 'must be equal to constant',
                                            },
                                          ];
                                          return false;
                                        }
                                        var valid14 = _errs51 === errors;
                                      } else {
                                        var valid14 = true;
                                      }
                                      if (valid14) {
                                        if (data24.nodeTypes !== void 0) {
                                          let data28 = data24.nodeTypes;
                                          const _errs52 = errors;
                                          if (errors === _errs52) {
                                            if (Array.isArray(data28)) {
                                              if (data28.length > 0) {
                                                validate31.errors = [
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
                                                  const _errs54 = errors;
                                                  if (!(
                                                    data29 &&
                                                    typeof data29 == 'object' &&
                                                    !Array.isArray(data29)
                                                  )) {
                                                    validate31.errors = [
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
                                                  var valid15 = _errs54 === errors;
                                                  if (!valid15) {
                                                    break;
                                                  }
                                                }
                                              }
                                            } else {
                                              validate31.errors = [
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
                                          var valid14 = _errs52 === errors;
                                        } else {
                                          var valid14 = true;
                                        }
                                        if (valid14) {
                                          if (data24.harnesses !== void 0) {
                                            let data30 = data24.harnesses;
                                            const _errs56 = errors;
                                            if (errors === _errs56) {
                                              if (Array.isArray(data30)) {
                                                if (data30.length > 0) {
                                                  validate31.errors = [
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
                                                    const _errs58 = errors;
                                                    if (!(
                                                      data31 &&
                                                      typeof data31 == 'object' &&
                                                      !Array.isArray(data31)
                                                    )) {
                                                      validate31.errors = [
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
                                                    var valid16 = _errs58 === errors;
                                                    if (!valid16) {
                                                      break;
                                                    }
                                                  }
                                                }
                                              } else {
                                                validate31.errors = [
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
                                            var valid14 = _errs56 === errors;
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
                              validate31.errors = [
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
                            const _errs60 = errors;
                            const _errs61 = errors;
                            if (errors === _errs61) {
                              if (data32 && typeof data32 == 'object' && !Array.isArray(data32)) {
                                let missing4;
                                if (
                                  (data32.epochMs === void 0 && (missing4 = 'epochMs')) ||
                                  (data32.iso === void 0 && (missing4 = 'iso'))
                                ) {
                                  validate31.errors = [
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
                                  const _errs63 = errors;
                                  for (const key4 in data32) {
                                    if (!(key4 === 'epochMs' || key4 === 'iso')) {
                                      validate31.errors = [
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
                                  if (_errs63 === errors) {
                                    if (data32.epochMs !== void 0) {
                                      let data33 = data32.epochMs;
                                      const _errs64 = errors;
                                      if (!(
                                        typeof data33 == 'number' &&
                                        !(data33 % 1) &&
                                        !isNaN(data33) &&
                                        isFinite(data33)
                                      )) {
                                        validate31.errors = [
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
                                      if (errors === _errs64) {
                                        if (typeof data33 == 'number' && isFinite(data33)) {
                                          if (data33 > 864e13 || isNaN(data33)) {
                                            validate31.errors = [
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
                                              validate31.errors = [
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
                                      var valid18 = _errs64 === errors;
                                    } else {
                                      var valid18 = true;
                                    }
                                    if (valid18) {
                                      if (data32.iso !== void 0) {
                                        let data34 = data32.iso;
                                        const _errs66 = errors;
                                        if (errors === _errs66) {
                                          if (errors === _errs66) {
                                            if (typeof data34 === 'string') {
                                              if (func2(data34) > 32) {
                                                validate31.errors = [
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
                                                  validate31.errors = [
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
                                              validate31.errors = [
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
                                        var valid18 = _errs66 === errors;
                                      } else {
                                        var valid18 = true;
                                      }
                                    }
                                  }
                                }
                              } else {
                                validate31.errors = [
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
                            var valid0 = _errs60 === errors;
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
var validateServerHealth = validate32;
function validate32(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate32.evaluated;
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
        validate32.errors = [
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
            validate32.errors = [
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
              validate32.errors = [
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
                      validate32.errors = [
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
                        validate32.errors = [
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
                          validate32.errors = [
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
                    validate32.errors = [
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
                        validate32.errors = [
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
                          validate32.errors = [
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
                            validate32.errors = [
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
                      validate32.errors = [
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
                          validate32.errors = [
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
                            validate32.errors = [
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
                              validate32.errors = [
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
                        validate32.errors = [
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
                          validate32.errors = [
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
                              validate32.errors = [
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
                                validate32.errors = [
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
                                  validate32.errors = [
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
                        validate32.errors = [
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
                        validate32.errors = [
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
                          validate32.errors = vErrors;
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
                              validate32.errors = [
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
                                  validate32.errors = [
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
                                    validate32.errors = [
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
                                      validate32.errors = [
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
                                        validate32.errors = [
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
                            validate32.errors = [
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
                                validate32.errors = [
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
                                    validate32.errors = [
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
                                      validate32.errors = [
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
                                          validate32.errors = [
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
                                            validate32.errors = [
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
                                              validate32.errors = [
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
                                                validate32.errors = [
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
                                            validate32.errors = [
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
                              validate32.errors = [
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
      validate32.errors = [
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
  validate32.errors = vErrors;
  return errors === 0;
}
validate32.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateProtocolError = validate33;
var pattern4 = new RegExp('^[A-Z][A-Z0-9_]{0,63}$', 'u');
function validate33(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate33.evaluated;
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
        validate33.errors = [
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
            validate33.errors = [
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
              validate33.errors = [
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
                      validate33.errors = [
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
                        validate33.errors = [
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
                          validate33.errors = [
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
                    validate33.errors = [
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
                      validate33.errors = [
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
                    validate33.errors = [
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
                        validate33.errors = [
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
                      validate33.errors = [
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
                      validate33.errors = [
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
                            validate33.errors = [
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
                                    validate33.errors = [
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
                                        validate33.errors = [
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
                                              validate33.errors = [
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
                                            validate33.errors = [
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
                                                validate33.errors = [
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
                                              validate33.errors = [
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
                                  validate33.errors = [
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
                          validate33.errors = [
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
      validate33.errors = [
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
  validate33.errors = vErrors;
  return errors === 0;
}
validate33.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateShutdownAcknowledgement = validate34;
function validate34(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate34.evaluated;
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
        validate34.errors = [
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
            validate34.errors = [
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
              validate34.errors = [
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
                      validate34.errors = [
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
                        validate34.errors = [
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
                          validate34.errors = [
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
                    validate34.errors = [
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
                  validate34.errors = [
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
      validate34.errors = [
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
  validate34.errors = vErrors;
  return errors === 0;
}
validate34.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var validateServerIdentity = validate35;
function validate35(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
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
        validate35.errors = [
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
            validate35.errors = [
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
                    validate35.errors = [
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
                      validate35.errors = [
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
                        validate35.errors = [
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
                  validate35.errors = [
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
                      validate35.errors = [
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
                        validate35.errors = [
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
                          validate35.errors = [
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
                    validate35.errors = [
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
      validate35.errors = [
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
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export {
  validateProtocolError,
  validateServerHealth,
  validateServerIdentity,
  validateServerInfo,
  validateShutdownAcknowledgement,
};
