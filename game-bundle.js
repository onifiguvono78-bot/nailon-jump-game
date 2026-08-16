/* 本文件由 web/build-web.js 自动生成，请勿手动修改 */
(function () {
'use strict';
var modules = {
  "wx-polyfill": function (module, exports, require) {
/**
 * wx-polyfill.js - 浏览器适配层
 * 把微信小游戏 API 映射为浏览器 API，使同一套游戏源码可在 Web 中运行
 */
(function () {
  // 逻辑画布尺寸：固定 390x780 竖屏，与手机小游戏体验一致
  var LOGIC_W = 390;
  var LOGIC_H = 780;

  var canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.width = LOGIC_W;
  canvas.height = LOGIC_H;
  // 把 canvas 放到 stage 容器里，由 index.html 的 flex 布局居中
  var stage = document.getElementById('stage') || document.body;
  stage.appendChild(canvas);

  var wx = (globalThis.wx = {});

  wx.createCanvas = function () {
    return canvas;
  };

  wx.getWindowInfo = function () {
    return { windowWidth: canvas.width, windowHeight: canvas.height };
  };

  wx.getSystemInfoSync = function () {
    return wx.getWindowInfo();
  };

  // 本地存储：JSON 序列化，兼容微信 storage 的原生类型语义（数字/字符串/对象）
  wx.getStorageSync = function (key) {
    try {
      var raw = localStorage.getItem('wb_minigame_' + key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };

  wx.setStorageSync = function (key, value) {
    try {
      localStorage.setItem('wb_minigame_' + key, JSON.stringify(value));
    } catch (e) {
      /* 忽略写入失败（隐私模式 / file:// 受限等） */
    }
  };

  // 图片加载：微信小游戏用 wx.createImage，浏览器里等价于创建 <img>
  wx.createImage = function () {
    return document.createElement('img');
  };

  // 音频：微信 wx.createInnerAudioContext 对应浏览器 <audio> 元素。
  // 返回对象实现 InnerAudioContext 常用子集（src/volume/play/stop/pause/destroy），
  // 供 js/audio.js 等模块统一使用。
  // 关键点：play()/stop() 通过代际 token 互斥 —— 若 stop() 在 play() 的
  // promise 尚未 resolve（音频还没真正开始播放）时被调用，等 promise resolve
  // 后 token 已失效，会立即静默停止，杜绝"暂停无效导致旧音效复活重叠"。
  var audioEls = [];
  var audioUnlocked = false; // 音频解锁标志：只在首次点击时解锁一次
  wx.createInnerAudioContext = function () {
    var a = document.createElement('audio');
    a.preload = 'auto';
    audioEls.push(a);
    var token = 0; // 播放代际：每次 stop() 自增，使未完成的 play() 失效
    return {
      _el: a,
      set src(v) { a.src = v; },
      get src() { return a.src; },
      set volume(v) { a.volume = v; },
      get volume() { return a.volume; },
      set loop(v) { a.loop = v; },
      get loop() { return a.loop; },
      play: function () {
        var my = ++token;
        var p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function () {
            // 播放真正开始后，若期间被 stop() 顶替（token 已变），立即静默停止
            if (token !== my) { a.pause(); a.currentTime = 0; }
          }).catch(function () {});
        }
      },
      stop: function () {
        token++; // 使未完成的 play() 失效，防止其"复活"与其他音效重叠
        a.pause();
        a.currentTime = 0;
      },
      pause: function () { a.pause(); },
      destroy: function () { token++; a.pause(); a.src = ''; }
    };
  };

  // 解锁音频：仅在首次用户交互时预播放并立刻暂停一次，
  // 绕过 iOS Safari / 部分浏览器的自动播放策略，之后 play() 才被允许。
  // 注意：只允许执行一次！若每次点击都执行，会把所有处于暂停状态（paused=true）
  // 的音效也拉起来 play()，导致其他音效在播放中被强行叠加 —— 多音效重叠的根因。
  function primeAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    for (var i = 0; i < audioEls.length; i++) {
      (function (el) {
        if (!el.src || !el.paused) return;
        var p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(function () {
            el.pause();
            el.currentTime = 0;
          }).catch(function () {});
        }
      })(audioEls[i]);
    }
  }

  /* ---------------- 输入事件：Pointer / Mouse / Touch 三通道兼容 ----------------
   * 微信小游戏语义：整屏可点。这里把事件绑定在 document 上（而非 canvas），
   * 保证点击画布外的深色区域同样有效；并同时兼容三类事件源：
   *   - 支持 PointerEvent 的浏览器：鼠标/触摸/笔都会产生 pointer 事件，只走 pointer 通道
   *   - 不支持 PointerEvent 的旧环境：回退到 mouse + touch 双通道
   * 事件在 300ms 内去重，避免旧浏览器"触摸合成鼠标事件"导致一次点击触发两次。
   */
  var startCb = null;
  var endCb = null;
  var cancelCb = null;
  var lastDown = 0;
  var lastUp = 0;
  var bound = false;

  // 把浏览器视口坐标换算为游戏逻辑坐标（390x780）。
  // canvas 通过 CSS 等比缩放居中显示，直接使用 clientX/Y 会与逻辑坐标偏差。
  // 兼容 Pointer/Mouse（clientX 在事件上）与 Touch（clientX 在 touches[0] 上）。
  function toLogicalPoint(ev) {
    var cx = ev.clientX;
    var cy = ev.clientY;
    if (typeof cx !== 'number' && ev.touches && ev.touches[0]) {
      cx = ev.touches[0].clientX;
      cy = ev.touches[0].clientY;
    }
    var rect = canvas.getBoundingClientRect();
    return {
      clientX: ((cx - rect.left) / (rect.width || 1)) * LOGIC_W,
      clientY: ((cy - rect.top) / (rect.height || 1)) * LOGIC_H
    };
  }

  // 按下/松开各自独立去重：按下防"触摸合成鼠标"双触发；
  // 松开不共用计时，保证快速轻点（按下后 300ms 内松开）也能正常触发跳跃。
  function fireStart(ev) {
    var now = Date.now();
    if (now - lastDown < 300) return;
    lastDown = now;
    primeAudio(); // 借首次点击解锁音频
    var p = toLogicalPoint(ev);
    if (startCb) startCb({ touches: [{ clientX: p.clientX, clientY: p.clientY }] });
  }

  function fireEnd() {
    var now = Date.now();
    if (now - lastUp < 100) return;
    lastUp = now;
    if (endCb) endCb({ changedTouches: [] });
  }

  function onStart(e) {
    if (e.cancelable) e.preventDefault();
    fireStart(e);
  }

  function onEnd() {
    fireEnd();
  }

  function onCancel(e) {
    if (cancelCb) cancelCb({ changedTouches: [] });
  }

  function ensureBound() {
    if (bound) return;
    bound = true;
    var hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (hasPointer) {
      document.addEventListener('pointerdown', onStart);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onCancel);
    } else {
      document.addEventListener('mousedown', onStart);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchstart', onStart, { passive: true });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onCancel);
    }
  }

  wx.onTouchStart = function (cb) {
    startCb = cb;
    ensureBound();
  };

  wx.onTouchEnd = function (cb) {
    endCb = cb;
    ensureBound();
  };

  wx.onTouchCancel = function (cb) {
    cancelCb = cb;
    ensureBound();
  };
})();

  },
  "game": function (module, exports, require) {
/**
 * game.js - 游戏入口（薄层）
 * 职责：初始化 canvas、触摸输入、主循环、相机跟随、落地判定、游戏状态机、UI 层
 * 玩法逻辑均委托给 js/ 下的独立模块：
 *   - js/platforms.js  平台随机生成与管理
 *   - js/player.js     小人物理与状态机
 *   - js/score.js      计分与最高分持久化
 *   - js/config.js     全局参数与配色
 *   - js/utils.js      通用工具
 */
const CONFIG = require('./js/config');
const { PlatformManager } = require('./js/platforms');
const Player = require('./js/player');
const ScoreManager = require('./js/score');
const audio = require('./js/audio');

/* ------------------------------ 系统与画布 ------------------------------ */

function getWindowInfo() {
  // 优先使用新 API wx.getWindowInfo（基础库 2.20.1+），旧基础库回退
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo();
  const s = wx.getSystemInfoSync();
  return { windowWidth: s.windowWidth, windowHeight: s.windowHeight };
}

const WIN = getWindowInfo();
const W = WIN.windowWidth;
const H = WIN.windowHeight;

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

/* ------------------------------ 相机 ------------------------------ */

const cam = { x: 0, y: 0, w: W, h: H };
let camTargetX = 0;
let camTargetY = 0;
const CAM_LERP = 6; // 相机跟随平滑系数

function setCameraTarget(cx, cy) {
  camTargetX = cx - W * 0.38; // 平台略靠屏幕左中，右侧留出前方视野
  camTargetY = cy - H * 0.55;
}

function updateCamera(dt) {
  const k = 1 - Math.exp(-CAM_LERP * dt); // 帧率无关的指数平滑
  cam.x += (camTargetX - cam.x) * k;
  cam.y += (camTargetY - cam.y) * k;
}

/* ------------------------------ 测试暴露（仅 Node 自检用） ------------------------------ */

if (typeof global !== 'undefined') {
  global.__gameSnapshot = function () {
    return {
      state: gameState,
      score: score ? score.score : 0,
      best: score ? score.best : 0,
      playerX: player ? player.x : 0,
      playerY: player ? player.y : 0,
      current: pm && pm.current ? { x: pm.current.x, y: pm.current.y, half: pm.current.half } : null,
      next: pm && pm.next ? { x: pm.next.x, y: pm.next.y, half: pm.next.half } : null
    };
  };
}

/* ------------------------------ 游戏状态 ------------------------------ */

const GAME_STATE = { RUNNING: 0, OVER: 1 };
let gameState = GAME_STATE.RUNNING;

let pm = null;     // 平台管理器
let player = null; // 小人
let score = null;  // 计分器
let recordBanner = null; // 「新纪录！」弹字状态：{ start: ts }（raf 时间戳，毫秒）
let bgImg = null;  // 背景图（只加载一次）

function initGame() {
  // 首块平台位于屏幕中央偏下
  const cx = W / 2;
  const cy = H * 0.7;

  pm = new PlatformManager(cx, cy);
  // 小人站在首平台顶面中心（platform.y 为立方体中心，顶面在其上方 half 处）
  player = new Player(cx, cy - pm.current.half);
  player.onLand = onLand;
  score = new ScoreManager();
  score.reset();
  audio.init();

  // 背景图只创建一次，跨局复用
  if (!bgImg && typeof wx !== 'undefined' && wx.createImage) {
    bgImg = wx.createImage();
    bgImg.src = CONFIG.BACKGROUND.IMAGE;
  }

  setCameraTarget(pm.current.x, pm.current.y);
  cam.x = camTargetX;
  cam.y = camTargetY;
  recordBanner = null; // 重开时清掉残留的「新纪录！」弹字
  gameState = GAME_STATE.RUNNING;
}

/* ------------------------------ 启动：先预加载平台贴图 ------------------------------ */

let loopStarted = false;

function drawLoading(text) {
  ctx.fillStyle = CONFIG.COLOR.BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = CONFIG.COLOR.TEXT;
  ctx.fillText(text, W / 2, H / 2);
}

function startGame() {
  initGame();
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(loop);
  }
}

