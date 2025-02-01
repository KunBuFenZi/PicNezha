const express = require("express");
const serverless = require("serverless-http");
const axios = require("axios");
const { createCanvas, registerFont } = require("canvas");
const { Canvas, FontLibrary } = require("skia-canvas");
const moment = require("moment");
const path = require("path");

const app = express();
const port = 3000;

// 针对netlify的特殊设置
let currentDir = __dirname;
if (currentDir.includes(".netlify/functions-serve/app")) {
  var netlify = true;
  console.log("现在在netlify中运行，当前目录：" + currentDir);
  currentDir = currentDir.replace(".netlify/functions-serve/app", "");
}
// 注册字体
// FontLibrary.use("WQY-ZenHei", __dirname + "/wqy-zenhei.ttc");
FontLibrary.use("WQY-ZenHei", currentDir + "/wqy-zenhei.ttc");
// FontLibrary.use("Noto Color Emoji", __dirname + "/NotoColorEmoji.ttf");
FontLibrary.use("Segoe UI Emoji", currentDir + "/seguiemj.ttf");

// 添加配置变量
const config = {
  SERVERS_PER_ROW: parseInt(process.env.SERVERS_PER_ROW) || 2, // 每行显示服务器数量
  MIN_WIDTH: 350,  // 最小宽度
  MIN_HEIGHT: 100, // 最小高度
  PADDING: 10,     // 卡片间距
  TEXT_LINE_HEIGHT: 20 // 文本行高
};

// 添加登录认证函数
async function authenticate(apiUrl, username, password) {
  const response = await axios.post(`${apiUrl}/api/v1/login`, {
    username: username,
    password: password
  });
  
  if (response.data.success) {
    return response.data.data.token;
  }
  throw new Error('认证失败');
}

// 添加计算文本尺寸的函数
function measureServerCard(ctx, server) {
  const textLines = [
    `${server.name} ${server.statusText}`,
    `🖥️ ${server.host.Platform}`,
    `📍 ${server.host.CountryCode}`,
    `⏱️ Uptime: ${moment.duration(server.status.Uptime, "seconds").humanize()}`,
    "💻 CPU:",
    "🧠 RAM:",
    "总下载:",
    "总上传:"
  ];
  
  // 计算最大文本宽度
  let maxWidth = 0;
  textLines.forEach(line => {
    const metrics = ctx.measureText(line);
    maxWidth = Math.max(maxWidth, metrics.width);
  });
  
  // 考虑进度条和数值的宽度
  const totalWidth = Math.max(maxWidth + 250, config.MIN_WIDTH); // 250px 用于进度条和其他元素
  const totalHeight = Math.max(textLines.length * config.TEXT_LINE_HEIGHT, config.MIN_HEIGHT);
  
  return { width: totalWidth, height: totalHeight };
}

