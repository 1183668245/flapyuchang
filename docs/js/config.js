const { ethers } = window;

let provider;
let readProvider;
let signer;
let userAddress = "";
let vaultContract;
let readVaultContract;
let tokenContract;
let readTokenContract;
let tokenSymbol = "TOKEN";
let tokenDecimals = 18;
let seasonTimer = null;
let autoRefreshTimer = null;
let seedInventoryCache = { 0: 0, 1: 0, 2: 0 };
let pendingPlantPlotId = null;
let pendingActionConfirm = null;
let observedTargets = [];
let walletActionPending = false;
let activityTimer = null;
let activityLastBlock = 0;
let activityItems = [];
let vaultReleaseBps = 5000;
let walletProvider;

const $ = (id) => document.getElementById(id);
const pageLoader = $("pageLoader");

function setPondLoading(active, title = "正在识别钱包状态", text = "正在同步你的鱼塘与链上数据...") {
  const loading = $("pondLoading");
  const cards = $("pondCards");
  if (!loading || !cards) return;
  loading.classList.toggle("is-active", !!active);
  cards.style.display = active ? "none" : "grid";
  if ($("pondLoadingTitle")) $("pondLoadingTitle").textContent = title;
  if ($("pondLoadingText")) $("pondLoadingText").textContent = text;
}

function setWalletBusy(active, title = "等待钱包确认", text = "请在钱包中完成当前操作，不要重复点击。") {
  const overlay = $("walletBusyOverlay");
  document.body.classList.toggle("wallet-busy", !!active);
  if (overlay) overlay.classList.toggle("is-open", !!active);
  if ($("walletBusyTitle")) $("walletBusyTitle").textContent = title;
  if ($("walletBusyText")) $("walletBusyText").textContent = text;
}

function setTxStatus(active, title = "交易确认中", text = "交易已发送，正在等待链上确认...", hash = "") {
  const card = $("txStatusCard");
  if (card) card.classList.toggle("is-open", !!active);
  if ($("txStatusTitle")) $("txStatusTitle").textContent = title;
  if ($("txStatusText")) $("txStatusText").textContent = text;
  if ($("txStatusHash")) $("txStatusHash").textContent = hash ? `Tx: ${hash.slice(0, 10)}...${hash.slice(-8)}` : "";
}

function openInfoModal(title = "提示", text = "请先完成当前操作。") {
  if ($("infoModalTitle")) $("infoModalTitle").textContent = title;
  if ($("infoModalText")) $("infoModalText").textContent = text;
  $("infoModal")?.classList.add("is-open");
}

function closeInfoModal() {
  $("infoModal")?.classList.remove("is-open");
}

function setDebugChip(id, text, state = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `debug-chip${state ? ` is-${state}` : ""}`;
}

function updateDebugState() {
  setDebugChip("debugWalletState", `钱包：${userAddress ? formatAddress(userAddress) : "未识别"}`, userAddress ? "ok" : "warn");
  setDebugChip("debugContractState", `合约：${vaultContract ? "已初始化" : "未初始化"}`, vaultContract ? "ok" : "warn");
}

function getChainHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}

const CUSTOM_ERRORS_CN = {
  "SeasonNotEnded": "当前赛季还未结束",
  "AlreadyClaimed": "您已经领取过该赛季的分红了",
  "NoTickets": "该赛季您没有获得渔获积分，无法分红",
  "TransferFailed": "转账失败，合约余额可能不足",
  "TokenNotBound": "代币未绑定",
  "InvalidToken": "无效的代币",
  "InvalidReceiver": "无效的接收者",
  "InvalidSeedType": "无效的鱼苗类型",
  "InvalidAmount": "无效的数量",
  "InvalidValue": "支付的 BNB 金额不正确",
  "MaxLandReached": "已达到最大鱼塘扩建数量",
  "PlotNotAvailable": "该塘位不可用",
  "PlotNotFound": "塘位不存在",
  "NotPlotOwner": "您不是该塘位的主人",
  "NotMature": "鱼苗尚未成熟",
  "AlreadyHarvested": "该塘位已经起网了",
  "TooEarlyToSteal": "太早了，还没到偷捕时间",
  "TooLateToSteal": "太晚了，已经过了偷捕窗口期",
  "CannotStealSelf": "不能偷捕自己的鱼塘",
  "StealLimitReached": "该塘位被偷捕次数已达上限",
  "AlreadyHasScarecrow": "该塘位已经设置了护网",
  "FertilizeLimitReached": "该塘位增氧次数已达上限",
  "AlreadyMature": "鱼苗已经成熟，无法继续操作",
  "InStealWindow": "正在偷捕窗口期，无法操作",
  "ReferrerAlreadyBound": "您已经绑定过推荐人了",
  "InvalidReferrer": "无效的推荐人地址"
};

function getErrorMessage(err) {
  if (err?.revert?.name && CUSTOM_ERRORS_CN[err.revert.name]) {
    return CUSTOM_ERRORS_CN[err.revert.name];
  }
  return err?.shortMessage
    || err?.info?.error?.message
    || err?.error?.message
    || err?.data?.originalError?.message
    || err?.message
    || String(err);
}

function getWalletProvider() {
  if (walletProvider?.request) return walletProvider;
  const list = window.ethereum?.providers?.length ? window.ethereum.providers : (window.ethereum ? [window.ethereum] : []);
  walletProvider = list.find((p) => p?.isMetaMask)
    || list.find((p) => p?.isOKXWallet || p?.isOkxWallet)
    || list.find((p) => p?.isTokenPocket)
    || list.find((p) => p?.isBitKeep || p?.isBitgetWallet)
    || list.find((p) => p?.isCoinbaseWallet)
    || list.find((p) => p?.isTrust || p?.isTrustWallet)
    || list.find((p) => p?.request)
    || null;
  return walletProvider;
}

function getRpcUrls() {
  const list = [window.APP_CONFIG.rpcUrl, ...(window.APP_CONFIG.rpcUrls || [])].filter(Boolean);
  return [...new Set(list)];
}

async function ensureCorrectNetwork() {
  const injected = getWalletProvider();
  if (!injected) return;
  const currentHex = await injected.request({ method: "eth_chainId" });
  const currentChainId = parseInt(currentHex, 16);
  if (currentChainId === Number(window.APP_CONFIG.chainId)) return;
  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: getChainHex(window.APP_CONFIG.chainId) }]
    });
  } catch (switchErr) {
    if (switchErr?.code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: getChainHex(window.APP_CONFIG.chainId),
          chainName: window.APP_CONFIG.chainName,
          rpcUrls: getRpcUrls(),
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          blockExplorerUrls: ["https://bscscan.com"]
        }]
      });
      return;
    }
    throw new Error(`请先将钱包切换到 ${window.APP_CONFIG.chainName}`);
  }
}

function log(message, isError = false) {
  const box = $("logBox");
  const prefix = `[${new Date().toLocaleTimeString()}] `;
  box.textContent = `${prefix}${isError ? "ERROR: " : ""}${message}\n${box.textContent}`;
}

