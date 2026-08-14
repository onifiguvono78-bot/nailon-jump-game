/**
 * self_test.js - 端到端逻辑自检（在 Node 中 mock wx/canvas 环境）
 * 验证：平台生成参数、蓄力->跳跃->落地得分、落空->游戏结束
 */
'use strict';

/* ---------- mock 环境 ---------- */
const ctxProxy = new Proxy({}, {
  get: (t, k) => {
    if (typeof k === 'symbol') return undefined;
    return (t[k] !== undefined) ? t[k] : (() => {});
  },
  set: (t, k, v) => { t[k] = v; return true; }
});
const canvasObj = { getContext: () => ctxProxy };
let storedBest = 0;   // 可变 mock 存储：得分链路可被端到端观测
let bestSaved = null;
global.wx = {
  createCanvas: () => canvasObj,
  createImage: () => ({ src: '', complete: false, width: 0, height: 0 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  getWindowInfo: undefined,            // 强制走 getSystemInfoSync 回退分支
  getStorageSync: () => storedBest,
  setStorageSync: (k, v) => { storedBest = v; bestSaved = v; },
  onTouchStart: (cb) => { global.__touchStart = cb; },
  onTouchEnd: (cb) => { global.__touchEnd = cb; },
  onTouchCancel: () => {}
};

let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

let now = 375 * 1000; // mock 时间戳
const RealDateNow = Date.now;
Date.now = () => now;

require('../game.js');

/* ---------- 内部状态 ---------- */
const sleep = (ms) => { now += ms; };
const step = (frames, msPerFrame) => {
  for (let i = 0; i < frames; i++) {
    sleep(msPerFrame);
    const cb = rafCb;
    rafCb = null;
    if (!cb) break;
    cb(now);
  }
};

/* ---------- 断言工具 ---------- */
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  [PASS] ' + msg); }
  else { failed++; console.log('  [FAIL] ' + msg); }
}

/* ---------- 1. 模块加载与启动 ---------- */
console.log('== 1. 模块加载 / 游戏启动 ==');
assert(rafCb !== null, '主循环已通过 requestAnimationFrame 启动');
assert(typeof global.__touchStart === 'function', 'touchstart 事件已注册');
assert(typeof global.__touchEnd === 'function', 'touchend 事件已注册');

/* ---------- 2. 平台生成参数校验（读模块直接验证） ---------- */
console.log('== 2. 平台生成参数 ==');
const CONFIG = require('../js/config');
const { PlatformManager } = require('../js/platforms');
const pm = new PlatformManager(187.5, 466.9);
assert(pm.platforms.length >= CONFIG.PLATFORM.PRE_SPAWN, '预生成平台数 >= ' + CONFIG.PLATFORM.PRE_SPAWN);
let distOk = true, downOk = true;
for (let i = 1; i < pm.platforms.length; i++) {
  const a = pm.platforms[i - 1], b = pm.platforms[i];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < CONFIG.PLATFORM.MIN_DIST || d > CONFIG.PLATFORM.MAX_DIST) distOk = false;
  if (b.y <= a.y) downOk = false; // 必须向下生成
}
assert(distOk, '相邻平台间距均在 [' + CONFIG.PLATFORM.MIN_DIST + ', ' + CONFIG.PLATFORM.MAX_DIST + '] 内');
assert(downOk, '平台均向下生成（y 递增）');

/* ---------- 3. 物理与落地判定（跑整局） ---------- */
console.log('== 3. 蓄力->跳跃->落地得分 ==');
step(5, 16);              // 先跑几帧稳定相机
global.__touchStart({});  // 开始蓄力
sleep(600);               // 蓄力 0.6s = 50% -> 距离 = 当前间距 -> 命中下一平台顶面中心
global.__touchEnd({});    // 松手
step(90, 16);             // 推进 ~1.4s 完成跳跃
const snap1 = global.__gameSnapshot();
assert(snap1.score === 1, '蓄力 50% 精确命中下一平台，得分 +1');

console.log('== 3b. 落空判定（200ms 中等蓄力应跳到两平台之间并触发游戏结束） ==');
// 人物现在站在当前平台顶面中心；30ms 轻点只会落在同一平台顶面上。
// 改为 200ms（ratio≈0.167，dist≈0.667*len）：越过当前平台、又未到下一平台，必然落空。
global.__touchStart({});
sleep(200);
global.__touchEnd({});
step(120, 16); // 推进 ~2s：跳跃 + 坠落 + 结算 save
const snap2 = global.__gameSnapshot();
assert(snap2.state === 1 && bestSaved === 1, '中等蓄力落空后进入游戏结束，并将最高分持久化为 1');

/* ---------- 4. 游戏结束后点击重启 ---------- */
console.log('== 4. 结束后重启 ==');
step(30, 16); // 坠落动画
global.__touchStart({}); // 点击屏幕触发 initGame 重启
global.__touchEnd({});
step(5, 16);
const snap3 = global.__gameSnapshot();
assert(snap3.state === 0 && rafCb !== null, '重启后主循环仍在运行且游戏状态为 RUNNING');

/* ---------- 5. Player 状态机单元验证 ---------- */
console.log('== 5. Player 状态机 ==');
const Player = require('../js/player');
const p = new Player(100, 200);
assert(p.startCharge() === true, 'IDLE 可进入蓄力');
assert(p.startCharge() === false, '蓄力中不可重复蓄力');
p.cancelCharge();
assert(p.state === 0, '取消蓄力后回到 IDLE');
p.startCharge();
sleep(800); // 0.8s -> ratio 0.667
const rel = p.release(0, 1, 200); // 朝正下方跳，当前间距 200
assert(rel && rel.dist > 200 * CONFIG.CHARGE.MIN_RATIO && rel.dist < 200 * CONFIG.CHARGE.MAX_RATIO, '跳跃距离 = 当前间距 × 比例，落在区间内');
const expected = 200 * (CONFIG.CHARGE.MIN_RATIO + (CONFIG.CHARGE.MAX_RATIO - CONFIG.CHARGE.MIN_RATIO) * (0.8 / CONFIG.CHARGE.MAX_TIME));
assert(Math.abs(rel.dist - expected) < 1e-6, '跳跃距离 = 蓄力时长映射公式（误差 < 1e-6）');
let landed = false;
p.onLand = () => { landed = true; };
for (let i = 0; i < 60; i++) p.update(1 / 60);
assert(landed && p.state === 0, '跳跃结束后回调 onLand 并回到 IDLE');

/* ---------- 6. 计分模块 ---------- */
console.log('== 6. 计分与持久化 ==');
const ScoreManager = require('../js/score');
const sm = new ScoreManager();
assert(sm.best === 1, '读取到上一局持久化的历史最高分 1');
sm.add(); sm.add();
assert(sm.score === 2, '连得两分');
sm.save();
assert(bestSaved === 2 && sm.best === 2, 'score(2) > best(1) 时 save 写入新最高分 2');
sm.reset();
assert(sm.score === 0, 'reset 清零本局分数');
// 恢复 mock 存储，避免重复运行测试时 best 期望错位
storedBest = 0;
bestSaved = null;

/* ---------- 汇总 ---------- */
console.log('----------------------------------------');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
process.exit(failed > 0 ? 1 : 0);
