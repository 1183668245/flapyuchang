window.CAIFARM_VAULT_ABI = [
  "error TokenNotBound()",
  "error InvalidToken()",
  "error InvalidReceiver()",
  "error InvalidSeedType()",
  "error InvalidAmount()",
  "error InvalidValue()",
  "error MaxLandReached()",
  "error PlotNotAvailable()",
  "error PlotNotFound()",
  "error NotPlotOwner()",
  "error NotMature()",
  "error AlreadyHarvested()",
  "error TooEarlyToSteal()",
  "error TooLateToSteal()",
  "error CannotStealSelf()",
  "error StealLimitReached()",
  "error AlreadyHasScarecrow()",
  "error FertilizeLimitReached()",
  "error AlreadyMature()",
  "error InStealWindow()",
  "error SeasonNotEnded()",
  "error NoTickets()",
  "error AlreadyClaimed()",
  "error TransferFailed()",
  "error ReferrerAlreadyBound()",
  "error InvalidReferrer()",

  "event Planted(address indexed user, uint256 indexed plotId, uint8 seedType, uint256 matureAt)",
  "event Stolen(address indexed thief, address indexed victim, uint256 indexed plotId, uint256 stolenTickets)",

  "function taxToken() view returns (address)",
  "function vault() view returns (uint256 balance, uint256 current, uint256 rollover, uint256 ops)",
  "function season() view returns (uint256 id, uint256 endTime, uint256 tickets, string releaseRate)",

  "function bindReferrer(address referrer)",
  "function buySeedWithCost(uint8 seedType, uint256 amount, uint256 tokenCost)",
  "function plant(uint256 plotId, uint8 seedType)",
  "function buyLand() payable",
  "function fertilize(uint256 plotId) payable",
  "function placeScarecrow(uint256 plotId) payable",
  "function stealWithCost(address target, uint256 plotId, uint256 tokenCost)",
  "function harvest(uint256 plotId)",
  "function claimSeason(uint256 seasonId)",

  "function referrerOf(address user) view returns (address)",
  "function getUserTickets(uint256 seasonId, address user) view returns (uint256)",
  "function getUserLandCount(address user) view returns (uint256)",
  "function getSeedInventory(address user, uint8 seedType) view returns (uint256)",
  "function getPlot(address user, uint256 plotId) view returns (tuple(address owner,uint8 seedType,uint256 plantedAt,uint256 matureAt,uint8 fertilizeCount,uint8 stolenCount,uint16 stolenBps,bool hasScarecrow,bool harvested,bool exists))"
];

window.ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];