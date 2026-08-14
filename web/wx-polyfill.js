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
  document.body.appendChild(canvas);

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
