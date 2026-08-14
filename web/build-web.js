/**
 * build-web.js - 零依赖浏览器打包脚本
 * 把 wx-polyfill + 全部游戏模块打包成单个 game-bundle.js
 * 用法：node web/build-web.js   （在 game_jump 目录下执行）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 模块清单：id -> 相对 ROOT 的文件路径
const MODULES = {
  'wx-polyfill': 'web/wx-polyfill.js',
  'game': 'game.js',
  'js/config': 'js/config.js',
  'js/utils': 'js/utils.js',
  'js/platforms': 'js/platforms.js',
  'js/player': 'js/player.js',
  'js/score': 'js/score.js',
  'js/audio': 'js/audio.js'
};

const BUNDLE_TEMPLATE = `/* 本文件由 web/build-web.js 自动生成，请勿手动修改 */
(function () {
'use strict';
var modules = {
__MODULES__
};

var cache = {};

function normalize(p) {
  var parts = p.split('/');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function resolveId(fromId, req) {
  var base = fromId.indexOf('/') >= 0 ? fromId.slice(0, fromId.lastIndexOf('/') + 1) : '';
  return normalize(base + req);
}

function load(id) {
  if (cache[id]) return cache[id].exports;
  var m = (cache[id] = { exports: {} });
  modules[id].call(m.exports, m, m.exports, function (r) {
    return load(resolveId(id, r));
  });
  return m.exports;
}

load('wx-polyfill');
load('game');
})();
`;

function main() {
  const entries = Object.keys(MODULES).map((id) => {
    const src = fs.readFileSync(path.join(ROOT, MODULES[id]), 'utf8');
    return '  "' + id + '": function (module, exports, require) {\n' + src + '\n  }';
  });
  const bundle = BUNDLE_TEMPLATE.replace('__MODULES__', entries.join(',\n'));
  // 同时输出到 web/ 与 web-dist/（发布目录），避免忘记同步
  const stamp = new Date();
  const ver = [
    String(stamp.getHours()).padStart(2, '0'),
    String(stamp.getMinutes()).padStart(2, '0'),
    String(stamp.getSeconds()).padStart(2, '0')
  ].join('');
  for (const dir of ['web', 'web-dist']) {
    fs.writeFileSync(path.join(__dirname, '..', dir, 'game-bundle.js'), bundle, 'utf8');
    // index.html 同步 + 缓存破坏（bundle 版本号打进 URL；正则兼容旧的多次追加版本号）
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      .replace(/game-bundle\.js(\?v=[0-9]+)*/g, 'game-bundle.js?v=' + ver);
    fs.writeFileSync(path.join(__dirname, '..', dir, 'index.html'), html, 'utf8');
  }
  console.log('built -> web/game-bundle.js & web-dist/game-bundle.js (' + (bundle.length / 1024).toFixed(1) + ' KB, v=' + ver + ')');
}

main();
