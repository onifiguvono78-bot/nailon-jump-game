# 项目自查报告 · 仿跳一跳微信小游戏

- **项目**：`game_jump`
- **自查时间**：2026-08-12
- **自查方式**：静态检查 + Node mock 环境端到端运行验证（脚本：`tools/self_test.js`，可随时复跑）

## 一、检查项与结果

| 检查项 | 工具/方法 | 结果 |
| --- | --- | --- |
| JS 语法（6 个文件） | `node --check` | ✅ 全部通过 |
| 配置文件格式（game.json / project.config.json） | JSON 解析校验 | ✅ 合法 |
| 小游戏 API 合规 | 静态扫描 wx API 清单 | ✅ 仅使用小游戏 API |
| DOM/BOM 误用检查 | 扫描 document/window/getElementById 等 | ✅ 无误用 |
| 模块化规范 | require 依赖图核查 | ✅ 单向依赖、无循环引用 |
| 运行时逻辑 | Node mock 环境端到端跑局 | ✅ 18/18 断言通过 |

## 二、API 合规明细

使用的 wx API（全部为微信小游戏标准接口）：

```
wx.createCanvas        wx.getWindowInfo（含 getSystemInfoSync 回退）
wx.onTouchStart        wx.onTouchEnd
wx.onTouchCancel       wx.getStorageSync / wx.setStorageSync
```

渲染仅依赖 Canvas 2D 基础方法（fillRect / arc / arcTo / fillText 等），
圆角矩形为 `arcTo` 手绘实现，**不依赖** `ctx.roundRect`，兼容旧基础库。
主循环使用全局 `requestAnimationFrame`，无 DOM 依赖。

## 三、自查发现并修复的问题

### 问题 1（玩法缺陷，已修复）：固定跳跃距离与随机平台间距不匹配

- **现象**：原方案跳跃距离固定为 30~260px，而相邻平台中心距随机为 130~220px。
  由于跳跃方向固定指向下一平台，**满蓄力（260px）在平台间距较小时会越过平台落空**，
  即"蓄力越久反而越容易死"，节奏无法掌握。
- **修复**：跳跃距离改为与当前间距 `len` 挂钩的动态映射
  `dist = len × (MIN_RATIO + (MAX_RATIO − MIN_RATIO) × 蓄力比例)`（`MIN_RATIO=0.5`，`MAX_RATIO=1.5`）。
  蓄力 50% 恰好落在平台中心；轻点（不足）与蓄满（过头）都会落空，成功窗口随间距自适应，可玩性合理。
- **涉及文件**：`js/config.js`、`js/player.js`、`game.js`、`README.md`
- **验证**：自检第 3/3b 步端到端确认——蓄力 50% 得分并持久化最高分；轻点 30ms 落空触发游戏结束。

### 问题 2（测试脚本问题，已修正）：最高分断言逻辑错误

- 自检脚本首版在 mock 历史最高分为 7 时仅加 2 分，断言"写入新最高分 8"必然失败。
- 改为可变 mock 存储，端到端验证"得分 → 结算 → 最高分持久化 → 重启读取"全链路，断言全部通过。

## 四、运行时自检覆盖点（18/18 通过）

1. 主循环经 requestAnimationFrame 正常启动，touch 事件注册成功；
2. 平台预生成数量 ≥ 3，相邻间距均在 [130, 220] 且严格向下生成（y 递增）；
3. 蓄力→跳跃→落地得分链路端到端成立（最高分持久化可观测）；
4. 落空→坠落→游戏结束→点击重启链路正常；
5. Player 状态机：IDLE 进入蓄力、重复蓄力被拒绝、取消蓄力回 IDLE；
6. 跳跃距离随蓄力时长按公式连续映射（误差 < 1e-6），跳跃结束回调 onLand 并复位；
7. 计分模块：历史最高分读取、连得分数、超纪录持久化、reset 清零。

## 五、结论

项目代码通过全部静态与运行时自查，未发现遗留问题。
开发者工具导入后可直接编译运行（AppID 用测试号即可）。