function toast(message, isError = false) {
  const wrap = $("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast${isError ? " error" : ""}`;
  el.textContent = message;
  wrap.prepend(el);
  setTimeout(() => el.remove(), 3200);
}

function formatAddress(address) {
  if (!address) return "未连接";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getSeedName(seedType) {
  const cfg = window.APP_CONFIG?.seedConfigs?.[Number(seedType)];
  return cfg?.name || `鱼苗${Number(seedType)}`;
}

const ACTIVITY_MAX_ITEMS = 100;
const ACTIVITY_PREVIEW_ITEMS = 4;

function openActivityModal() {
  document.body.classList.add("modal-open");
  $("activityModal")?.classList.add("is-open");
  renderActivityFeed();
}

function closeActivityModal() {
  document.body.classList.remove("modal-open");
  $("activityModal")?.classList.remove("is-open");
}

function renderActivityFeed() {
  const previewBox = $("activityList");
  const modalBox = $("activityModalList");

  const render = (box, limit) => {
    if (!box) return;
    if (!activityItems.length) {
      box.innerHTML = '<div class="activity-empty">暂无动态</div>';
      return;
    }
    box.innerHTML = activityItems.slice(0, limit).map((item) => {
      return `<div class="activity-item">
        <span class="activity-badge ${item.type === "steal" ? "is-steal" : "is-plant"}">${item.type === "steal" ? "偷捕" : "投放"}</span>
        <div class="activity-text">${item.text}</div>
      </div>`;
    }).join("");
  };

  render(previewBox, ACTIVITY_PREVIEW_ITEMS);
  render(modalBox, ACTIVITY_MAX_ITEMS);
}

function pushActivityItems(next) {
  const seen = new Set(activityItems.map((v) => v.key));
  const merged = [];
  next.forEach((v) => {
    if (!v?.key || seen.has(v.key)) return;
    seen.add(v.key);
    merged.push(v);
  });
  activityItems = [...merged, ...activityItems].slice(0, ACTIVITY_MAX_ITEMS);
}

async function pollActivityFeed() {
  if (walletActionPending) return;
  await initReadContracts();
  const contract = readVaultContract;
  if (!readProvider || !contract) return;
  const current = await readProvider.getBlockNumber().catch(() => 0);
  if (!current) return;
  const lookback = 2000;
  const fromBlock = activityLastBlock ? (activityLastBlock + 1) : Math.max(0, current - lookback);
  const toBlock = current;
  if (fromBlock > toBlock) return;

  const plantedFilter = contract.filters.Planted();
  const stolenFilter = contract.filters.Stolen();
  const [plantedLogs, stolenLogs] = await Promise.all([
    readProvider.getLogs({ ...plantedFilter, fromBlock, toBlock }).catch(() => []),
    readProvider.getLogs({ ...stolenFilter, fromBlock, toBlock }).catch(() => [])
  ]);

  const logs = [...plantedLogs, ...stolenLogs].sort((a, b) => (b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));
  const nextItems = [];
  logs.forEach((log) => {
    try {
      const parsed = contract.interface.parseLog(log);
      if (!parsed?.name) return;
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (parsed.name === "Planted") {
        const user = parsed.args.user;
        const plotId = Number(parsed.args.plotId);
        const seedType = Number(parsed.args.seedType);
        nextItems.push({
          key,
          type: "plant",
          text: `${formatAddress(user)} 在 ${plotId + 1}号塘 投放 ${getSeedName(seedType)}`
        });
      }
      if (parsed.name === "Stolen") {
        const thief = parsed.args.thief;
        const victim = parsed.args.victim;
        const plotId = Number(parsed.args.plotId);
        const stolenTickets = parsed.args.stolenTickets;
        nextItems.push({
          key,
          type: "steal",
          text: `${formatAddress(thief)} 偷捕 ${formatAddress(victim)} 的 ${plotId + 1}号塘 · +${formatUnits(stolenTickets, 18)} 积分`
        });
      }
    } catch {
    }
  });

  activityLastBlock = toBlock;
  if (nextItems.length) pushActivityItems(nextItems);
  renderActivityFeed();
}

function startActivityFeed() {
  clearInterval(activityTimer);
  activityTimer = null;
  activityLastBlock = 0;
  activityItems = [];
  renderActivityFeed();
  pollActivityFeed().catch((err) => log(`渔场动态刷新异常: ${getErrorMessage(err)}`, true));
  activityTimer = setInterval(() => {
    pollActivityFeed().catch((err) => log(`渔场动态刷新异常: ${getErrorMessage(err)}`, true));
  }, 15000);
}

function setConnectState(account) {
  const connectBtn = $("connectBtn");
  if (!connectBtn) return;
  if (account) {
    connectBtn.textContent = formatAddress(account);
    connectBtn.classList.add("btn-connected");
    connectBtn.title = account;
  } else {
    connectBtn.textContent = "连接钱包";
    connectBtn.classList.remove("btn-connected");
    connectBtn.removeAttribute("title");
  }
}

function formatEther(value) {
  try {
    const num = Number(ethers.formatEther(value));
    return `${num.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} BNB`;
  } catch {
    return "-";
  }
}

function formatTokenWhole(value, decimals = 18, suffix = "") {
  try {
    const divisor = 10n ** BigInt(decimals);
    const whole = (BigInt(value) / divisor).toLocaleString("en-US");
    return suffix ? `${whole} ${suffix}` : whole;
  } catch {
    return "-";
  }
}

function formatVaultBalanceNumber(value) {
  if (value >= 1000) return `${value.toFixed(1)} BNB`;
  if (value >= 100) return `${value.toFixed(2)} BNB`;
  if (value >= 1) return `${value.toFixed(3)} BNB`;
  return `${value.toFixed(4)} BNB`;
}

function parseBpsText(text) {
  const raw = String(text || "").trim();
  const num = Number.parseFloat(raw.replace("%", ""));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10000, Math.round(num * 100)));
}

function animateVaultValue(id, valueWei) {
  const el = $(id);
  if (!el) return;
  const nextValue = Number(ethers.formatEther(valueWei || 0n));
  const startValue = Number(el.dataset.value || "0");
  const startTime = performance.now();
  const duration = 900;
  if (el._vaultRaf) cancelAnimationFrame(el._vaultRaf);
  const tick = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const current = startValue + ((nextValue - startValue) * progress);
    el.textContent = formatVaultBalanceNumber(current);
    if (progress < 1) {
      el._vaultRaf = requestAnimationFrame(tick);
    } else {
      el.dataset.value = String(nextValue);
    }
  };
  el._vaultRaf = requestAnimationFrame(tick);
}

function animateVaultBalance(value) {
  animateVaultValue("vaultBalance", value);
}

function formatUnits(value, decimals = 18, suffix = "") {
  try {
    const v = ethers.formatUnits(value, decimals);
    return suffix ? `${v} ${suffix}` : v;
  } catch {
    return "-";
  }
}

function parseTokenInput(value) {
  return ethers.parseUnits(String(value || "0"), tokenDecimals);
}

function parseEthInput(value) {
  return ethers.parseEther(String(value || "0"));
}

function startPageLoader() {
  if (!pageLoader) return;
  pageLoader.classList.remove("is-hidden");
}

function finishPageLoader() {
  if (!pageLoader) return;
  setTimeout(() => {
    pageLoader.classList.add("is-hidden");
    document.body.classList.remove("play-entering");
    document.body.classList.add("page-ready");
  }, 2000);
}

