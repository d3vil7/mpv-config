'use strict';

var utils = mp.utils;

function default_value (value, default_value) {
    return value === undefined ? default_value : value;
}

function empty(value) {
    if (value === undefined || value === null) {
        return true;
    }
    if (typeof value === 'string' && value === '') {
        return true;
    }
    if (Array.isArray(value) && value.length === 0) {
        return true;
    }
    return false;
}

function read_file_lines(file, ignore_comments) {
    var ic = default_value(ignore_comments, true);
    var info = utils.file_info(file);
    if (typeof info !== 'object' || !info.is_file) {
        return undefined;
    }
    var data = utils.read_file(file);
    if (typeof data !== 'string') {
        return undefined;
    }
    var results = [];
    var lines = data.replace('\r', '').split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        var startChar = line.substring(0, 1);
        if (line === '' || (startChar === '#' && ic)) {
            continue;
        }
        results.push(line);
    }
    return results;
}

module.exports = {
    default_value: default_value,
    empty: empty,
    read_file_lines: read_file_lines,
};
