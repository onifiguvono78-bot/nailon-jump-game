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
