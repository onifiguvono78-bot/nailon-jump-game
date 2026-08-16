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
