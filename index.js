const express = require("express");
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();

/* ---------------- ENV ---------------- */

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const FILE_PATH = "./tmp";
const HEALTH_PATH = "/health";
const SUB_PATH = "crazyworld";

const UUID =
  process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913";

const ARGO_PORT = process.env.ARGO_PORT || 8001;
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || "";

const CFIP = process.env.CFIP || "cdns.doon.eu.org";
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || "Apply";

/* ---------------- STATIC ---------------- */

app.use(express.static(__dirname));

app.get("/", (req, res) => {

  const indexPath = path.join(__dirname, "index.html");

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("Perish World Peace！");
  }

});

/* ---------------- HEALTH ---------------- */

app.get(HEALTH_PATH, (req, res) => {
  res.status(200).send("OK");
});

/* ---------------- PATH ---------------- */

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
}

const XRAY = path.join(FILE_PATH, "web");
const ARGO = path.join(FILE_PATH, "bot");

const CONFIG = path.join(FILE_PATH, "config.json");
const BOOTLOG = path.join(FILE_PATH, "boot.log");
const SUBFILE = path.join(FILE_PATH, "sub.txt");

/* ---------------- ARCH ---------------- */

function getArch() {

  const arch = os.arch();

  if (arch.includes("arm")) return "arm";

  return "amd";

}

/* ---------------- DOWNLOAD ---------------- */

async function download(url, file) {

  const writer = fs.createWriteStream(file);

  const res = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  res.data.pipe(writer);

  return new Promise((resolve) => {
    writer.on("finish", resolve);
  });

}

/* ---------------- XRAY CONFIG ---------------- */

function generateConfig() {

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

        streamSettings: {
          network: "tcp"
        }

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

    outbounds: [
      { protocol: "freedom" }
    ]

  };

  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

}

/* ---------------- RUN PROCESS ---------------- */

function runProcess(cmd, args) {

  const p = spawn(cmd, args, {
    stdio: "ignore",
    detached: true
  });

  p.unref();

}

/* ---------------- ISP ---------------- */

async function getISP() {

  try {

    const r = await axios.get("https://ipapi.co/json/");

    return `${r.data.country_code}_${r.data.org}`;

  } catch {

    return "Unknown";

  }

}

/* ---------------- SUB ---------------- */

async function generateSub(domain) {

  const isp = await getISP();

  const node = `${NAME}-${isp}`;

  const vmess = {

    v: "2",
    ps: node,
    add: CFIP,
    port: CFPORT,
    id: UUID,
    aid: "0",
    net: "ws",
    host: domain,
    path: "/vmess",
    tls: "tls"

  };

  const sub = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&type=ws&host=${domain}&path=%2Fvless#${node}

vmess://${Buffer.from(JSON.stringify(vmess)).toString("base64")}
`;

  fs.writeFileSync(SUBFILE, Buffer.from(sub).toString("base64"));

  app.get(`/${SUB_PATH}`, (req, res) => {
    res.send(fs.readFileSync(SUBFILE, "utf8"));
  });

}

/* ---------------- EXTRACT DOMAIN ---------------- */

async function extractDomain() {

  if (ARGO_DOMAIN) {

    await generateSub(ARGO_DOMAIN);
    return;

  }

  if (!fs.existsSync(BOOTLOG)) return;

  const text = fs.readFileSync(BOOTLOG, "utf8");

  const m = text.match(/https?:\/\/([^ ]*trycloudflare\.com)/);

  if (m) {

    await generateSub(m[1]);

  }

}

/* ---------------- START ---------------- */

async function start() {

  console.log("Starting service...");

  generateConfig();

  const arch = getArch();

  const xrayURL =
    arch === "arm"
      ? "https://arm64.ssss.nyc.mn/web"
      : "https://amd64.ssss.nyc.mn/web";

  const argoURL =
    arch === "arm"
      ? "https://arm64.ssss.nyc.mn/bot"
      : "https://amd64.ssss.nyc.mn/bot";

  console.log("Downloading binaries...");

  await download(xrayURL, XRAY);
  await download(argoURL, ARGO);

  fs.chmodSync(XRAY, 0o775);
  fs.chmodSync(ARGO, 0o775);

  console.log("Starting Xray...");

  runProcess(XRAY, ["-c", CONFIG]);

  console.log("Starting Argo...");

  runProcess(ARGO, [
    "tunnel",
    "--edge-ip-version",
    "auto",
    "--no-autoupdate",
    "--protocol",
    "http2",
    "--logfile",
    BOOTLOG,
    "--url",
    `http://localhost:${ARGO_PORT}`
  ]);

  setTimeout(extractDomain, 6000);

}

/* ---------------- HTTP ---------------- */

app.listen(PORT, HOST, () => {

  console.log(`Server started`);

  console.log(`PORT: ${PORT}`);

});

/* ---------------- RUN ---------------- */

start();
