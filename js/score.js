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