// 在 /status 路由中使用
app.get("/status", async (req, res) => {
  try {
    const apiUrl = process.env.API_URL?.replace(/\/$/, "");
    const token = await authenticate(apiUrl, process.env.USERNAME, process.env.PASSWORD);
    
    const response = await axios.get(`${apiUrl}/api/v1/server`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.data.success) {
      throw new Error(response.data.message || "API request failed");
    }

    // 解析服务器数据
    const servers = response.data.data.map(server => ({
      name: server.name || "未知",
      statusText: isOnline(server) ? "❇️在线" : "❌离线",
      host: {
        Platform: server.host?.platform || "未知",
        PlatformVersion: server.host?.version || "",
        CountryCode: server.geoip?.country_code || "UN",
        MemTotal: server.host?.mem_total || 1,
      },
      status: {
        CPU: server.state?.cpu || 0,
        MemUsed: server.state?.mem_used || 0,
        Uptime: server.state?.uptime || 0,
        NetInTransfer: server.state?.net_in_transfer || 0,
        NetOutTransfer: server.state?.net_out_transfer || 0,
      }
    }));

    // 创建临时 Canvas 用于测量
    const measureCanvas = new Canvas(1, 1);
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = 'bold 16px "Segoe UI Emoji", "WQY-ZenHei"';

    // 预先计算每个服务器卡片的尺寸
    let maxCardWidth = 0;
    let maxCardHeight = 0;
    
    servers.forEach(server => {
      const dims = measureServerCard(measureCtx, server);
      maxCardWidth = Math.max(maxCardWidth, dims.width);
      maxCardHeight = Math.max(maxCardHeight, dims.height);
    });
    
    // 更新配置
    config.SERVER_WIDTH = maxCardWidth + config.PADDING * 2;
    config.SERVER_HEIGHT = maxCardHeight + config.PADDING * 2;
    
    // 计算画布尺寸
    const rows = Math.ceil(servers.length / config.SERVERS_PER_ROW);
    const canvasWidth = config.SERVER_WIDTH * config.SERVERS_PER_ROW + config.PADDING * (config.SERVERS_PER_ROW + 1);
    const canvasHeight = config.SERVER_HEIGHT * rows + 90 + config.PADDING * (rows + 1);

    // 创建实际绘图用的画布
    let canvas = new Canvas(canvasWidth, canvasHeight);
    let ctx = canvas.getContext("2d");
    ctx.textDrawingMode = "glyph";

    // 背景纯色（注释掉会变透明）
    // ctx.fillStyle = "#ffffff";
    // ctx.fillRect(0, 0, 800, canvas.height);

    // 背景卡片
    const cardX = 10;
    const cardY = 10;
    const cardWidth = canvas.width - 20;
    const cardHeight = canvas.height - 20;
    const borderRadius = 16;

    // 阴影设置
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)"; // 阴影颜色
    ctx.shadowBlur = 10; // 模糊程度

    // 30度角渐变
    const angle = Math.PI / 6;
    const d = (cardHeight - cardWidth * Math.tan(angle)) / 2;
    const startY = cardY + d;
    const endY = cardY + cardHeight - d;

    // 创建渐变颜色
    const gradient = ctx.createLinearGradient(
      cardX,
      startY,
      cardX + cardWidth,
      endY
    );
    gradient.addColorStop(0, "#f5f9fa");
    gradient.addColorStop(0.5, "#ecf9f6");
    gradient.addColorStop(1, "#f5f9fa");

    // 绘制圆角卡片
    ctx.beginPath();
    ctx.moveTo(cardX + borderRadius, cardY);
    ctx.lineTo(cardX + cardWidth - borderRadius, cardY);
    ctx.quadraticCurveTo(
      cardX + cardWidth,
      cardY,
      cardX + cardWidth,
      cardY + borderRadius
    );
    ctx.lineTo(cardX + cardWidth, cardY + cardHeight - borderRadius);
    ctx.quadraticCurveTo(
      cardX + cardWidth,
      cardY + cardHeight,
      cardX + cardWidth - borderRadius,
      cardY + cardHeight
    );
    ctx.lineTo(cardX + borderRadius, cardY + cardHeight);
    ctx.quadraticCurveTo(
      cardX,
      cardY + cardHeight,
      cardX,
      cardY + cardHeight - borderRadius
    );
    ctx.lineTo(cardX, cardY + borderRadius);
    ctx.quadraticCurveTo(cardX, cardY, cardX + borderRadius, cardY);
    ctx.closePath();

    // 填充
    ctx.fillStyle = gradient;
    ctx.fill();

    // 重置阴影（防止后续影响）
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // 卡片 Header
    const headerHeight = 50;
    const headerGradient = ctx.createLinearGradient(
      cardX,
      cardY,
      cardX + cardWidth,
      cardY
    );
    headerGradient.addColorStop(0, "#88FDCD");
    headerGradient.addColorStop(1, "#95C4F5");

    // 绘制 Header 区域
    ctx.beginPath();
    ctx.moveTo(cardX + borderRadius, cardY); // 左上角圆角开始
    ctx.lineTo(cardX + cardWidth - borderRadius, cardY); // 顶边直线
    ctx.quadraticCurveTo(
      cardX + cardWidth,
      cardY,
      cardX + cardWidth,
      cardY + borderRadius
    ); // 右上角圆角
    ctx.lineTo(cardX + cardWidth, cardY + headerHeight); // 右侧直线
    ctx.lineTo(cardX, cardY + headerHeight); // 底边直线
    ctx.lineTo(cardX, cardY + borderRadius); // 左侧直线
    ctx.quadraticCurveTo(cardX, cardY, cardX + borderRadius, cardY); // 左上角圆角
    ctx.closePath();

    ctx.fillStyle = headerGradient;
    ctx.fill();

    // 绘制 Header 文本
    const headerText = process.env.TEXT || process.env.API_URL || "探针";
    ctx.fillStyle = "#000000";
    ctx.font = '20px "Segoe UI Emoji", "WQY-ZenHei", Arial';
    ctx.textBaseline = "middle"; // 垂直居中
    ctx.fillText(headerText, cardX + 20, cardY + headerHeight / 2);
    ctx.textBaseline = "alphabetic"; // 重置文本基线为对齐到标准字母基线

    servers.forEach((server, index) => {
      const row = Math.floor(index / config.SERVERS_PER_ROW);
      const col = index % config.SERVERS_PER_ROW;
      
      const x = config.PADDING + col * (config.SERVER_WIDTH + config.PADDING);
      const y = 90 + row * (config.SERVER_HEIGHT + config.PADDING);

      // 服务器名称和状态
      ctx.fillStyle = "#000";
      ctx.font = 'bold 16px "Segoe UI Emoji", "WQY-ZenHei"';
      ctx.fillText(`${server.name} ${server.statusText}`, x + 20, y);

      // 系统信息
      ctx.font = '14px "Segoe UI Emoji", "WQY-ZenHei", Arial';
      ctx.fillText(
        `🖥️ ${server.host.Platform}`,
        x + 20,
        y + 25
      );

      // 国家
      ctx.fillText(`📍 ${server.host.CountryCode}`, x + 20, y + 45);

      // Uptime
      ctx.fillText(
        `⏱️ Uptime: ${moment.duration(server.status.Uptime, "seconds").humanize()}`,
        x + 20,
        y + 65
      );

      // CPU Usage
      ctx.fillText("💻 CPU:", x + 180, y + 25);
      drawProgressBar(ctx, x + 235, y + 12, 120, server.status.CPU);

      // RAM Usage
      ctx.fillText("🧠 RAM:", x + 180, y + 55);
      const ramUsage = (server.status.MemUsed / server.host.MemTotal) * 100;
      drawProgressBar(ctx, x + 235, y + 42, 120, ramUsage);

      // 网络流量
      ctx.fillText("总下载:", 620, y + 25);
      ctx.fillText(formatBytes(server.status.NetInTransfer), 670, y + 25);

      ctx.fillText("总上传:", 620, y + 55);
      ctx.fillText(formatBytes(server.status.NetOutTransfer), 670, y + 55);
    });

    ctx.font = "10px Arial";
    ctx.fillStyle = "rgba(0, 0, 0, 0.54)";
    ctx.fillText(
      "Powered By PicNezha (https://github.com/SkyAerope/PicNezha)",
      canvas.width - 350,
      canvas.height - 20
    );

    const buffer = await canvas.toBuffer("image/png");
    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch (error) {
    console.error("Error:", error);
    // res.status(500).send("Error generating status page: " + error.message);
    let canvas = new Canvas(800, 200),
      ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffebee"; // 背景颜色：浅红色
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#b71c1c"; // 字体颜色：深红色
    ctx.font = 'bold 20px "Segoe UI Emoji", "WQY-ZenHei", Arial';
    ctx.fillText("生成图片出错", 50, 60);

    ctx.fillStyle = "#000000"; // 错误详情字体颜色
    ctx.font = '16px "Segoe UI Emoji", "WQY-ZenHei", Arial';

    const lines = wrapText(ctx, error.message, 700);
    lines.forEach((line, index) => {
      ctx.fillText(line, 50, 100 + index * 20);
    });

    const buffer = await canvas.toBuffer("image/png");
    res.set("Content-Type", "image/png");
    res.send(buffer);
  }
});