// 首次启动前统一预加载平台贴图，避免首屏平台顶面表情包缺失
PlatformManager.preloadTextures().then(() => {
  startGame();
}).catch(() => {
  // 加载异常时仍允许启动（会 fallback 到橙色顶面）
  startGame();
});

/* ------------------------------ 落地判定 ------------------------------ */

function onLand() {
  const tol = 16; // 落地容差（px）
  const next = pm.next;

  // 命中下一块平台：得分并推进；人物最终站在下一平台顶面中心
  if (next && next.contains(player.x, player.y, tol)) {
    const isRecord = score.add();
    if (isRecord) {
      audio.playRecord();                    // 打破纪录：播放破纪录音效
      recordBanner = { start: lastTs };      // 同时弹出「新纪录！」
    }
    pm.advance();
    player.place(next.x, next.y - next.half);
    setCameraTarget(pm.current.x, pm.current.y);
    return;
  }

  // 仍落在当前平台（蓄力太短或原地跳）：原地安置到顶面中心
  if (pm.current.contains(player.x, player.y, tol)) {
    player.place(player.x, pm.current.y - pm.current.half);
    return;
  }

  // 落空：坠落并结算
  player.beginFall();
  gameState = GAME_STATE.OVER;
  score.save();
  audio.playFail(); // 人物坠落，播放失败音效
}