async function initReadContracts() {
  if (!readProvider) {
    const rpcUrls = getRpcUrls();
    if (!rpcUrls.length) return;
    const providers = rpcUrls.map((url, index) => ({
      provider: new ethers.JsonRpcProvider(url),
      priority: index + 1,
      weight: 1,
      stallTimeout: 1200
    }));
    readProvider = providers.length === 1 ? providers[0].provider : new ethers.FallbackProvider(providers);
    readVaultContract = new ethers.Contract(window.APP_CONFIG.vaultAddress, window.CAIFARM_VAULT_ABI, readProvider);
    readTokenContract = new ethers.Contract(window.APP_CONFIG.tokenAddress, window.ERC20_ABI, readProvider);
    tokenSymbol = await readTokenContract.symbol().catch(() => "TOKEN");
    tokenDecimals = await readTokenContract.decimals().catch(() => 18);
  }
}

async function initContracts() {
  await initReadContracts();
  vaultContract = new ethers.Contract(window.APP_CONFIG.vaultAddress, window.CAIFARM_VAULT_ABI, signer);
  tokenContract = new ethers.Contract(window.APP_CONFIG.tokenAddress, window.ERC20_ABI, signer);
  tokenSymbol = await (readTokenContract || tokenContract).symbol().catch(() => "TOKEN");
  tokenDecimals = await (readTokenContract || tokenContract).decimals().catch(() => 18);
}

async function ensureWalletContext(account) {
  const injected = getWalletProvider();
  if (!injected || !account) return false;
  await ensureCorrectNetwork();
  provider = new ethers.BrowserProvider(injected);
  signer = await provider.getSigner();
  userAddress = account;
  updateDebugState();
  await initContracts();
  $("walletAddress").textContent = formatAddress(userAddress);
  $("plotUserAddress").placeholder = userAddress;
  updateDebugState();
  return true;
}

async function connectWallet() {
  const injected = getWalletProvider();
  if (!injected) {
    openInfoModal("未检测到钱包", "请在 MetaMask、OKX、TokenPocket、Bitget 等钱包浏览器中打开，或先安装浏览器钱包。");
    return;
  }
  if (walletActionPending) {
    toast("已有钱包操作进行中，请先完成当前弹窗", true);
    return;
  }

  walletActionPending = true;
  setPondLoading(true, "正在连接钱包", "已发起钱包授权，请完成确认后同步鱼塘...");
  setWalletBusy(true, "等待钱包连接", "请在钱包中确认连接，不要重复点击。");
  try {
    const accounts = await provider?.send?.("eth_requestAccounts", []).catch(() => null)
      || await new ethers.BrowserProvider(injected).send("eth_requestAccounts", []);
    const account = accounts?.[0];
    if (!account) return;
    setWalletBusy(false);
    await ensureWalletContext(account);
    setConnectState(userAddress);
    log(`钱包已连接: ${userAddress}`);
    startAutoRefresh();
    await refreshAll();
    await renderPondCards();
  } catch (err) {
    toast(`连接钱包失败: ${getErrorMessage(err)}`, true);
    log(`连接钱包失败: ${getErrorMessage(err)}`, true);
  } finally {
    walletActionPending = false;
    setWalletBusy(false);
    setPondLoading(false);
  }
}

async function refreshWalletState() {
  if (!userAddress || !(readProvider || provider)) return;
  const nativeBalance = await (readProvider || provider).getBalance(userAddress);
  $("nativeBalance").textContent = formatEther(nativeBalance);
  $("nativeBalance").title = `${ethers.formatEther(nativeBalance)} BNB`;
  const token = readTokenContract || tokenContract;
  const balance = await token.balanceOf(userAddress);
  $("tokenBalance").textContent = formatTokenWhole(balance, tokenDecimals);
  $("tokenBalance").title = formatUnits(balance, tokenDecimals, tokenSymbol);
  const allowance = await token.allowance(userAddress, window.APP_CONFIG.vaultAddress);
  $("tokenAllowance").textContent = formatTokenWhole(allowance, tokenDecimals);
  $("tokenAllowance").title = formatUnits(allowance, tokenDecimals, tokenSymbol);
}

async function refreshVaultState() {
  const vaultData = await (readVaultContract || vaultContract).vault();
  animateVaultBalance(vaultData.balance);
  const bps = Number(vaultReleaseBps || 0);
  const current = BigInt(vaultData.current || 0n);
  const rollover = BigInt(vaultData.rollover || 0n);
  const distributable = bps > 0
    ? ((current + rollover) * BigInt(bps)) / 10000n
    : 0n;
  animateVaultValue("vaultDistributable", distributable);
}

