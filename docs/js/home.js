(function () {
  const $ = (id) => document.getElementById(id);

  const connectBtn = $("connectBtn");
  const openGuideBtn = $("openGuideBtn");
  const openGuideBtnBottom = $("openGuideBtnBottom");
  const openGuideNavBtn = $("openGuideNavBtn");
  const openGuideNavBtnBottom = $("openGuideNavBtnBottom");
  const closeGuideBtn = $("closeGuideBtn");
  const guideModal = $("guideModal");

  const openFaqBtn = $("openFaqBtn");
  const openFaqBtnBottom = $("openFaqBtnBottom");
  const closeFaqBtn = $("closeFaqBtn");
  const faqModal = $("faqModal");

  const homeInfoModal = $("homeInfoModal");
  const closeHomeInfoBtn = $("closeHomeInfoBtn");
  const confirmHomeInfoBtn = $("confirmHomeInfoBtn");

  function getWalletProvider() {
    const list = window.ethereum?.providers?.length ? window.ethereum.providers : (window.ethereum ? [window.ethereum] : []);
    return list.find((p) => p?.isMetaMask)
      || list.find((p) => p?.isOKXWallet || p?.isOkxWallet)
      || list.find((p) => p?.isTokenPocket)
      || list.find((p) => p?.isBitKeep || p?.isBitgetWallet)
      || list.find((p) => p?.isCoinbaseWallet)
      || list.find((p) => p?.isTrust || p?.isTrustWallet)
      || list.find((p) => p?.request)
      || null;
  }

  function setConnectState(account) {
    if (!connectBtn) return;
    if (account) {
      connectBtn.textContent = `${account.slice(0, 6)}...${account.slice(-4)}`;
      connectBtn.classList.add("btn-connected");
      connectBtn.title = account;
    } else {
      connectBtn.textContent = "连接钱包";
      connectBtn.classList.remove("btn-connected");
      connectBtn.removeAttribute("title");
    }
  }

  async function syncConnectedAccount() {
    const injected = getWalletProvider();
    if (!injected) return;
    const accounts = await injected.request({ method: "eth_accounts" });
    setConnectState(accounts?.[0]);
  }

  function openHomeInfo(title = "提示", text = "请先完成当前操作。") {
    $("homeInfoTitle").textContent = title;
    $("homeInfoText").textContent = text;
    homeInfoModal?.classList.remove("hidden");
  }

  function closeHomeInfo() {
    homeInfoModal?.classList.add("hidden");
  }

  async function connectWallet() {
    const injected = getWalletProvider();
    if (!injected) {
      openHomeInfo("未检测到钱包", "请在 MetaMask、OKX、TokenPocket、Bitget 等钱包浏览器中打开，或先安装浏览器钱包。");
      return;
    }

    try {
      const accounts = await injected.request({ method: "eth_requestAccounts" });
      setConnectState(accounts?.[0]);
    } catch (err) {
      openHomeInfo("连接钱包失败", err?.message || "请稍后重试。");
    }
  }

  function openGuide(e) {
    if (e) e.preventDefault();
    guideModal?.classList.remove("hidden");
  }

  function closeGuide() {
    guideModal?.classList.add("hidden");
  }

  function openFaq(e) {
    e.preventDefault();
    faqModal?.classList.remove("hidden");
  }

  function closeFaq() {
    faqModal?.classList.add("hidden");
  }

  connectBtn?.addEventListener("click", connectWallet);
  openGuideBtn?.addEventListener("click", openGuide);
  openGuideBtnBottom?.addEventListener("click", openGuide);
  openGuideNavBtn?.addEventListener("click", openGuide);
  openGuideNavBtnBottom?.addEventListener("click", openGuide);
  closeGuideBtn?.addEventListener("click", closeGuide);

  openFaqBtn?.addEventListener("click", openFaq);
  openFaqBtnBottom?.addEventListener("click", openFaq);
  closeFaqBtn?.addEventListener("click", closeFaq);
  closeHomeInfoBtn?.addEventListener("click", closeHomeInfo);
  confirmHomeInfoBtn?.addEventListener("click", closeHomeInfo);

  guideModal?.addEventListener("click", (e) => {
    if (e.target === guideModal) {
      closeGuide();
    }
  });

  faqModal?.addEventListener("click", (e) => {
    if (e.target === faqModal) {
      closeFaq();
    }
  });

  homeInfoModal?.addEventListener("click", (e) => {
    if (e.target === homeInfoModal) {
      closeHomeInfo();
    }
  });

  const injected = getWalletProvider();
  injected?.on?.("accountsChanged", (accounts) => {
    setConnectState(accounts?.[0]);
  });
  injected?.on?.("chainChanged", () => {
    syncConnectedAccount();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !homeInfoModal?.classList.contains("hidden")) closeHomeInfo();
  });

  syncConnectedAccount();
})();