/* ------------------------------ 静音按钮 ------------------------------ */

// 静音按钮：屏幕顶部中央（逻辑坐标），圆形，半径含命中余量
const MUTE_BTN = { x: W / 2, y: 46, r: 24, hit: 32 };

function inMuteBtn(tx, ty) {
  const dx = tx - MUTE_BTN.x;
  const dy = ty - MUTE_BTN.y;
  return dx * dx + dy * dy <= MUTE_BTN.hit * MUTE_BTN.hit;
}

function drawMuteButton() {
  const b = MUTE_BTN;
  const muted = audio.isMuted();
  const x = b.x;
  const y = b.y;

  ctx.save();
  // 背景圆
  ctx.beginPath();
  ctx.arc(x, y, b.r, 0, Math.PI * 2);
  ctx.fillStyle = muted ? 'rgba(70, 60, 50, 0.72)' : 'rgba(0, 0, 0, 0.30)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 喇叭图标
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 4);
  ctx.lineTo(x - 2, y - 4);
  ctx.lineTo(x + 5, y - 10);
  ctx.lineTo(x + 5, y + 10);
  ctx.lineTo(x - 2, y + 4);
  ctx.lineTo(x - 7, y + 4);
  ctx.closePath();
  ctx.fill();
  if (muted) {
    // 静音：红色斜杠划过
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 7);
    ctx.lineTo(x + 7, y - 7);
    ctx.stroke();
  } else {
    // 有声：声波弧线
    ctx.beginPath();
    ctx.arc(x + 7.5, y, 3.5, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 10.5, y, 6.5, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------ 触摸输入 ------------------------------ */

// 跳跃朝向：指向「下一平台顶面中心」的单位方向（附带距离 len 供距离映射）
function jumpDir() {
  const next = pm.next;
  if (!next) return { x: 0, y: -1, len: 0 };
  const dx = next.x - player.x;
  const dy = (next.y - next.half) - player.y; // 目标为下一平台顶面中心
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len, len: len };
}

wx.onTouchStart((e) => {
  // 静音按钮优先响应（含游戏结束画面）：点击只切换静音，不触发重开/蓄力
  const t = e.touches && e.touches[0];
  const tx = t ? t.clientX : W / 2;
  const ty = t ? t.clientY : H / 2;
  if (inMuteBtn(tx, ty)) {
    audio.toggleMute(); // 点击瞬间播放凤凰叫，再切换静音
    return;
  }
  if (gameState === GAME_STATE.OVER) {
    initGame(); // 游戏结束后点击重新开始
    audio.playRestart(); // 重开音效（飞起来）
    return;
  }
  player.startCharge();
});

wx.onTouchEnd(() => {
  if (gameState === GAME_STATE.OVER) return;
  // 以画面上的蓄力力度条（chargeRatio 0~1）为基准区分起跳音效：
  // 力度条 ≥ 一半播鬼畜笑声（大力跳），< 一半播「昂？」（轻跳）
  // player.state === 1 即 CHARGING（与 drawChargeBar 判断一致），确保只在实际蓄力松手时发声
  if (player.state === 1) {
    if (player.chargeRatio >= CONFIG.AUDIO_TRIGGER.POWER_HALF) audio.playJump();
    else audio.playShort();
  }
  const dir = jumpDir();
  player.release(dir.x, dir.y, dir.len);
});

// 触摸被系统打断（来电等）时取消蓄力，避免松手误跳
wx.onTouchCancel(() => {
  player.cancelCharge();
});

/* ------------------------------ 主循环 ------------------------------ */

let lastTs = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.033); // 防止切后台后 dt 过大
  lastTs = ts;

  player.update(dt);        // 跳跃/坠落物理
  updateCamera(dt);         // 相机跟随
  render(ts);               // 渲染

  requestAnimationFrame(loop);
}

/* ------------------------------ 渲染 ------------------------------ */