function formatSeasonLeft(left) {
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}分 ${seconds}秒`;
}

function formatSeasonEndClock(endTime) {
  return new Date(endTime * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

async function refreshSeasonState() {
  const seasonData = await (readVaultContract || vaultContract).season();
  const endTime = Number(seasonData.endTime);
  const left = Math.max(0, endTime - Math.floor(Date.now() / 1000));
  const releaseBps = parseBpsText(seasonData.releaseRate);
  if (releaseBps) vaultReleaseBps = releaseBps;
  const myTickets = userAddress
    ? await (readVaultContract || vaultContract).getUserTickets(seasonData.id, userAddress).catch(() => 0n)
    : 0n;
  $("seasonId").textContent = seasonData.id.toString();
  $("seasonEndTime").textContent = formatSeasonLeft(left);
  $("seasonEndAt").textContent = `结束于 ${formatSeasonEndClock(endTime)}`;
  $("seasonTickets").textContent = formatUnits(seasonData.tickets, 18);
  $("mySeasonTickets").textContent = formatUnits(myTickets, 18);
  startSeasonCountdown(endTime);
}

function updateReferrerBindingUI(referrer = "") {
  const input = $("referrerAddress");
  const btn = $("bindReferrerBtn");
  const status = $("referrerStatus");
  const hasReferrer = !!referrer && referrer !== ethers.ZeroAddress;
  if (input) {
    input.disabled = hasReferrer;
    input.value = hasReferrer ? referrer : "";
    input.placeholder = hasReferrer ? "已绑定推荐人" : "输入推荐人地址";
  }
  if (btn) {
    btn.disabled = hasReferrer;
    btn.textContent = hasReferrer ? "已绑定推荐人" : "绑定推荐人";
  }
  if (status) {
    status.textContent = hasReferrer ? `已绑定推荐人：${formatAddress(referrer)}` : "当前未绑定推荐人。";
  }
}

async function refreshReferrerState() {
  if (!userAddress || !(readVaultContract || vaultContract)) {
    updateReferrerBindingUI("");
    return;
  }
  const referrer = await (readVaultContract || vaultContract).referrerOf(userAddress).catch(() => ethers.ZeroAddress);
  updateReferrerBindingUI(referrer);
}

function startSeasonCountdown(endTime) {
  clearInterval(seasonTimer);
  seasonTimer = setInterval(() => {
    const left = Math.max(0, endTime - Math.floor(Date.now() / 1000));
    $("seasonEndTime").textContent = formatSeasonLeft(left);
    $("seasonEndAt").textContent = `结束于 ${formatSeasonEndClock(endTime)}`;
  }, 1000);
}

async function refreshLivePanels() {
  if (walletActionPending) return;
  const tasks = [];
  if (readVaultContract || vaultContract) {
    tasks.push(refreshVaultState().catch((err) => log(`金库状态刷新异常: ${err?.message || err}`, true)));
    tasks.push(refreshSeasonState().catch((err) => log(`赛季状态刷新异常: ${err?.message || err}`, true)));
  }
  if (signer) {
    tasks.push(refreshWalletState().catch((err) => log(`钱包状态刷新异常: ${err?.message || err}`, true)));
    tasks.push(refreshReferrerState().catch((err) => log(`推荐人状态刷新异常: ${err?.message || err}`, true)));
  }
  await Promise.all(tasks);
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    refreshLivePanels().catch((err) => log(`自动刷新异常: ${getErrorMessage(err)}`, true));
  }, 10000);
}

function stopAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

async function refreshAll() {
  if (!signer) {
    log("请先连接钱包");
    return;
  }

  try {
    await refreshLivePanels();
    await renderSeedCards().catch((err) => log(`鱼苗库存刷新异常: ${err?.message || err}`, true));
    await renderPondCards().catch((err) => log(`鱼塘状态刷新异常: ${err?.message || err}`, true));
    try {
      updateCurrentActionGuide();
    } catch (err) {
      log(`更新引导条异常: ${err?.message || err}`, true);
    }
    log("状态刷新完成");
  } catch (err) {
    log(`刷新失败: ${err.shortMessage || err.message}`, true);
  }
}

async function ensureApprove(amount) {
  const allowance = await tokenContract.allowance(userAddress, window.APP_CONFIG.vaultAddress);
  if (allowance >= amount) {
    log(`授权已足够，跳过 approve`);
    return;
  }

  const defaultApproveAmount = ethers.parseUnits("1000000", tokenDecimals);
  const approveAmount = amount > defaultApproveAmount ? amount : defaultApproveAmount;

  setWalletBusy(true, "等待授权确认", `请在钱包中确认 ${formatUnits(approveAmount, tokenDecimals, tokenSymbol)} 授权。`);
  log(`开始授权 ${formatUnits(approveAmount, tokenDecimals, tokenSymbol)}`);
  const tx = await tokenContract.approve(window.APP_CONFIG.vaultAddress, approveAmount);
  log(`授权发送成功: ${tx.hash}`);
  setWalletBusy(false);
  setTxStatus(true, "授权确认中", "授权已发送，正在等待链上确认...", tx.hash);
  await tx.wait();
  setTxStatus(false);
  log("授权确认成功");
}

function setActionGuide(title, text) {
  const titleEl = $("actionGuideTitle");
  const textEl = $("actionGuideText");
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
}

function getShopSelectedSeedType() {
  return Number($("buySeedType")?.value || "0");
}

function updateShopSummary() {
  const seedType = getShopSelectedSeedType();
  const cfg = window.APP_CONFIG.seedConfigs[seedType];
  const amount = Number($("buySeedAmount")?.value || "1");
  const totalCost = Number(cfg.tokenCost) * amount;
  const inventory = Number(seedInventoryCache[seedType] || 0);
  const selectedSeedName = $("selectedSeedName");
  const selectedSeedInventory = $("selectedSeedInventory");
  const selectedSeedSummary = $("selectedSeedSummary");
  if (selectedSeedName) selectedSeedName.textContent = `已选：${cfg.name}`;
  if (selectedSeedInventory) selectedSeedInventory.textContent = `库存 ${inventory}`;
  if (selectedSeedSummary) {
    selectedSeedSummary.innerHTML = inventory > 0
      ? `成长 ${cfg.growTime || '-'} · 基础积分 ${cfg.basePoints || '-'}<br>购买 ${amount} 条需 ${totalCost} ${tokenSymbol} · 当前可直接投放 ${inventory} 条`
      : `成长 ${cfg.growTime || '-'} · 基础积分 ${cfg.basePoints || '-'}<br>购买 ${amount} 条需 ${totalCost} ${tokenSymbol} · 当前库存不足`;
  }
}

function normalizeBuySeedAmount() {
  const input = $("buySeedAmount");
  if (!input) return 1;
  const amount = Math.max(1, Number(input.value || "1") || 1);
  input.value = String(amount);
  return amount;
}

function adjustBuySeedAmount(delta) {
  const input = $("buySeedAmount");
  if (!input) return;
  const next = Math.max(1, normalizeBuySeedAmount() + delta);
  input.value = String(next);
  fillBuyCost();
}

function normalizeStealPlotDisplay() {
  const input = $("stealPlotId");
  if (!input) return 1;
  const value = Math.max(1, Number(input.value || "1") || 1);
  input.value = String(value);
  return value;
}

function adjustStealPlotId(delta) {
  const input = $("stealPlotId");
  if (!input) return;
  input.value = String(Math.max(1, normalizeStealPlotDisplay() + delta));
}

function fillBuyCost() {
  const seedType = getShopSelectedSeedType();
  const amount = normalizeBuySeedAmount();
  const cfg = window.APP_CONFIG.seedConfigs[seedType];
  const tokenCost = Number(cfg.tokenCost) * amount;
  $("buySeedTokenCost").value = String(tokenCost);
  updateShopSummary();
}

async function sendTx(label, fn) {
  if (!signer) {
    openInfoModal("请先连接钱包", "连接钱包后才能继续当前操作。");
    return;
  }
  if (walletActionPending) {
    toast("已有钱包操作进行中，请先完成当前弹窗", true);
    return;
  }

  walletActionPending = true;
  try {
    setWalletBusy(true, `等待${label}确认`, "请在钱包中完成确认，不要重复点击。");
    await ensureCorrectNetwork();
    log(`${label} - 发送中...`);
    const tx = await fn();
    log(`${label} - 已发送: ${tx.hash}`);
    setWalletBusy(false);
    setTxStatus(true, `${label}确认中`, "交易已发送，正在等待链上确认...", tx.hash);
    await tx.wait();
    setTxStatus(false);
    log(`${label} - 交易确认成功`);
    toast(`${label}成功`);
    try {
      await refreshAll();
    } catch (err) {
      log(`refreshAll 异常: ${getErrorMessage(err)}`, true);
    }
    try {
      updateCurrentActionGuide();
    } catch (err) {
      log(`更新引导条异常: ${getErrorMessage(err)}`, true);
    }
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    setTxStatus(false);
    toast(`${label}失败: ${errorMsg}`, true);
    log(`${label} - 失败: ${errorMsg}`, true);
  } finally {
    walletActionPending = false;
    setWalletBusy(false);
    setTxStatus(false);
  }
}

async function handleBindReferrer() {
  const referrer = $("referrerAddress").value.trim();
  if (!referrer) return openInfoModal("缺少推荐人地址", "请输入推荐人地址后再继续。");

  await sendTx("绑定推荐人", () => vaultContract.bindReferrer(referrer));
}

async function handleBuySeed() {
  const seedType = Number($("buySeedType").value);
  const amount = BigInt($("buySeedAmount").value || "1");
  const tokenCost = parseTokenInput($("buySeedTokenCost").value.trim());

  await sendTx("购买鱼苗", async () => {
    await ensureApprove(tokenCost);
    return vaultContract.buySeedWithCost(seedType, amount, tokenCost);
  });
}

async function handlePlant() {
  const plotId = BigInt($("plantPlotId").value || "0");
  const seedType = Number($("plantSeedType").value);

  await sendTx("投苗", () => vaultContract.plant(plotId, seedType));
}

async function handleBuyLand() {
  let rawValue = $("buyLandValue").value.trim();
  if (!rawValue) {
    const currentLand = Number(await vaultContract.getUserLandCount(userAddress).catch(() => 3n));
    rawValue = LAND_PRICES[currentLand + 1] || "0";
    $("buyLandValue").value = rawValue;
  }
  const value = parseEthInput(rawValue);
  await sendTx("扩建鱼塘", () => vaultContract.buyLand({ value }));
}

async function handleFertilize() {
  const plotId = BigInt($("fertilizePlotId").value || "0");
  const value = parseEthInput($("fertilizeValue").value.trim());

  await sendTx("增氧", () => vaultContract.fertilize(plotId, { value }));
}

async function handleScarecrow() {
  const plotId = BigInt($("scarecrowPlotId").value || "0");
  const value = parseEthInput($("scarecrowValue").value.trim());

  await sendTx("布置护网", () => vaultContract.placeScarecrow(plotId, { value }));
}

async function handleSteal() {
  const target = $("stealTarget").value.trim();
  const plotId = BigInt(normalizeStealPlotDisplay() - 1);
  const tokenCost = parseTokenInput($("stealTokenCost").value.trim());

  if (!target) return openInfoModal("缺少目标地址", "请输入目标地址后再发起偷捕。");
  saveObservedTarget(target);

  await sendTx("发起偷捕", async () => {
    await ensureApprove(tokenCost);
    return vaultContract.stealWithCost(target, plotId, tokenCost);
  });
}

async function handleHarvest() {
  const plotId = BigInt($("harvestPlotId").value || "0");
  await sendTx("起网", () => vaultContract.harvest(plotId));
}

async function handleClaim() {
  const seasonId = BigInt($("claimSeasonId").value || "1");
  await sendTx("领取分红", () => vaultContract.claimSeason(seasonId));
}

async function loadInventory() {
  if (!signer) return openInfoModal("请先连接钱包", "连接钱包后才能读取库存信息。");

  try {
    const seedType = Number($("inventorySeedType").value);
    const inventory = await vaultContract.getSeedInventory(userAddress, seedType);
    $("inventoryResult").textContent =
      `地址: ${userAddress}\n鱼苗类型: ${seedType}\n库存数量: ${inventory.toString()}`;
    log("鱼苗库存读取成功");
  } catch (err) {
    $("inventoryResult").textContent = err.shortMessage || err.message;
    log(`鱼苗库存读取失败: ${err.shortMessage || err.message}`, true);
  }
}

async function loadPlot() {
  if (!signer) return openInfoModal("请先连接钱包", "连接钱包后才能读取塘位状态。");

  try {
    const inputUser = $("plotUserAddress").value.trim();
    const user = inputUser || userAddress;
    const plotId = BigInt($("plotId").value || "0");

    const plot = await vaultContract.getPlot(user, plotId);

    $("plotResult").textContent =
      `查询地址: ${user}
