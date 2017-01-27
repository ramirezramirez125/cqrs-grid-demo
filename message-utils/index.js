// date reviving copied from https://github.com/expressjs/body-parser/issues/17
var regexIso8601 = /^(\d{4}|\+\d{6})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})\.(\d{1,})(Z|([\-+])(\d{2}):(\d{2}))?)?)?)?$/;

function fixDate(value, fixers = defaultFixers) {
    let match;
    if (typeof value === "string" && (match = value.match(regexIso8601))) {
	var ms = Date.parse(match[0]);
	if (!isNaN(ms)) {
	    return new Date(ms);
	}
    }
    return value;
}

function fixRecursive(value, fixers = defaultFixers) {
    if (value != null && typeof value === "object") {
	return fixObject(value, fixers);
    }
    return value;
}

const defaultFixers = [
    fixDate,
    fixRecursive
];

function fixValue(value, fixers = defaultFixers) {
    return fixers.reduce((r, v) => v(r, fixers), value);
}

function fixObject(o, fixers = defaultFixers) {
    for (const f in o) {
	o[f] = fixValue(o[f], fixers);
    }
    return o;
}

module.exports = {
    fixDate,
    fixRecursive,
    defaultFixers,
    fixValue,
    fixObject
};