function drawBackground() {
  // 背景图等比 cover 铺满画布，未加载完成前用 CONFIG.COLOR.BG 兜底
  if (bgImg && bgImg.complete && bgImg.width > 0) {
    const scale = Math.max(W / bgImg.width, H / bgImg.height);
    const dw = bgImg.width * scale;
    const dh = bgImg.height * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.drawImage(bgImg, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = CONFIG.COLOR.BG;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawChargeBar() {
  if (player.state !== 1) return; // 仅蓄力时显示（CHARGING = 1）
  const ratio = player.chargeRatio;
  const barW = 120;
  const barH = 8;
  const bx = (W - barW) / 2;
  const by = H * 0.62;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = CONFIG.COLOR.ACCENT;
  ctx.fillRect(bx + 2, by + 2, (barW - 4) * ratio, barH - 4);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('游戏结束', W / 2, H * 0.36);

  ctx.font = 'bold 56px sans-serif';
  ctx.fillStyle = '#ffd98a';
  ctx.fillText(String(score.score), W / 2, H * 0.48);

  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('历史最高 ' + score.best, W / 2, H * 0.58);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('点击屏幕重新开始', W / 2, H * 0.68);
}

// 「新纪录！」弹字：破纪录时从屏幕中央偏上弹出，黑色粗体。
// 前 0.35s 弹性放大（easeOutBack 过冲回落），完整显示 2 秒后 0.6s 渐隐消失。
function drawRecordBanner(ts) {
  if (!recordBanner) return;
  const t = (ts - recordBanner.start) / 1000;
  const SHOW = 2.0; // 完全显示时长（秒）
  const FADE = 0.6; // 渐隐时长（秒）
  if (t > SHOW + FADE) {
    recordBanner = null;
    return;
  }
  // 透明度：前 SHOW 秒全不透明，之后线性渐隐
  let alpha = 1;
  if (t > SHOW) alpha = Math.max(0, 1 - (t - SHOW) / FADE);
  // 弹出缩放：easeOutBack，0.35s 内从 0 弹到 1 并轻微过冲
  let scale = 1;
  if (t < 0.35) {
    const k = Math.min(t / 0.35, 1);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    scale = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H * 0.30);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = '#000000';
  ctx.fillText('新纪录！', 0, 0);
  ctx.restore();
}

function render(ts) {
  drawBackground();
  pm.draw(ctx, cam);
  player.draw(ctx, cam, ts);
  drawChargeBar();
  drawMuteButton();
  score.draw(ctx, W);
  if (gameState === GAME_STATE.OVER) drawGameOver();
  else drawRecordBanner(ts); // 仅运行中显示弹字，避免盖在结束黑幕上
}

/* ------------------------------ 启动入口 ------------------------------ */

// 首次启动先显示加载画面，等资源预加载完成后再进入游戏主循环
drawLoading('资源加载中...');

  },
  "js/config": function (module, exports, require) {
/**
 * config.js - 游戏全局常量与配色
 * 所有玩法参数集中在此，便于调整难度
 */
const CONFIG = {
  // 背景图（相对工程根目录）
  BACKGROUND: {
    IMAGE: 'images/bg.jpg' // 游戏背景，等比 cover 铺满画布，未加载完成前用 COLOR.BG 兜底
  },

  // 方块平台生成参数
  PLATFORM: {
    MIN_SIZE: 60,      // 平台边长下限（px）
    MAX_SIZE: 100,     // 平台边长上限（px）
    MIN_DIST: 130,     // 相邻平台中心最小距离
    MAX_DIST: 220,     // 相邻平台中心最大距离
    MAX_DX: 75,        // 相邻平台水平偏移上限（左右随机）
    PRE_SPAWN: 3,      // 向前预生成平台数量
    CULL_KEEP: 2,      // 保留的历史平台数量（用于裁剪）
    TEXTURES: [        // 平台贴图（随机出现），路径相对工程根目录
      'images/platforms/3x3-6.png',
      'images/platforms/3x3-6b.png',
      'images/platforms/3x3-6a.png',
      'images/platforms/3x3-3.png',
      'images/platforms/3x3-1.png',
      'images/platforms/3x3-9.png',
      'images/platforms/3x3-8.png',
      'images/platforms/3x3-7.png'
    ]
  },

  // 蓄力与跳跃参数
  // 跳跃距离与当前到下一平台的距离（len）挂钩，保证蓄力节奏可掌握：
  //   实际距离 = len * (MIN_RATIO + (MAX_RATIO - MIN_RATIO) * 蓄力比例)
  // 蓄力 50% 时恰好落在下一平台中心；轻点/蓄满都会偏离平台（不足或过头）。
  CHARGE: {
    MAX_TIME: 1.2,     // 最长蓄力时间（秒），蓄满即满距离
    MIN_RATIO: 0.5,    // 最短跳跃距离占 len 的比例
    MAX_RATIO: 1.5     // 最长跳跃距离占 len 的比例
  },

  // 跳跃飞行表现
  FLIGHT: {
    DURATION_MIN: 0.28,  // 最短飞行时长（秒）
    DURATION_MAX: 0.55,  // 最长飞行时长（秒）
    ARC: 70              // 跳跃弧线峰值高度（px）
  },

  // 坠落物理
  FALL: {
    GRAVITY: 1400,     // 重力加速度（px/s^2）
    DRIFT: 60          // 坠落时的水平漂移（px/s）
  },

  // 人物外观参数
  PLAYER: {
    IMAGE: 'images/character.png', // 角色贴图路径（相对工程根目录）
    HEIGHT: 70,                    // 绘制高度（px），宽度按图片比例自动计算
    SHADOW: 0.38,                  // 影子缩放系数
    // 鬼畜奶龙逐帧动画（去白底，透明 PNG）
    FRAMES: Array.from({ length: 16 }, (_, i) => 'images/frames/frame_' + String(i + 1).padStart(2, '0') + '.png'),
    // 各阶段逐帧间隔（秒/帧）
    FRAME_INTERVAL: {
      CHARGE: 0.12,   // 蓄力帧间隔（5 帧 ~0.6s）
      JUMP:   0.05,   // 跳跃帧间隔（7 帧 ~0.35s）
      LAND:   0.09    // 落地帧间隔（4 帧 ~0.36s）
    }
  },

  // 音效（相对工程根目录）
  AUDIO: {
    FAIL:    'images/fail.wav',     // 失败音效：人物落空坠落时播放
    JUMP:    'images/jump.wav',     // 起跳音效（鬼畜笑声）：蓄力力度条 ≥ 一半时松手播放
    SHORT:   'images/short.wav',    // 短跳音效（昂？）：蓄力力度条 < 一半时松手播放
    RESTART: 'images/restart.wav',  // 重开音效（飞起来）：游戏失败后点击屏幕重新开始时播放
    MUTE:    'images/mute.wav',     // 静音按钮音效（凤凰叫）：点击静音/取消静音按钮时播放
    RECORD:  'images/record.wav'    // 破纪录音效：本局得分刷新历史最高时播放
  },
  // 音效触发阈值（以画面上的蓄力力度条比例 chargeRatio 0~1 为基准）
  AUDIO_TRIGGER: {
    POWER_HALF: 0.5 // 力度条阈值：蓄力比例 ≥ 此值播放起跳音效（鬼畜笑声），否则播放短跳音效（昂？）
  },

  // 配色（基础暖色调，平台仍用纯色绘制）
  COLOR: {
    BG: '#f7f3ea',            // 背景
    GRID: '#efe8d9',          // 背景网格
    PLATFORM_TOP: '#ffd98a',  // 平台顶面（亮）
    PLATFORM_MAIN: '#ffb64c', // 平台主体
    PLATFORM_DARK: '#e8962e', // 平台底面（暗）
    PLAYER_BODY: '#3b4252',   // 小人身体（图片加载失败时的 fallback 配色）
    PLAYER_HEAD: '#eceff4',   // 小人头部
    PLAYER_EYE: '#2e3440',    // 小人眼睛
    PLAYER_BLUSH: '#ff6b81',  // 小人腮红
    TEXT: '#4a4a4a',          // 主文字
    TEXT_SUB: '#8a8a8a',      // 次级文字
    ACCENT: '#ff6348'         // 强调色
  }
};

module.exports = CONFIG;

  },
  "js/utils": function (module, exports, require) {
/**
 * utils.js - 通用工具函数
 */
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/**
 * 绘制圆角矩形（兼容性封装，避免依赖 ctx.roundRect，
 * 旧基础库不支持 roundRect，改用 arcTo 手动构建路径）
 */
function fillRoundRect(ctx, x, y, w, h, r, color) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

module.exports = { clamp, lerp, rand, randInt, fillRoundRect };

  },
  "js/platforms": function (module, exports, require) {
/**
 * platforms.js - 方块平台生成与管理
 * 职责：平台随机生成（向下、距离随机）、推进、视口裁剪、绘制
 */
const CONFIG = require('./config');
const { rand, randInt } = require('./utils');

/**
 * 全局平台贴图缓存：path -> { img, loaded }
 * 同一贴图共享同一个 Image 实例，避免每块平台重复加载；
 * 也便于在游戏启动前统一预加载，确保首屏表情包不缺失。
 */
const textureCache = {};

function loadTexture(path) {
  if (!path) return null;
  if (textureCache[path]) return textureCache[path];

  const entry = { img: null, loaded: false, done: false };
  if (typeof wx !== 'undefined' && wx.createImage) {
    const img = wx.createImage();
    entry.img = img;
    img.onload = () => { entry.loaded = true; entry.done = true; };
    img.onerror = () => { entry.loaded = false; entry.done = true; }; // 失败也算完成，避免预加载死等
    img.src = path;
  } else {
    entry.done = true; // 无法创建图片对象时直接标记完成，走 fallback 顶面
  }
  textureCache[path] = entry;
  return entry;
}

class Platform {
  constructor(x, y, size, textureKey) {
    this.x = x;      // 中心坐标
    this.y = y;
    this.size = size;
    this.half = size / 2;
    this.textureKey = textureKey || null;
    // 从全局缓存取贴图实例（未加载完成时绘制会自然 fallback 到橙色顶面）
    this.texEntry = this.textureKey ? loadTexture(this.textureKey) : null;
  }

  get img() { return this.texEntry ? this.texEntry.img : null; }
  get imgLoaded() { return this.texEntry ? this.texEntry.loaded : false; }

  /**
   * 判断点是否落在平台范围内（含容差）
   */
  contains(px, py, tol) {
    return Math.abs(px - this.x) <= this.half + tol && Math.abs(py - this.y) <= this.half + tol;
  }
}

class PlatformManager {
  constructor(cx, cy) {
    this.platforms = [];
    this.currentIndex = 0;
    // 首块平台固定大小，居中生成，随机贴图
    this.platforms.push(new Platform(cx, cy, 84, this._pickTexture()));
    while (this.platforms.length < CONFIG.PLATFORM.PRE_SPAWN) {
      this.spawnNext();
    }
  }

  /**
   * 预加载所有配置中的平台贴图，返回 Promise。
   * 首次启动游戏前调用，避免首屏平台因图片未加载而显示橙色顶面。
   * 所有图片「无论成败」都算完成，另加超时兜底，绝不阻塞游戏启动。
   */
  static preloadTextures(timeoutMs) {
    const list = CONFIG.PLATFORM.TEXTURES || [];
    if (list.length === 0) return Promise.resolve();

    // 先全部触发加载，登记到全局缓存
    list.forEach(loadTexture);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      function check() {
        const all = list.map(loadTexture);
        if (all.every((e) => e.done)) return finish();
        setTimeout(check, 30);
      }
      check();

      // 超时兜底：个别图片加载失败/过慢时最多等待 timeoutMs，之后照常启动
      // （手机弱网下适当放宽，避免贴图还没到就开局）
      setTimeout(finish, timeoutMs || 15000);
    });
  }

  /**
   * 从配置中随机选一张平台贴图
   */
  _pickTexture() {
    const list = CONFIG.PLATFORM.TEXTURES;
    if (!list || list.length === 0) return null;
    return list[randInt(0, list.length - 1)];
  }

  get current() {
    return this.platforms[this.currentIndex];
  }

  get next() {
    return this.platforms[this.currentIndex + 1] || null;
  }

  /**
   * 在末尾随机生成一块新平台：
   * 相对上一块向下（dy > 0），水平偏移 dx 随机，中心距离 dist 随机，大小随机，贴图随机
   */
  spawnNext() {
    const last = this.platforms[this.platforms.length - 1];
    const dist = rand(CONFIG.PLATFORM.MIN_DIST, CONFIG.PLATFORM.MAX_DIST);
    const dx = rand(-CONFIG.PLATFORM.MAX_DX, CONFIG.PLATFORM.MAX_DX);
    const dy = Math.sqrt(dist * dist - dx * dx);
    const size = randInt(CONFIG.PLATFORM.MIN_SIZE, CONFIG.PLATFORM.MAX_SIZE);
    this.platforms.push(new Platform(last.x + dx, last.y + dy, size, this._pickTexture()));
  }

  /**
   * 跳到下一块平台，并补充预生成、裁剪历史平台
   */
  advance() {
    this.currentIndex += 1;
    while (this.platforms.length < this.currentIndex + CONFIG.PLATFORM.PRE_SPAWN) {
      this.spawnNext();
    }
    const keepFrom = Math.max(0, this.currentIndex - CONFIG.PLATFORM.CULL_KEEP);
    if (keepFrom > 0) {
      this.platforms.splice(0, keepFrom);
      this.currentIndex -= keepFrom;
    }
  }

  /**
   * 仅绘制视口范围内的平台（裁剪优化）
   * 立体效果：完整等距立方体 —— 顶面贴图 + 前/后/左/右四个侧面，避免镂空
   * 绘制顺序：后面 -> 左/右侧面 -> 前面 -> 顶面（画家算法）
   */
  draw(ctx, cam) {
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i];
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (sx < -p.size || sx > cam.w + p.size || sy < -p.size || sy > cam.h + p.size) continue;

      const s = p.half;
      const k = p.size * 0.30;   // 顶面斜向投影偏移（平行四边形斜切量）
      const kx = k / 2;
      const t = p.size * 0.28;   // 立方体高度（厚度）

      // 顶面平行四边形四个顶点（中心保持在平台中心 sx, sy）
      const ax = sx - s - kx, ay = sy - s - kx;   // 左上（远）
      const bx = sx + s - kx, by = sy - s - kx;   // 右上（远）
      const cx = sx + s + kx, cy = sy - s + kx;   // 右下（近）
      const dx = sx - s + kx, dy = sy - s + kx;   // 左下（近）

      const hasImg = p.img && (p.imgLoaded || (p.img.complete && p.img.width > 0));
      // 侧面以白色为主、略带阴影：朝向相机的最白，远离相机的微微加深（差距很小，保留柔和立体感）
      const sideBack  = '#ebebeb';
      const sideLeft  = '#f7f7f7';
      const sideRight = '#f2f2f2';
      const sideFront = '#ffffff';

      // 1. 后面（最暗，远离相机）
      ctx.fillStyle = sideBack;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx, by + t);
      ctx.lineTo(ax, ay + t);
      ctx.closePath();
      ctx.fill();

      // 2. 左侧面
      ctx.fillStyle = sideLeft;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(dx, dy);
      ctx.lineTo(dx, dy + t);
      ctx.lineTo(ax, ay + t);
      ctx.closePath();
      ctx.fill();

      // 3. 右侧面（较暗）
      ctx.fillStyle = sideRight;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + t);
      ctx.lineTo(bx, by + t);
      ctx.closePath();
      ctx.fill();

      // 4. 前面（朝向相机，最亮）
      ctx.fillStyle = sideFront;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + t);
      ctx.lineTo(dx, dy + t);
      ctx.closePath();
      ctx.fill();

      // 5. 顶面：先铺一层平台本色底色（避免透明贴图/表情包白底露侧面），再叠加贴图
      ctx.fillStyle = CONFIG.COLOR.PLATFORM_TOP;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();

      if (hasImg) {
        // 将贴图矩形斜切映射到顶面平行四边形
        ctx.save();
        ctx.setTransform(1, 0, k / p.size, k / p.size, ax, ay);
        ctx.drawImage(p.img, 0, 0, p.size, p.size);
        ctx.restore();
      }
    }
  }
}

