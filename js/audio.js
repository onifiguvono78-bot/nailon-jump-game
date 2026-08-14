/**
 * audio.js - 游戏音效模块
 * 封装微信 wx.createInnerAudioContext 与浏览器 HTMLAudioElement（web/wx-polyfill.js 提供）。
 * 每种音效使用独立实例；播放前先停止全部实例，保证同一时刻只有一个音效在响（互不重叠）。
 * 平台不支持时静默降级，不影响游戏运行。
 */
const CONFIG = require('./config');

// 音效实例表：key -> InnerAudioContext
const audios = {};

// 全局播放代际：每次发起播放自增。用于跨平台兜底，
// 确保旧一次的播放请求即使延迟生效（如音频未缓冲完）也会被新请求顶替。
let playGen = 0;

// 静音标志：true 时除「按钮反馈音（凤凰叫）」外，所有游戏音效都不播放
let muted = false;

// 创建音频实例；src 由调用方给出（相对工程根目录路径）
function create(src) {
  if (typeof wx.createInnerAudioContext !== 'function') return null;
  let a = null;
  try {
    a = wx.createInnerAudioContext();
  } catch (e) {
    return null;
  }
  if (!a) return null;
  try {
    a.src = src;
    a.volume = 1;
  } catch (e) {
    /* 忽略属性设置失败 */
  }
  return a;
}

// 初始化全部音效（重复调用安全，实例只创建一次）
function init() {
  if (!audios.fail)    audios.fail    = create(CONFIG.AUDIO.FAIL);
  if (!audios.jump)    audios.jump    = create(CONFIG.AUDIO.JUMP);
  if (!audios.short)   audios.short   = create(CONFIG.AUDIO.SHORT);
  if (!audios.restart) audios.restart = create(CONFIG.AUDIO.RESTART);
  if (!audios.mute)    audios.mute    = create(CONFIG.AUDIO.MUTE);
  if (!audios.record)  audios.record  = create(CONFIG.AUDIO.RECORD);
}

// 停止所有音效实例（用于切换播放时避免重叠）
function stopAll() {
  playGen++; // 使任何延迟生效的旧播放请求失效
  for (const k in audios) {
    const a = audios[k];
    if (!a) continue;
    try { a.stop(); } catch (e) { /* 忽略 */ }
  }
}

// 播放指定音效：先停掉所有实例（含自身），再播放，保证互不重叠。
// force=true 时忽略静音标志（仅按钮反馈音使用），其余音效在静音模式下直接不播。
function play(key, force) {
  if (muted && !force) return; // 静音模式：游戏音效一律不播
  const a = audios[key];
  if (!a) return;
  stopAll();            // 自增 playGen 并使所有实例停止（含目标自身）
  const gen = playGen;  // 记录本次播放代际
  try {
    a.play();
  } catch (e) {
    /* 忽略播放失败 */
  }
  // 兜底：若播放期间代际已被新的播放请求顶替（playGen 再自增），立即停止本次播放
  if (gen !== playGen) {
    try { a.stop(); } catch (e) { /* 忽略 */ }
  }
}

// 失败音效：人物落空坠落时播放
function playFail() { play('fail'); }

// 起跳音效（鬼畜笑声）：蓄力力度条 ≥ 一半时松手播放
function playJump() { play('jump'); }

// 短跳音效（昂？）：蓄力力度条 < 一半时松手播放
function playShort() { play('short'); }

// 重开音效（飞起来）：游戏失败后点击屏幕重新开始时播放
function playRestart() { play('restart'); }

// 静音按钮反馈音（凤凰叫）：点击静音按钮时始终播放，不受静音模式限制
function playMute() { play('mute', true); }

// 破纪录音效：本局得分刷新历史最高时播放
function playRecord() { play('record'); }

// 切换静音：点击按钮瞬间先播放凤凰叫反馈，再翻转静音状态；
// 开启静音时立即停掉所有正在播放的游戏音效。返回切换后的静音状态。
function toggleMute() {
  playMute();
  muted = !muted;
  if (muted) stopAll();
  return muted;
}

// 当前是否静音
function isMuted() { return muted; }

module.exports = { init, playFail, playJump, playShort, playRestart, playMute, playRecord, toggleMute, isMuted };
