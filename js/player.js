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