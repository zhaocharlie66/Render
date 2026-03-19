const fs = require("fs");
const path = require("path");
const os = require('os');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { spawn } = require('child_process');
const express = require('express');
// const { exec } = require('child_process'); // 引入child_process模块执行shell命令
const app = express();
const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);

// 中间件，解析JSON请求体
app.use(express.json());

// 处理GET请求的路由
app.get('/', async function(req, res) {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const data = await fs.promises.readFile(filePath, 'utf8');
    res.send(data);
  } catch (err) {
    res.send("Service is runing!欢迎来到主页!");
    // res.send('欢迎来到主页！');
  }
});

// 处理GET请求的路由
app.get('/users', (req, res) => {
  const users = [{'id': 1, 'name': 'Alice'}, {'id': 2, 'name': 'Bob'}]; // 增加const声明，避免全局变量污染
  res.send(users);
});

// 处理POST请求的路由
app.post('/submit', (req, res) => {
  // 访问POST请求中的数据
  const { name, age } = req.body;
  res.send(`你好，${name}！你今年${age}岁。`);
});
// 配置项（集中管理，便于修改）
const CONFIG = {
  agentPath: './agent', // agent文件路径
  agentArgs: ['-e', 'https://eopdzdlbilse.ap-northeast-1.clawcloudrun.com', '-t', 'g3gjNgDjlcW6NIS0C3CqFq'], // agent启动参数
  logFilePath: path.join('./', 'agent.log'), // 日志文件路径
  checkInterval: 5000, // 进程检查间隔（5秒）
  timeout: 15 // agent启动超时（秒）
};