module.exports = { Platform, PlatformManager };

  },
  "js/player": function (module, exports, require) {
/**
 * player.js - 小人物理与状态机
 * 状态：待机(IDLE) -> 蓄力(CHARGING) -> 跳跃(JUMPING) -> 落地(LANDING) -> 待机
 *       跳跃落空后进入坠落(FALLING)
 * 物理：蓄力时长 -> 跳跃距离；跳跃为带弧线的缓动插值；坠落为重力加速
 * 动画：鬼畜奶龙 16 帧逐帧播放
 *   - 蓄力：帧 1~5（按下后逐帧推进，蓄满停在 5）
 *   - 跳跃：帧 6~12（飞行期间逐帧推进）
 *   - 落地：帧 13~16（落地后逐帧推进，结束 = 帧 1 = 待机）
 *   - 坠落：保持当前帧（不切换）
 */
const CONFIG = require('./config');
const { clamp, fillRoundRect } = require('./utils');

const STATE = {
  IDLE: 0,
  CHARGING: 1,
  JUMPING: 2,
  LANDING: 3,
  FALLING: 4
};

// 各阶段帧序列（1-based，绘制时转 0-based）
const FRAME_SEQ = {
  IDLE:     [1],
  CHARGE:   [1, 2, 3, 4, 5],
  JUMP:     [6, 7, 8, 9, 10, 11, 12],
  LAND:     [13, 14, 15, 16]
};

class Player {
  constructor(x, y) {
    this.onLand = null; // 落地回调，由 game.js 注入

    // 加载全部 16 帧（透明 PNG）
    this.frames = CONFIG.PLAYER.FRAMES.map((src) => {
      const img = wx.createImage();
      img.src = src;
      return img;
    });
    // 兼容 fallback：单张图
    this.img = this.frames[0];

    this.reset(x, y);
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.state = STATE.IDLE;
    this.chargeStart = 0;
    this.chargeRatio = 0;
    this.jumpFrom = { x: 0, y: 0 };
    this.jumpVec = { x: 0, y: -1 };
    this.jumpNormal = { x: 0, y: -1 };
    this.jumpDur = 0;
    this.jumpT = 0;
    this.arcHeight = 0;
    this.vy = 0;
    this.rot = 0;

    // 帧动画状态
    this.frameSeq = FRAME_SEQ.IDLE.slice();
    this.frameIdx = 0;        // 当前在帧序列里的位置
    this.frameTimer = 0;      // 当前帧已停留时间（秒）
    this.frameInterval = 0;   // 每帧时长（秒）
    this.currentFrame = 1;    // 当前正在显示的帧号（1-based）
    this.landT = 0;           // 落地阶段已用总时长（秒）
    this._applyFrameSequence();
  }

  /**
   * 应用当前帧序列，并按状态设置帧间隔
   */
  _applyFrameSequence() {
    if (this.state === STATE.CHARGING) {
      this.frameInterval = CONFIG.PLAYER.FRAME_INTERVAL.CHARGE;
    } else if (this.state === STATE.JUMPING) {
      this.frameInterval = CONFIG.PLAYER.FRAME_INTERVAL.JUMP;
    } else if (this.state === STATE.LANDING) {
      this.frameInterval = CONFIG.PLAYER.FRAME_INTERVAL.LAND;
    } else {
      this.frameInterval = 0;
    }
  }

  /**
   * 根据当前帧序列推进帧号
   */
  _advanceFrame(dt) {
    if (this.frameSeq.length === 0 || this.frameInterval <= 0) return;
    this.frameTimer += dt;
    while (this.frameTimer >= this.frameInterval) {
      this.frameTimer -= this.frameInterval;
      if (this.frameIdx < this.frameSeq.length - 1) {
        this.frameIdx++;
      } else {
        // 已到序列末尾：蓄力停在最后一帧；其它状态保持
        this.frameTimer = 0;
        break;
      }
    }
    this.currentFrame = this.frameSeq[this.frameIdx];
  }

  /**
   * 重置帧序列到指定状态（用于状态切换时重新播放）
   */
  _setSequence(seqName) {
    this.frameSeq = FRAME_SEQ[seqName].slice();
    this.frameIdx = 0;
    this.frameTimer = 0;
    this.currentFrame = this.frameSeq[0];
  }

  /**
   * 落地后安置到指定坐标，进入 LANDING 动画，结束后回到 IDLE
   */
  place(x, y) {
    this.x = x;
    this.y = y;
    this.state = STATE.LANDING;
    this.vy = 0;
    this.rot = 0;
    this.chargeRatio = 0;
    this.landT = 0;
    this._setSequence('LAND');
    this._applyFrameSequence();
  }

  /**
   * 点击开始蓄力（仅待机时可触发）
   */
  startCharge() {
    if (this.state !== STATE.IDLE) return false;
    this.state = STATE.CHARGING;
    this.chargeStart = Date.now();
    this._setSequence('CHARGE');
    this._applyFrameSequence();
    return true;
  }

  /**
   * 触摸被打断（来电/手势取消）时取消蓄力，回到待机
   */
  cancelCharge() {
    if (this.state === STATE.CHARGING) {
      this.state = STATE.IDLE;
      this.chargeRatio = 0;
      this._setSequence('IDLE');
    }
  }

  /**
   * 松手：按蓄力时长换算跳跃距离（与当前平台间距 len 挂钩）与弧线参数
   * @param {number} dirX 朝向下一平台的单位方向
   * @param {number} dirY
   * @param {number} targetLen 到下一平台中心的距离（px）
   */
  release(dirX, dirY, targetLen) {
    if (this.state !== STATE.CHARGING) return null;
    const held = (Date.now() - this.chargeStart) / 1000;
    const ratio = clamp(held / CONFIG.CHARGE.MAX_TIME, 0, 1);
    const dist = targetLen * (CONFIG.CHARGE.MIN_RATIO
      + (CONFIG.CHARGE.MAX_RATIO - CONFIG.CHARGE.MIN_RATIO) * ratio);

    this.jumpFrom = { x: this.x, y: this.y };
    this.jumpVec = { x: dirX * dist, y: dirY * dist };

    // 弧线法线：取飞行方向垂直、且朝屏幕上方的一侧
    let nx = 0;
    let ny = -1;
    if (Math.abs(dirX) > 0.001) {
      const s = dirX > 0 ? 1 : -1;
      nx = dirY * s;
      ny = -dirX * s;
    }
    this.jumpNormal = { x: nx, y: ny };

    this.arcHeight = CONFIG.FLIGHT.ARC * (0.5 + ratio * 0.5);
    this.jumpDur = CONFIG.FLIGHT.DURATION_MIN
      + (CONFIG.FLIGHT.DURATION_MAX - CONFIG.FLIGHT.DURATION_MIN) * ratio;
    this.jumpT = 0;
    this.state = STATE.JUMPING;
    this.chargeRatio = ratio;
    this._setSequence('JUMP');
    this._applyFrameSequence();
    return { dist: dist, vecX: this.jumpVec.x, vecY: this.jumpVec.y };
  }

  /**
   * 落空后进入坠落（游戏结束表现）
   */
  beginFall() {
    if (this.state === STATE.FALLING) return;
    // 落空时不打断 LANDING/JUMPING —— 若跳跃还未完成动画直接判落空，
    // 仍然进入 FALLING 并使用最后那一帧（看起来像还在空中翻滚）
    this.state = STATE.FALLING;
    this.vy = 0;
    this.rot = 0;
    this._applyFrameSequence();
  }

  /**
   * 物理 + 帧动画更新
   */
  update(dt) {
    if (this.state === STATE.JUMPING) {
      this.jumpT += dt;
      this._advanceFrame(dt);
      const u = clamp(this.jumpT / this.jumpDur, 0, 1);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // easeInOutQuad
      const arc = this.arcHeight * 4 * u * (1 - u);
      this.x = this.jumpFrom.x + this.jumpVec.x * e + this.jumpNormal.x * arc;
      this.y = this.jumpFrom.y + this.jumpVec.y * e + this.jumpNormal.y * arc;
      if (u >= 1) {
        // 跳跃动画播完，切换到 LANDING；由 game.js 的 onLand 回调决定最终落点
        this.state = STATE.LANDING;
        this._setSequence('LAND');
        this._applyFrameSequence();
        if (this.onLand) this.onLand();
      }
    } else if (this.state === STATE.CHARGING) {
      this.chargeRatio = clamp((Date.now() - this.chargeStart) / 1000 / CONFIG.CHARGE.MAX_TIME, 0, 1);
      this._advanceFrame(dt);
    } else if (this.state === STATE.LANDING) {
      this._advanceFrame(dt);
      this.landT += dt;
      // 落地序列播完（13→16），用总时长控制回到待机，避免 _advanceFrame 把 frameTimer 重置导致退出条件失效
      const landDur = this.frameInterval * this.frameSeq.length;
      if (this.landT >= landDur) {
        this.state = STATE.IDLE;
        this._setSequence('IDLE');
      }
    } else if (this.state === STATE.FALLING) {
      this.vy += CONFIG.FALL.GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += CONFIG.FALL.DRIFT * dt;
      this.rot += 4 * dt;
      // 不推进帧，保持最后姿态
    }
  }

  /**
   * 绘制小人：按 currentFrame 选择对应帧贴图
   */
  draw(ctx, cam, now) {
    const sx = this.x - cam.x;
    const sy = this.y - cam.y;
    if (sx < -120 || sx > cam.w + 120 || sy < -160 || sy > cam.h + 120) return;

    const jumpP = this.state === STATE.JUMPING ? clamp(this.jumpT / this.jumpDur, 0, 1) : 0;

    // 地面影子（跳跃时缩小变淡）
    ctx.save();
    ctx.translate(sx, sy + 8);
    ctx.scale(1, 0.32);
    ctx.fillStyle = 'rgba(70, 60, 40, ' + (0.16 * (1 - jumpP * 0.6)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(0, 0, 18 * (1 - jumpP * 0.25), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 角色贴图绘制
    ctx.save();
    ctx.translate(sx, sy);
    if (this.state === STATE.FALLING) ctx.rotate(this.rot);

    let scX = 1;
    let scY = 1;
    if (this.state === STATE.CHARGING) {
      // 蓄力时仍保留轻微「压扁」反馈，但比之前更克制，避免压扁变形太突兀
      scX = 1 + 0.06 * this.chargeRatio;
      scY = 1 - 0.08 * this.chargeRatio;
    } else if (this.state === STATE.JUMPING) {
      scX = 0.95;
      scY = 1.06;
    }
    ctx.scale(scX, scY);

    // 选帧：currentFrame 是 1-based；优先用帧数组，未加载完成 fallback 到首张
    const frameImg = this.frames[this.currentFrame - 1];
    const useImg = frameImg && frameImg.complete && frameImg.width > 0;
    if (useImg) {
      const ratio = frameImg.width / frameImg.height;
      const h = CONFIG.PLAYER.HEIGHT;
      const w = h * ratio;
      // 锚点在底部中心，图片从 (x - w/2, y - h) 开始绘制
      ctx.drawImage(frameImg, -w / 2, -h, w, h);
    } else {
      // fallback：贴图未就绪时仍用原来的几何小人，避免首帧白屏
      drawFallbackPlayer(ctx);
    }
    ctx.restore();
  }
}

/**
 * 贴图未加载完成时的兜底几何小人，保持原有外观
 */
function drawFallbackPlayer(ctx) {
  // 身体
  fillRoundRect(ctx, -11, -28, 22, 28, 7, CONFIG.COLOR.PLAYER_BODY);
  // 头
  ctx.fillStyle = CONFIG.COLOR.PLAYER_HEAD;
  ctx.beginPath();
  ctx.arc(0, -40, 14, 0, Math.PI * 2);
  ctx.fill();
  // 眼睛
  ctx.fillStyle = CONFIG.COLOR.PLAYER_EYE;
  ctx.beginPath();
  ctx.arc(-5, -42, 3, 0, Math.PI * 2);
  ctx.arc(5, -42, 3, 0, Math.PI * 2);
  ctx.fill();
  // 腮红
  ctx.fillStyle = CONFIG.COLOR.PLAYER_BLUSH;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(-11, -36, 3, 0, Math.PI * 2);
  ctx.arc(11, -36, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

module.exports = Player;
  },
  "js/score": function (module, exports, require) {
/**
 * score.js - 计分与最高分持久化
 * 最高分通过 wx 本地缓存保存，跨游戏局保留
 */
const CONFIG = require('./config');

const BEST_KEY = 'jump_jump_best_score';

class ScoreManager {
  constructor() {
    this.score = 0;
    this.best = 0;
    try {
      const v = wx.getStorageSync(BEST_KEY);
      this.best = typeof v === 'number' ? v : 0;
    } catch (e) {
      this.best = 0; // 存储不可用不影响游戏
    }
    this.startBest = this.best;
  }

  /**
   * 得分 +1，并同步刷新历史最高（HUD 显示用）。
   * 返回是否打破纪录：仅当本局得分**首次跨过**本局开始时的历史最高
   * （startBest）时返回 true，之后同局内不再重复触发，
   * 直到用户失败重开、再次刷新纪录。
   */
  add() {
    this.score += 1;
    if (this.score > this.best) this.best = this.score;
    return this.score === this.startBest + 1;
  }

  reset() {
    this.score = 0;
    this.startBest = this.best; // 本局破纪录基准：开局时固定的历史最高
  }

  save() {
    try {
      wx.setStorageSync(BEST_KEY, this.best);
    } catch (e) {
      // 忽略写入失败
    }
  }

  /**
   * 绘制 HUD：左上角本局分数，右上角历史最高
   */
  draw(ctx, W) {
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = CONFIG.COLOR.TEXT;
    ctx.fillText('分数 ' + this.score, 20, 22);
    ctx.textAlign = 'right';
    ctx.font = '15px sans-serif';
    ctx.fillStyle = CONFIG.COLOR.TEXT_SUB;
    ctx.fillText('最高 ' + this.best, W - 20, 26);
  }
}

module.exports = ScoreManager;

  },
  "js/audio": function (module, exports, require) {
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

  }
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