塘位编号: ${plotId}
owner: ${plot.owner}
seedType: ${plot.seedType}
plantedAt: ${plot.plantedAt}
matureAt: ${plot.matureAt}
fertilizeCount: ${plot.fertilizeCount}
stolenCount: ${plot.stolenCount}
stolenBps: ${plot.stolenBps}
hasScarecrow: ${plot.hasScarecrow}
harvested: ${plot.harvested}
exists: ${plot.exists}`;

    log("塘位状态读取成功");
  } catch (err) {
    $("plotResult").textContent = err.shortMessage || err.message;
    log(`塘位状态读取失败: ${err.shortMessage || err.message}`, true);
  }
}

function fillDefaultValues() {
  $("buySeedTokenCost").value = window.APP_CONFIG.seedConfigs[0].tokenCost;
  $("fertilizeValue").value = window.APP_CONFIG.seedConfigs[0].fertilizePrice;
  $("scarecrowValue").value = window.APP_CONFIG.fixedScarecrowPrice;
  $("stealTokenCost").value = window.APP_CONFIG.fixedStealTokenCost;
  fillBuyCost();
}

const SEED_IMAGES = {
  0: "./jpg/素材/小黄鱼.webp",
  1: "./jpg/素材/海鲈鱼.webp",
  2: "./jpg/素材/蓝鳍金枪.webp"
};
const SEED_EXTRA_INFO = {
  0: { growTime: "15分钟", basePoints: "1", stealWindow: "3分钟" },
  1: { growTime: "45分钟", basePoints: "6", stealWindow: "8分钟" },
  2: { growTime: "2小时", basePoints: "22", stealWindow: "15分钟" }
};
const LAND_PRICES = { 4: "0.005", 5: "0.01", 6: "0.02", 7: "0.04", 8: "0.08" };
Object.entries(SEED_EXTRA_INFO).forEach(([id, extra]) => {
  window.APP_CONFIG.seedConfigs[id] = { ...window.APP_CONFIG.seedConfigs[id], ...extra };
});

function getSelectedSeedType() {
  return Number($("plantSeedType")?.value || "0");
}

function updatePlantModalSummary() {
  const seedType = getSelectedSeedType();
  const cfg = window.APP_CONFIG.seedConfigs[seedType];
  const inventory = Number(seedInventoryCache[seedType] || 0);
  const summary = $("plantModalSummary");
  const title = $("plantModalTitle");
  if (title) title.textContent = pendingPlantPlotId === null ? "选择投放鱼苗" : `选择投放到 ${Number(pendingPlantPlotId) + 1}号塘的鱼苗`;
  if (summary) summary.textContent = `${cfg.name} 当前库存 ${inventory}，确认后将投放到目标塘位。`;
}

function renderPlantSeedModalCards() {
  const box = $("plantSeedModalCards");
  if (!box) return;
  const selected = getSelectedSeedType();
  box.innerHTML = [0, 1, 2].map((seedType) => {
    const cfg = window.APP_CONFIG.seedConfigs[seedType];
    const inventory = Number(seedInventoryCache[seedType] || 0);
    const disabled = inventory <= 0;
    return `<div class="plant-choice-card ${selected === seedType ? "selected" : ""} ${disabled ? "is-disabled" : ""}" data-seed-type="${seedType}" ${disabled ? "" : `onclick="window.selectSeedType(${seedType})"`}>
      <img src="${SEED_IMAGES[seedType]}" alt="${cfg.name}" />
      <strong>${cfg.name}</strong>
      <span>当前库存 ${inventory}</span>
      <span>成长时间 ${cfg.growTime}</span>
      <span>基础积分 ${cfg.basePoints}</span>
    </div>`;
  }).join("");
  updatePlantModalSummary();
}

function openPlantModal(plotId) {
  pendingPlantPlotId = plotId;
  renderPlantSeedModalCards();
  document.body.classList.add("modal-open");
  $("plantSeedModal")?.classList.add("is-open");
}

function closePlantModal() {
  pendingPlantPlotId = null;
  document.body.classList.remove("modal-open");
  $("plantSeedModal")?.classList.remove("is-open");
}

async function confirmPlantFromModal() {
  const seedType = getSelectedSeedType();
  const inventory = Number(seedInventoryCache[seedType] || 0);
  if (pendingPlantPlotId === null) return;
  if (inventory <= 0) {
    openInfoModal("库存不足", `当前${window.APP_CONFIG.seedConfigs[seedType].name}库存不足，请先购买鱼苗。`);
    return;
  }
  $("plantPlotId").value = pendingPlantPlotId;
  $("plantSeedType").value = String(seedType);
  closePlantModal();
  await handlePlant();
}

function selectShopSeedType(seedType) {
  $("buySeedType").value = String(seedType);
  document.querySelectorAll(".seed-card").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.seedType) === Number(seedType));
  });
  fillBuyCost();
}

function selectSeedType(seedType) {
  $("plantSeedType").value = String(seedType);
  document.querySelectorAll(".plant-choice-card").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.seedType) === Number(seedType));
  });
  updatePlantModalSummary();
}

async function renderSeedCards() {
  const box = $("seedCards");
  if (!box) return;

  if (userAddress && vaultContract) {
    const entries = await Promise.all([0, 1, 2].map(async (seedType) => {
      const inventory = await (readVaultContract || vaultContract).getSeedInventory(userAddress, seedType).catch(() => 0n);
      return [seedType, Number(inventory)];
    }));
    seedInventoryCache = Object.fromEntries(entries);
  }

  box.innerHTML = Object.entries(window.APP_CONFIG.seedConfigs).map(([id, cfg]) => `
    <div class="seed-card seed-card-compact" data-seed-type="${id}" onclick="window.selectShopSeedType(${id})">
      <img class="seed-card-image" src="${SEED_IMAGES[id]}" alt="${cfg.name}" />
      <strong>${cfg.name}</strong>
      <div class="seed-meta">${cfg.tokenCost} ${tokenSymbol}</div>
      <div class="seed-card-mini">库存 ${seedInventoryCache[id] || 0}</div>
    </div>`).join("");
  selectShopSeedType(getShopSelectedSeedType());
  updateShopSummary();
}

function updateCurrentActionGuide() {
  if (!userAddress) {
    setActionGuide("下一步：连接钱包", "连接后即可开始操作。");
    return;
  }
  const hasAnyInventory = Object.values(seedInventoryCache).some((count) => Number(count || 0) > 0);
  const cards = document.querySelectorAll('.pond-card');
  let hasEmpty = false;
  let hasGrowing = false;
  let hasReady = false;
  cards.forEach((card) => {
    if (card.classList.contains('pond-card-empty')) hasEmpty = true;
    if (card.classList.contains('pond-card-growing')) hasGrowing = true;
    if (card.classList.contains('pond-card-ready')) hasReady = true;
  });
  if (hasReady) {
    setActionGuide("下一步：起网", "先收鱼，再继续下一轮。");
  } else if (hasGrowing) {
    setActionGuide("下一步：继续养成", "可增氧，也可设置护网。");
  } else if (hasEmpty && hasAnyInventory) {
    setActionGuide("下一步：投放鱼苗", "点击空闲塘位开始养成。");
  } else {
    setActionGuide("下一步：购买鱼苗", "请在左侧商城购买鱼苗。");
  }
}

async function renderPondCards() {
  const box = $("pondCards");
  if (!box) return;
  const cards = [];
  let hasEmpty = false;
  let hasGrowing = false;
  let hasReady = false;

  if (userAddress && !vaultContract) {
    await ensureWalletContext(userAddress).catch((err) => {
      setDebugChip("debugContractState", `合约：初始化失败`, "error");
      log(`合约初始化失败: ${err?.message || err}`, true);
    });
  }

  const hasWallet = !!userAddress;
  const landCount = hasWallet && vaultContract
    ? Number(await (readVaultContract || vaultContract).getUserLandCount(userAddress).catch(() => 3n))
    : 3;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < 8; i += 1) {
    if (i >= landCount) {
      const nextLand = i + 1;
      const canExpand = hasWallet && nextLand === landCount + 1;
      cards.push(`
        <div class="pond-card pond-card-locked">
          <img class="pond-card-icon" src="./jpg/素材/最高鱼塘.webp" alt="未扩建" />
          <div class="pond-status status-locked">未扩建</div>
          <strong>${i + 1}号塘</strong>
          <div class="pond-badges pond-badges-static">
            <span class="pond-badge">待扩建</span>
            <span class="pond-badge">未解锁</span>
          </div>
          <div class="pond-meta">${canExpand ? `当前可扩建，价格 ${LAND_PRICES[nextLand]} BNB` : (hasWallet ? "扩建更高等级鱼塘后解锁" : "连接钱包后可扩建鱼塘")}</div>
          <div class="pond-card-actions">
            ${canExpand ? `<button class="btn btn-dark btn-block" onclick="window.quickBuyLand('${LAND_PRICES[nextLand]}')">扩建鱼塘</button>` : `<button class="btn btn-dark btn-block" disabled>暂不可扩建</button>`}
          </div>
        </div>`);
      continue;
    }

    if (!hasWallet) {
      cards.push(`
        <div class="pond-card pond-card-default pond-card-empty">
          <img class="pond-card-icon" src="./jpg/素材/投放鱼塘.webp" alt="默认鱼塘" />
          <div class="pond-status status-empty">默认鱼塘</div>
          <strong>${i + 1}号塘</strong>
          <div class="pond-badges pond-badges-static">
            <span class="pond-badge">空闲</span>
            <span class="pond-badge">待连接</span>
          </div>
          <div class="pond-meta">连接钱包后可投放鱼苗并开始养成。</div>
          <div class="pond-card-actions">
            <button class="btn btn-dark btn-block" disabled>连接钱包后操作</button>
          </div>
        </div>`);
      continue;
    }

    const plot = await (readVaultContract || vaultContract).getPlot(userAddress, i).catch(() => null);
    const isEmpty = !plot || !plot.exists || plot.harvested;
    if (isEmpty) {
      hasEmpty = true;
      cards.push(`
        <div class="pond-card pond-card-empty">
          <img class="pond-card-icon" src="./jpg/素材/投放鱼塘.webp" alt="空闲塘位" />
          <div class="pond-status status-empty">空闲</div>
          <strong>${i + 1}号塘</strong>
          <div class="pond-badges pond-badges-static">
            <span class="pond-badge">待投放</span>
            <span class="pond-badge">可操作</span>
          </div>
          <div class="pond-meta">选择鱼苗后即可开始本轮养成。</div>
          <div class="pond-card-actions">
            <button class="btn btn-dark btn-block" onclick="window.quickPlant(${i})">投放鱼塘</button>
          </div>
        </div>`);
      continue;
    }

    const matureAt = Number(plot.matureAt);
    const isMature = matureAt <= now;
    const badges = `
      <div class="pond-badges">
        <span class="pond-badge">增氧 ${plot.fertilizeCount}/3</span>
        <span class="pond-badge ${plot.hasScarecrow ? 'is-on' : ''}">${plot.hasScarecrow ? '已设护网' : '未设护网'}</span>
        <span class="pond-badge">被偷捕 ${plot.stolenCount} 次</span>
      </div>`;

    if (isMature) {
      hasReady = true;
      cards.push(`
        <div class="pond-card pond-card-ready">
          <img class="pond-card-fish pond-card-fish-ready" src="${SEED_IMAGES[plot.seedType]}" alt="成熟鱼苗" />
          <div class="pond-status status-ready">可起网</div>
          <strong>${i + 1}号塘</strong>
          ${badges}
          <div class="pond-meta pond-meta-highlight">本轮鱼苗已成熟，可立即结算</div>
          <div class="pond-card-actions">
            <button class="btn btn-block pond-ready-btn" onclick="window.quickHarvest(${i})">起网</button>
          </div>
        </div>`);
      continue;
    }

    hasGrowing = true;
    cards.push(`
      <div class="pond-card pond-card-growing">
        <img class="pond-card-fish" src="${SEED_IMAGES[plot.seedType]}" alt="养成中鱼苗" />
        <div class="pond-status status-growing">养成中</div>
        <strong>${i + 1}号塘</strong>
        ${badges}
        <div class="pond-meta">剩余 <span class="countdown" data-mature="${matureAt}">计算中</span></div>
        <div class="pond-card-actions">
          <div class="pond-action-row">
            <button class="btn btn-primary btn-block" onclick="window.quickFertilize(${i}, ${plot.seedType})">增氧</button>
            <button class="btn btn-dark btn-block" ${plot.hasScarecrow ? 'disabled' : ''} onclick="window.quickScarecrow(${i})">${plot.hasScarecrow ? '已设护网' : '设置护网'}</button>
          </div>
        </div>
      </div>`);
  }
  box.innerHTML = cards.join("");
  setPondLoading(false);
  setDebugChip("debugPondState", `鱼塘：已渲染 ${landCount}/8`, "ok");
  setTimeout(updateCurrentActionGuide, 0);
}

window.selectShopSeedType = selectShopSeedType;
window.selectSeedType = selectSeedType;
window.quickPlant = function(plotId) {
  $("plantPlotId").value = String(plotId);
  openPlantModal(plotId);
};
function openActionConfirmModal(title, text, costText, onConfirm) {
  pendingActionConfirm = onConfirm;
  $("actionConfirmTitle").textContent = title;
  $("actionConfirmText").textContent = text;
  $("actionConfirmCost").textContent = costText;
  document.body.classList.add("modal-open");
  $("actionConfirmModal")?.classList.add("is-open");
}

function closeActionConfirmModal() {
  pendingActionConfirm = null;
  document.body.classList.remove("modal-open");
  $("actionConfirmModal")?.classList.remove("is-open");
}

function normalizeObservedTarget(item) {
  return typeof item === "string" ? { address: item, label: "观察目标" } : item;
}

function loadObservedTargets() {
  const configured = (window.APP_CONFIG.observeTargets || []).map(normalizeObservedTarget);
  const saved = JSON.parse(localStorage.getItem("flapObservedTargets") || "[]").map(normalizeObservedTarget);
  const map = new Map();
  [...configured, ...saved].forEach((item) => item?.address && map.set(item.address.toLowerCase(), item));
  observedTargets = [...map.values()];
}

function saveObservedTarget(address) {
  if (!address) return;
  const item = { address, label: "最近目标" };
  const map = new Map(observedTargets.map((v) => [v.address.toLowerCase(), v]));
  map.set(address.toLowerCase(), item);
  observedTargets = [...map.values()].slice(-8).reverse();
  localStorage.setItem("flapObservedTargets", JSON.stringify(observedTargets));
}

async function getObservedTargetSummary(address) {
  const contract = readVaultContract || vaultContract;
  const landCount = Number(await contract.getUserLandCount(address).catch(() => 0n));
  const now = Math.floor(Date.now() / 1000);
  const plots = [];
  for (let i = 0; i < landCount; i += 1) {
    const plot = await contract.getPlot(address, i).catch(() => null);
    if (!plot || !plot.exists || plot.harvested || Number(plot.matureAt) <= now) continue;
    const left = Math.max(0, Number(plot.matureAt) - now);
    plots.push({ plotId: i, risky: !plot.hasScarecrow, near: left <= 900, left });
  }
  return {
    total: plots.length,
    risky: plots.filter((v) => v.risky).length,
    near: plots.filter((v) => v.near).length,
    plots
  };
}

async function renderObservedTargets() {
  const box = $("observeTargetList");
  if (!box) return;
  if (!userAddress || !(readVaultContract || vaultContract)) {
    box.innerHTML = '<div class="observe-target-empty">连接钱包后即可查看可观察目标。</div>';
    return;
  }
  if (!observedTargets.length) {
    box.innerHTML = '<div class="observe-target-empty">暂无目标记录。先手动输入一次，后续会自动记录。</div>';
    return;
  }
  const cards = await Promise.all(observedTargets.map(async (item) => {
    const summary = await getObservedTargetSummary(item.address);
    const chips = summary.plots.length ? summary.plots.map((plot) => `<button class="observe-plot-chip ${plot.risky ? "is-risky" : ""}" onclick="window.pickObservedTarget('${item.address}', ${plot.plotId})">${plot.plotId + 1}号塘${plot.risky ? ' · 无护网' : ''}${plot.near ? ' · 临近成熟' : ''}</button>`).join("") : '<div class="observe-target-empty">暂无养成中塘位</div>';
    return `<div class="observe-target-card"><div class="observe-target-top"><strong>${item.label || '观察目标'}</strong><span>${formatAddress(item.address)}</span></div><div class="observe-target-meta">养成中 <b>${summary.total}</b> · 无护网 <b>${summary.risky}</b> · 临近成熟 <b>${summary.near}</b></div><div class="observe-target-plots">${chips}</div></div>`;
  }));
  box.innerHTML = cards.join("");
}

function openObserveDrawer() {
  document.body.classList.add("modal-open");
  $("observeDrawer")?.classList.add("is-open");
  renderObservedTargets().catch((err) => log(`目标榜单刷新异常: ${getErrorMessage(err)}`, true));
}

function closeObserveDrawer() {
  document.body.classList.remove("modal-open");
  $("observeDrawer")?.classList.remove("is-open");
}

async function submitActionConfirm() {
  const action = pendingActionConfirm;
  closeActionConfirmModal();
  if (typeof action === "function") await action();
}

window.quickFertilize = function(plotId, seedType) {
  $("fertilizePlotId").value = plotId;
  const actualSeedType = Number(seedType);
  const price = window.APP_CONFIG.seedConfigs[actualSeedType]?.fertilizePrice || $("fertilizeValue").value || "0";
  $("fertilizeValue").value = price;
  openActionConfirmModal("确认增氧", `确认对 ${Number(plotId) + 1}号塘 进行增氧吗？`, `本次将消耗 ${price} BNB`, () => handleFertilize());
};
window.quickScarecrow = function(plotId) {
  $("scarecrowPlotId").value = plotId;
  const price = window.APP_CONFIG.fixedScarecrowPrice || $("scarecrowValue").value || "0";
  $("scarecrowValue").value = price;
  openActionConfirmModal("确认设置护网", `确认对 ${Number(plotId) + 1}号塘 设置护网吗？`, `本次将消耗 ${price} BNB`, () => handleScarecrow());
};
window.quickHarvest = function(plotId) {
  $("harvestPlotId").value = plotId;
  handleHarvest();
};
window.quickBuyLand = function(value) {
  $("buyLandValue").value = value;
  handleBuyLand();
};
window.pickObservedTarget = function(address, plotId) {
  $("stealTarget").value = address;
  $("stealPlotId").value = String(Number(plotId) + 1);
  closeObserveDrawer();
  toast(`已带入 ${formatAddress(address)} 的 ${plotId + 1}号塘`);
};

setInterval(() => {
  let shouldRefreshPonds = false;
  document.querySelectorAll('.countdown').forEach((el) => {
    const matureAt = Number(el.getAttribute('data-mature'));
    const left = Math.max(0, matureAt - Math.floor(Date.now() / 1000));
    if (left === 0) {
      if (!el.dataset.matureHandled) {
        el.dataset.matureHandled = "1";
        el.textContent = "已成熟，正在更新...";
        shouldRefreshPonds = true;
      }
    } else {
      const m = Math.floor(left / 60);
      const s = left % 60;
      el.textContent = m + "分 " + s + "秒";
    }
  });
  if (shouldRefreshPonds) {
    renderPondCards().catch((err) => log(`鱼塘自动刷新异常: ${getErrorMessage(err)}`, true));
    updateCurrentActionGuide();
  }
}, 1000);

function bindEvents() {
  $("connectBtn").addEventListener("click", connectWallet);
  $("refreshAllBtn").addEventListener("click", refreshAll);

  $("fillBuyCostBtn").addEventListener("click", fillBuyCost);

  $("bindReferrerBtn").addEventListener("click", handleBindReferrer);
  $("buySeedBtn").addEventListener("click", handleBuySeed);
  $("plantBtn").addEventListener("click", handlePlant);
  $("buyLandBtn").addEventListener("click", handleBuyLand);
  $("fertilizeBtn").addEventListener("click", handleFertilize);
  $("scarecrowBtn").addEventListener("click", handleScarecrow);
  $("stealBtn").addEventListener("click", handleSteal);
  $("harvestBtn").addEventListener("click", handleHarvest);
  $("claimBtn").addEventListener("click", handleClaim);

  $("loadInventoryBtn").addEventListener("click", loadInventory);
  $("loadPlotBtn").addEventListener("click", loadPlot);

  $("buySeedType").addEventListener("change", fillBuyCost);
  $("buySeedAmount").addEventListener("input", fillBuyCost);
  $("buySeedMinusBtn")?.addEventListener("click", () => adjustBuySeedAmount(-1));
  $("buySeedPlusBtn")?.addEventListener("click", () => adjustBuySeedAmount(1));
  $("stealPlotId")?.addEventListener("input", normalizeStealPlotDisplay);
  $("stealPlotMinusBtn")?.addEventListener("click", () => adjustStealPlotId(-1));
  $("stealPlotPlusBtn")?.addEventListener("click", () => adjustStealPlotId(1));
  $("closePlantModalBtn")?.addEventListener("click", closePlantModal);
  $("confirmPlantBtn")?.addEventListener("click", confirmPlantFromModal);
  $("plantSeedModal")?.addEventListener("click", (e) => {
    if (e.target === $("plantSeedModal")) closePlantModal();
  });
  $("closeActionConfirmBtn")?.addEventListener("click", closeActionConfirmModal);
  $("cancelActionConfirmBtn")?.addEventListener("click", closeActionConfirmModal);
  $("submitActionConfirmBtn")?.addEventListener("click", submitActionConfirm);
  $("actionConfirmModal")?.addEventListener("click", (e) => {
    if (e.target === $("actionConfirmModal")) closeActionConfirmModal();
  });
  $("closeInfoModalBtn")?.addEventListener("click", closeInfoModal);
  $("confirmInfoModalBtn")?.addEventListener("click", closeInfoModal);
  $("infoModal")?.addEventListener("click", (e) => {
    if (e.target === $("infoModal")) closeInfoModal();
  });
  $("openObserveDrawerBtn")?.addEventListener("click", openObserveDrawer);
  $("closeObserveDrawerBtn")?.addEventListener("click", closeObserveDrawer);
  $("observeDrawer")?.addEventListener("click", (e) => {
    if (e.target === $("observeDrawer")) closeObserveDrawer();
  });
  $("openActivityModalBtn")?.addEventListener("click", openActivityModal);
  $("closeActivityModalBtn")?.addEventListener("click", closeActivityModal);
  $("activityModal")?.addEventListener("click", (e) => {
    if (e.target === $("activityModal")) closeActivityModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("plantSeedModal")?.classList.contains("is-open")) closePlantModal();
    if (e.key === "Escape" && $("actionConfirmModal")?.classList.contains("is-open")) closeActionConfirmModal();
    if (e.key === "Escape" && $("infoModal")?.classList.contains("is-open")) closeInfoModal();
    if (e.key === "Escape" && $("observeDrawer")?.classList.contains("is-open")) closeObserveDrawer();
    if (e.key === "Escape" && $("activityModal")?.classList.contains("is-open")) closeActivityModal();
  });
}

async function syncConnectedAccount() {
  setPondLoading(true, "正在识别钱包状态", "请稍候，正在确认是否已连接并同步鱼塘...");
  const injected = getWalletProvider();
  if (!injected) {
    setDebugChip("debugWalletState", "钱包：未检测到可用钱包", "error");
    await renderPondCards();
    return;
  }

  const accounts = await injected.request({ method: "eth_accounts" });
  const account = accounts?.[0];
  setConnectState(account);
  updateDebugState();

  if (!account) {
    userAddress = "";
    signer = undefined;
    provider = undefined;
    vaultContract = undefined;
    tokenContract = undefined;
    if ($("mySeasonTickets")) $("mySeasonTickets").textContent = "-";
    updateReferrerBindingUI("");
    updateDebugState();
    setDebugChip("debugPondState", "鱼塘：展示默认 3 个鱼塘", "warn");
    await renderPondCards();
    updateCurrentActionGuide();
    return;
  }

  await ensureWalletContext(account);
  startAutoRefresh();
  await refreshAll();
  await renderPondCards();
  updateCurrentActionGuide();
}

function initPlayPage() {
  document.body.classList.add("play-entering");
  startPageLoader();
  bindEvents();
  loadObservedTargets();
  fillDefaultValues();
  updateDebugState();
  setActionGuide("下一步：先选择鱼苗", "在左侧鱼苗商城选择想投放的鱼苗，再到空闲塘位开始养成。");
  setDebugChip("debugPondState", "鱼塘：初始化中", "warn");
  setPondLoading(true, "正在识别钱包状态", "首次进入页面时，鱼塘会先自动检查钱包连接状态。");
  initReadContracts().then(() => {
    refreshLivePanels().catch(() => {});
    startAutoRefresh();
    startActivityFeed();
  }).catch((err) => log(`只读合约初始化失败: ${getErrorMessage(err)}`, true));
  renderSeedCards().catch(() => {});
  updateCurrentActionGuide();
  log("页面初始化完成，请先连接钱包");
  syncConnectedAccount().catch((err) => {
    log(`自动同步钱包失败: ${err?.message || err}`, true);
    renderPondCards().catch(() => {});
  });
  finishPageLoader();

  const injected = getWalletProvider();
  injected?.on?.("accountsChanged", async (accounts) => {
    const account = accounts?.[0] || "";
    userAddress = account;
    setConnectState(account);
    $("walletAddress").textContent = formatAddress(account);
    $("plotUserAddress").placeholder = account || "默认当前钱包地址";

    if (account) {
      await ensureWalletContext(account);
      startAutoRefresh();
      await refreshAll();
      updateCurrentActionGuide();
    } else {
      signer = undefined;
      provider = undefined;
      vaultContract = undefined;
      tokenContract = undefined;
      if ($("mySeasonTickets")) $("mySeasonTickets").textContent = "-";
      updateReferrerBindingUI("");
      await renderPondCards();
      updateCurrentActionGuide();
    }
  });
  injected?.on?.("chainChanged", () => {
    window.location.reload();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPlayPage, { once: true });
} else {
  initPlayPage();
}
