const express = require("express");
const app = express();
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

const FILE_PATH = process.env.FILE_PATH || "./tmp";
const SUB_PATH = process.env.SUB_PATH || "crazyworld";
const PORT = process.env.PORT || 3000;
const HEALTH_PATH = process.env.HEALTH_PATH || "/health";

const UUID =
  process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";
const ARGO_PORT = process.env.ARGO_PORT || 8001;

const CFIP = process.env.CFIP || "cdns.doon.eu.org";
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || "Render";

/* ---------- 静态资源 ---------- */

app.use(express.static(path.join(__dirname)));

/* ---------- 首页 ---------- */

app.get("/", (req, res) => {

  const indexPath = path.join(__dirname, "index.html");

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send("Perish World Peace！");
  }

});

/* ---------- Health Check ---------- */

app.get(HEALTH_PATH, (req, res) => {
  res.status(200).send("OK");
});

/* ---------- 创建运行目录 ---------- */

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
}

/* ---------- 工具 ---------- */

function generateRandomName() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let r = "";
  for (let i = 0; i < 6; i++) {
    r += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return r;
}

const webName = generateRandomName();
const botName = generateRandomName();

const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);

const subPath = path.join(FILE_PATH, "sub.txt");
const bootLogPath = path.join(FILE_PATH, "boot.log");

/* ---------- 清理文件 ---------- */

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);

    files.forEach((file) => {
      const fp = path.join(FILE_PATH, file);
      if (fs.statSync(fp).isFile()) {
        fs.unlinkSync(fp);
      }
    });

  } catch {}
}

/* ---------- 生成配置 ---------- */

async function generateConfig() {

  const config = {
    log: {
      access: "/dev/null",
      error: "/dev/null",
      loglevel: "none"
    },
    inbounds: [
      {
        port: ARGO_PORT,
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none",
          fallbacks: [{ dest: 3001 }]
        },
        streamSettings: { network: "tcp" }
      },
      {
        port: 3001,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none"
        }
      }
    ],
    outbounds: [{ protocol: "freedom" }]
  };

  fs.writeFileSync(
    path.join(FILE_PATH, "config.json"),
    JSON.stringify(config, null, 2)
  );
}

/* ---------- 架构 ---------- */

function getSystemArchitecture() {

  const arch = os.arch();

  if (arch.includes("arm")) return "arm";

  return "amd";

}

/* ---------- 下载 ---------- */

function downloadFile(fileName, url) {

  return new Promise(async (resolve, reject) => {

    const writer = fs.createWriteStream(fileName);

    try {

      const response = await axios({
        method: "get",
        url,
        responseType: "stream"
      });

      response.data.pipe(writer);

      writer.on("finish", resolve);
      writer.on("error", reject);

    } catch (e) {

      reject(e);

    }

  });

}

/* ---------- 文件 ---------- */

function getFilesForArchitecture(arch) {

  if (arch === "arm") {

    return [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];

  }

  return [
    { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
    { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
  ];

}

/* ---------- 下载运行 ---------- */

async function downloadFilesAndRun() {

  const arch = getSystemArchitecture();
  const files = getFilesForArchitecture(arch);

  for (const f of files) {
    await downloadFile(f.fileName, f.fileUrl);
  }

  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);

  await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);

  const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --url http://localhost:${ARGO_PORT}`;

  await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);

}

/* ---------- ISP ---------- */

async function getMetaInfo() {

  try {

    const r = await axios.get("https://ipapi.co/json/");

    return `${r.data.country_code}_${r.data.org}`;

  } catch {

    return "Unknown";

  }

}

/* ---------- 节点 ---------- */

async function generateLinks(domain) {

  const ISP = await getMetaInfo();

  const nodeName = `${NAME}-${ISP}`;

  const vmess = {
    v: "2",
    ps: nodeName,
    add: CFIP,
    port: CFPORT,
    id: UUID,
    aid: "0",
    net: "ws",
    host: domain,
    path: "/vmess",
    tls: "tls"
  };

  const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&type=ws&host=${domain}&path=%2Fvless#${nodeName}

vmess://${Buffer.from(JSON.stringify(vmess)).toString("base64")}
`;

  fs.writeFileSync(subPath, Buffer.from(subTxt).toString("base64"));

  app.get(`/${SUB_PATH}`, (req, res) => {
    res.send(fs.readFileSync(subPath, "utf8"));
  });

}

/* ---------- 提取域名 ---------- */

async function extractDomains() {

  if (ARGO_DOMAIN) {

    await generateLinks(ARGO_DOMAIN);

    return;

  }

  const content = fs.readFileSync(bootLogPath, "utf8");

  const match = content.match(/https?:\/\/([^ ]*trycloudflare\.com)/);

  if (match) {

    await generateLinks(match[1]);

  }

}

/* ---------- 启动 ---------- */

async function startserver() {

  try {

    cleanupOldFiles();

    await generateConfig();

    await downloadFilesAndRun();

    setTimeout(async () => {

      await extractDomains();

    }, 5000);

  } catch (e) {

    console.error(e);

  }

}

startserver();

/* ---------- http ---------- */

app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);

});