function isOnline(server) {
  const now = Date.now();
  const lastActive = new Date(server.last_active).getTime();
  return (now - lastActive) < 10000; // 10秒内认为在线
}

// 画进度条
function drawProgressBar(ctx, x, y, width, value) {
  const height = 15;
  const radius = height / 2; // 圆角半径（高度的一半）
  const progressWidth = width * (value / 100); // 根据进度计算宽度
  // 创建渐变
  const gradient = ctx.createLinearGradient(x, y, x + width, y); // 水平方向的渐变
  gradient.addColorStop(0, "#90c4fc"); // 起始颜色：浅蓝色
  gradient.addColorStop(1, "#ddc4fc"); // 结束颜色：淡紫色

  // 背景条
  ctx.fillStyle = "#e5e7eb"; // 背景颜色
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();

  // 进度条
  ctx.fillStyle = gradient;
  ctx.beginPath();
  if (value >= 5) {
    // 正常绘制圆角条形
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + progressWidth, y, x + progressWidth, y + height, radius);
    ctx.arcTo(x + progressWidth, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + progressWidth, y, radius);
  } else {
    // 绘制左边圆角，右边直边，怎么画进度条还要做数学题啊
    const cosTheta = (height - progressWidth * 2) / height;
    ctx.moveTo(x, y + radius);
    ctx.arc(
      x + height / 2,
      y + height / 2,
      radius,
      Math.PI,
      Math.PI + Math.acos(cosTheta),
      false
    ); // 左上圆角
    ctx.lineTo(x + progressWidth, y + height / 2 + progressWidth); // 右边
    ctx.arc(
      x + height / 2,
      y + height / 2,
      radius,
      Math.PI - Math.acos(cosTheta),
      Math.PI,
      false
    ); // 左下圆角
  }
  ctx.closePath();
  ctx.fill();

  // 百分比文字
  ctx.fillStyle = "#000000";
  ctx.fillText(Math.round(value) + "%", x + width + 5, y + 12);
}

// 自动换行
function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (let word of words) {
    const testLine = line + word + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  return lines;
}

// 流量单位换算
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

if (!netlify) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/status`);
  });
} else {
  module.exports.handler = serverless(app);
}
