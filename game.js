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
