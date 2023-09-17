/**
 * 使用 fontconfig 或 sub-fonts-dir 加载播放文件路径下 fonts 文件夹内的字体文件
 *
 * 默认使用 fontconfig 方法加载，需要 mpv 支持 fontconfig 以及设置 sub-font-provider=fontconfig 并在 fonts.conf
 * 添加 <include ignore_missing="yes">%CONFIG_DIR%/.fonts.conf</include> 行 (替换 %CONFIG_DIR% 为 mpv 配置目录)。
 *
 * sub-fonts-dir 方法需要 mpv 最新版本，并且设置 script-opts-append=auto_load_fonts-method=native
 *
 * compatible_mode (兼容模式) 主要用于解决 fontconfig 的一些性能问题和 Windows 某些分区上的错误 (native 模式下不需要启用)
 */

'use strict';

var FONTCONFIG_XML_TEMPLATE = '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>%s</fontconfig>';
var FONTCONFIG_DIR_XML_TEMPLATE = '<dir>%s</dir>';
var FONTS_SUB_DIRS = ['fonts', 'Fonts', 'FONTS', '字体'];

var msg = mp.msg;
var utils = mp.utils;
var commands = require('../script-modules/commands');
var u = require('../script-modules/utils');

var options = {
    enable: true,
    compatible_mode: false,
    compatible_dir: '~~/.fonts',
    method: 'fontconfig', // fontconfig or native
};
var state = {
    compatible_fonts_dir: '',
    fonts_conf: commands.expand_path('~~/.fonts.conf'),
    is_windows: false,
    /** @type {string|null} */
    last_compatible_dir: null,
    /** @type {string|null} */
    last_fonts_dir: null,
    os: u.detect_os(),
    ready: false,
    set_fonts_dir: false,
};
state.is_windows = state.os === 'windows';

/**
 * @returns {boolean}
 */
function check_ready() {
    return mp.get_property_native('sub-font-provider') === 'fontconfig' || options.method === 'native';
}