// 确保日志目录存在
function ensureLogDir() {
  const logDir = path.dirname(CONFIG.logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// 写入日志（追加模式，带时间戳）
function writeLog(content) {
  const logContent = `[${new Date().toISOString()}] ${content}\n`;
  fs.appendFile(CONFIG.logFilePath, logContent, (err) => {
    if (err) console.error('写入日志失败：', err);
  });
}

// 检查agent进程是否存活
function checkAgentProcess() {
  return new Promise((resolve) => {
    // 通过进程名精确匹配，避免误判
    exec(`ps aux | grep -v grep | grep "${CONFIG.agentPath}"`, (error, stdout) => {
      // stdout非空表示进程存在
      resolve(stdout.trim().length > 0);
    });
  });
}

// ================= 新增：自动下载和配置 Agent 的逻辑 =================
async function downloadKomariAgent(targetPath) {
  writeLog('=== 开始检测并下载 Komari Agent ===');
  
  // 1. 判断是否为 Linux 系统
  if (os.platform() !== 'linux') {
    throw new Error(`当前系统为 ${os.platform()}，仅支持 Linux 系统自动下载。`);
  }

  // 判断 Agent 是否已存在且具有可执行权限（避免每次重启都重复下载）
  if (fs.existsSync(targetPath)) {
    try {
      fs.accessSync(targetPath, fs.constants.X_OK);
      writeLog(`检测到 Agent 文件已存在且具有可执行权限，跳过下载步骤。`);
      return; 
    } catch (e) {
      writeLog(`Agent 存在但无执行权限，将重新下载覆盖或授权...`);
    }
  }

  // 2. 判断 Linux 发行版
  let distro = 'linux'; // 默认回退值
  try {
    if (fs.existsSync('/etc/os-release')) {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
      const match = osRelease.match(/^ID="?([^"\n]+)"?/m);
      if (match) distro = match[1].toLowerCase();
    }
  } catch (err) {
    writeLog(`读取 /etc/os-release 获取发行版信息失败: ${err.message}`);
  }

  // 3. 判断硬件架构并映射为常见 Release 命名
  const archMap = { 'x64': 'amd64', 'arm64': 'arm64', 'arm': 'arm', 'ia32': '386' };
  const arch = archMap[os.arch()] || os.arch();

  writeLog(`检测到系统环境 -> 发行版: ${distro}, 架构: ${arch}`);

  // 4. 拼接对应的下载地址
  // ⚠️注意：需要根据 Komari Agent 实际的 Release 包名进行调整！
  // 这里默认格式假设为单文件二进制，例如 komari-agent-linux-amd64
  // 如果官方区分发行版，可改为 `komari-agent-${distro}-${arch}`
  const fileName = `komari-agent-linux-${arch}`;
  const downloadUrl = `https://github.com/komari-monitor/komari-agent/releases/latest/download/${fileName}`;
  
  writeLog(`对应版本下载链接: ${downloadUrl}`);

  // 5. 执行下载并改名保存、增加可执行属性
  try {
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 使用 curl 进行下载：-L 跟随重定向，-f 失败时不保存空文件，-o 直接指定输出路径（以此实现改名）
    await exec(`curl -L -f -o "${targetPath}" "${downloadUrl}"`);
    
    // 增加可执行属性
    fs.chmodSync(targetPath, 0o755);
    writeLog(`✅ 下载成功，已重命名并增加可执行属性 (chmod +x)`);
  } catch (err) {
    throw new Error(`下载失败 (请检查网络或确认 Release 中是否存在文件 ${fileName}): ${err.message}`);
  }
}

// ================= 原有逻辑增强 =================
// 启动agent进程（后台运行）
// 启动agent进程（增强调试日志）
async function startAgent() {
  try {
    // 【新增】启动前先执行环境检测和下载逻辑
    // CONFIG.agentPath 为原代码中你的 agent 路径，我们直接将其作为目标路径传入
    await downloadKomariAgent(CONFIG.agentPath);

    writeLog('=== 开始启动agent ===');
    // 打印启动参数和环境信息
    writeLog(`启动参数：${CONFIG.agentPath} ${CONFIG.agentArgs.join(' ')}`);
    writeLog(`当前工作目录：${process.cwd()}`);
    writeLog(`执行用户：${process.env.USER || '未知'}`);
    
    // 改用spawn（替代exec），能捕获进程退出码和信号
    const agentProcess = spawn(
      CONFIG.agentPath,
      CONFIG.agentArgs,
      {
        detached: true, // 后台运行
        stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出
        cwd: path.dirname(CONFIG.agentPath), // 切换到agent所在目录
        env: process.env // 继承环境变量
      }
    );

    // 记录进程ID
    writeLog(`agent进程ID(PID)：${agentProcess.pid}`);

    // 捕获标准输出（实时写入日志）
    agentProcess.stdout.on('data', (data) => {
      writeLog(`[PID:${agentProcess.pid}] STDOUT: ${data.toString().trim()}`);
    });

    // 捕获标准错误（关键！agent崩溃的错误信息都在这里）
    agentProcess.stderr.on('data', (data) => {
      writeLog(`[PID:${agentProcess.pid}] STDERR: ${data.toString().trim()}`);
    });

    // 捕获进程退出事件（核心！获取退出码/信号）
    agentProcess.on('exit', (code, signal) => {
      if (code !== null) {
        writeLog(`[PID:${agentProcess.pid}] agent退出，退出码：${code}（非0表示异常）`);
        // 常见退出码含义
        if (code === 1) writeLog('退出码1：一般是参数错误/权限不足/文件不存在');
        if (code === 2) writeLog('退出码2：命令用法错误');
        if (code === 127) writeLog('退出码127：agent文件不存在或路径错误');
        if (code === 126) writeLog('退出码126：agent文件存在但无执行权限');
      }
      if (signal !== null) {
        writeLog(`[PID:${agentProcess.pid}] agent被信号终止，信号：${signal}（如SIGKILL/SIGTERM）`);
      }
    });

    // 捕获进程启动失败（如文件不存在）
    agentProcess.on('error', (err) => {
      writeLog(`[PID:${agentProcess.pid}] agent启动失败：${err.message}`);
    });

    // 脱离父进程（后台运行）
    agentProcess.unref();
    writeLog('agent进程启动流程完成（已后台运行）');
  } catch (err) {
    const errMsg = `agent启动逻辑异常：${err.message}`;
    writeLog(errMsg);
    console.error(errMsg);
  }
}

// 进程守护核心逻辑：检查并自动重启
async function agentDaemon() {
  try {
    const isRunning = await checkAgentProcess();
    if (isRunning) {
      // 进程存活，仅记录心跳（可选）
      // writeLog('agent进程运行正常');
      return;
    }
    // 进程不存在，记录并重启
    writeLog('检测到agent进程已退出，正在自动重启...');
    await startAgent();
  } catch (err) {
    const errMsg = `进程检查/重启异常：${err.message}`;
    writeLog(errMsg);
    console.error(errMsg);
  }
}

// 初始化：确保日志目录 + 立即启动一次agent + 启动定时守护
function initAgentDaemon() {
  ensureLogDir();
  // 先检查进程状态，不存在则启动
  checkAgentProcess().then((isRunning) => {
    if (!isRunning) {
      startAgent();
    } else {
      writeLog('agent进程已在运行，无需重复启动');
    }
    // 启动定时检查（每5秒）
    setInterval(agentDaemon, CONFIG.checkInterval);
    writeLog(`agent守护进程已启动，检查间隔：${CONFIG.checkInterval/1000}秒`);
  });
}
// 新增GET路由/install，手动触发启动（保留原有功能）
app.get('/install', (req, res) => {
  checkAgentProcess().then((isRunning) => {
    if (isRunning) {
      const msg = `agent进程已在运行，无需重复启动！日志路径：${CONFIG.logFilePath}`;
      writeLog(`手动触发install：${msg}`);
      res.send(msg);
      return;
    }

    startAgent();
    const successMsg = `已手动启动agent进程（后台运行）！\n日志文件路径：${CONFIG.logFilePath}\n守护进程每5秒检查一次进程状态`;
    writeLog(`手动触发install：${successMsg}`);
    res.send(successMsg);
  }).catch((err) => {
    const errMsg = `手动启动agent失败：${err.message}`;
    writeLog(errMsg);
    res.status(500).send(errMsg);
  });
});

// 新增GET路由/status，查看agent进程状态（可选，便于调试）
app.get('/status', (req, res) => {
  checkAgentProcess().then((isRunning) => {
    const status = {
      time: new Date().toISOString(),
      agent_running: isRunning,
      log_file: CONFIG.logFilePath,
      check_interval: `${CONFIG.checkInterval/1000}秒`
    };
    res.status(200).json(status);
  });
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器正在运行在PORT:${port}`);
  // 初始化agent守护
  // initAgentDaemon();
});