function clear_fonts() {
    if (!u.dir_exist(state.compatible_fonts_dir)) {
        return;
    }
    var args = [];
    if (state.is_windows) {
        args = ['cmd.exe', '/c', 'rmdir', '/S', '/Q', state.compatible_fonts_dir];
    } else {
        args = ['rm', '-r', state.compatible_fonts_dir];
    }
    commands.subprocess(args);
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function copy_fonts(dir) {
    var args = [];
    var process = null;
    if (!u.dir_exist(options.compatible_dir)) {
        if (state.is_windows) {
            args = ['cmd.exe', '/c', 'mkdir', options.compatible_dir];
        } else {
            args = ['mkdir', '-p', options.compatible_dir];
        }
        process = commands.subprocess(args);
        if (process.status !== 0) {
            return false;
        }
    }
    if (state.is_windows) {
        args = ['Robocopy.exe', dir, state.compatible_fonts_dir, '/S', '/R:1'];
        process = commands.subprocess(args);
        return process.status >= 0 && process.status < 8;
    } else {
        args = ['cp', '-p', '-r', dir, state.compatible_fonts_dir];
        process = commands.subprocess(args);
        return process.status === 0;
    }
}

/**
 * @param {string} str
 * @returns {string}
 */
function escape_xml(str) {
    return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {string} path
 * @returns {string}
 */
function format_path(path) {
    return state.is_windows ? u.format_windows_path(path) : path;
}

/**
 * @param {string} path
 * @returns {string|null}
 */
function get_available_fonts_dir(path) {
    var fonts_dir = null;
    for (var i = 0; i < FONTS_SUB_DIRS.length; i++) {
        var dir = u.absolute_path(utils.join_path(path, FONTS_SUB_DIRS[i]));
        if (u.dir_exist(dir)) {
            fonts_dir = format_path(dir);
            break;
        }
    }
    return fonts_dir;
}

/**
 * @returns {string}
 */
function get_compatible_fonts_dir() {
    var base = utils.join_path(options.compatible_dir, mp.get_script_name() + '$');
    for (var i = 1; ; i++) {
        var path = base + i;
        if (!u.dir_exist(path)) {
            return path;
        }
    }
}

/**
 * @param {string|null} dir
 */
function set_fonts_dir(dir) {
    var d = dir === null ? '' : dir;
    var method = options.method;
    if (method === 'fontconfig') {
        write_fonts_conf(d, d === '');
    } else if (method === 'native') {
        mp.set_property_native('sub-fonts-dir', d);
    }
}

function update_options() {
    if (options.compatible_mode && !state.os) {
        options.compatible_mode = false;
        msg.warn('Unknown OS detected, compatibility mode disabled.');
    }
    options.compatible_dir = format_path(commands.expand_path(options.compatible_dir));
    // 如果兼容目录已更改则清理旧目录
    if (state.last_compatible_dir !== options.compatible_dir) {
        clear_fonts();
    }
    state.last_compatible_dir = options.compatible_dir;
    state.last_fonts_dir = null;
    state.ready = check_ready();
}

/**
 * @param {string} fonts_dir
 * @param {boolean} require_exist
 */
function write_fonts_conf(fonts_dir, require_exist) {
    var exist = u.file_exist(state.fonts_conf);
    // 做一些检查，避免无用的重复写入。
    if (require_exist && !exist) {
        return;
    }
    var xml = fonts_dir === '' ? '' : u.string_format(FONTCONFIG_DIR_XML_TEMPLATE, escape_xml(fonts_dir));
    var data = u.string_format(FONTCONFIG_XML_TEMPLATE, xml);
    if (exist && utils.read_file(state.fonts_conf) === data) {
        return;
    }
    utils.write_file('file://' + state.fonts_conf, data);
}

mp.options.read_options(options, 'auto_load_fonts', function () {
    if (!options.enable) {
        state.set_fonts_dir = false;
        mp.set_property_native('sub-fonts-dir', '');
        write_fonts_conf('', true);
        clear_fonts();
    }
    update_options();
});
update_options();

mp.observe_property('sub-font-provider', 'native', function () {
    state.ready = check_ready();
});

mp.add_hook('on_load', 50, function () {
    if (mp.get_property_native('playback-abort')) {
        return;
    }

    var fonts_dir = null;
    var path = mp.get_property_native('path');
    var spaths = utils.split_path(path);
    var current_dir = spaths[0];
    var sub_paths = mp.get_property_native('sub-file-paths') || [];
    sub_paths.unshift('');

    for (var i = 0; !fonts_dir && i < sub_paths.length; i++) {
        fonts_dir = get_available_fonts_dir(utils.join_path(current_dir, sub_paths[i]));
    }

    // 如果没有字体目录并且之前设置了字体目录，那么清空配置文件。
    if (!fonts_dir) {
        if (state.set_fonts_dir) {
            set_fonts_dir(null);
            state.set_fonts_dir = false;
        }
        return;
    } else if (fonts_dir && (!options.enable || !state.ready)) {
        msg.warn('The fonts directory exists, but the script is not enabled.');
        return;
    }

    var source_fonts_dir = fonts_dir;
    if (state.last_fonts_dir === source_fonts_dir) {
        return;
    }

    if (options.compatible_mode) {
        clear_fonts();
        state.compatible_fonts_dir = get_compatible_fonts_dir();
        if (copy_fonts(source_fonts_dir)) {
            fonts_dir = state.compatible_fonts_dir;
        } else {
            msg.error(u.string_format("Copy fonts directory failed: '%s' -> '%s'", source_fonts_dir, state.compatible_fonts_dir));
        }
    }

    state.last_fonts_dir = source_fonts_dir;
    state.set_fonts_dir = true;
    set_fonts_dir(fonts_dir);

    if (fonts_dir === source_fonts_dir) {
        msg.info(u.string_format('Use %s to set the font directory: %s', options.method, fonts_dir));
    } else {
        msg.info(u.string_format('Use %s to set the font directory (compatible_mode): %s (%s)', options.method, fonts_dir, source_fonts_dir));
    }
});

mp.register_event('shutdown', function () {
    set_fonts_dir(null);
    clear_fonts();
});
