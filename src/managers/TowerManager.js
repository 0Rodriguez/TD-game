import Tower from '../components/Tower.js';

const CELL_SIZE = 40;
const GRID_COLS = 20;
const GRID_ROWS = 15;
const FONT      = '"Georgia", "Palatino Linotype", serif';

const DEFAULT_CONFIG = {
  cost:        100,
  range:       120,
  fireRate:    1200,
  damage:      20,
  bulletSpeed: 260,
};

export default class TowerManager {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.scene          = scene;
    this.towers         = [];
    this.selectedConfig = { ...DEFAULT_CONFIG };

    // ── Sell-menu state ──────────────────────────────────────────────────────
    this._sellMenu      = null;  // the floating sell-button Container
    this._sellTowerRef  = null;  // which tower the menu belongs to
    this._justOpened    = false; // prevents same-click-dismiss on open

    // Global pointerdown: dismiss sell menu when clicking anywhere else.
    // Event order in Phaser 3: game-object events fire FIRST, then scene input.
    // When a tower is clicked  → tower's pointerdown fires (sets _justOpened=true)
    //                          → scene input fires        (sees flag, skips close)
    // When sell btn is clicked → btn's pointerdown fires  (_closeSellMenu called)
    //                          → scene input fires        (_sellMenu is null, no-op)
    // When clicking elsewhere  → scene input fires        (closes menu)
    this.scene.input.on('pointerdown', () => {
      if (this._justOpened) {
        this._justOpened = false;
        return;
      }
      if (this._sellMenu) this._closeSellMenu();
    });
  }

  // ---- Placement -----------------------------------------------------------

  /**
   * Validates, deducts gold, marks the grid, and spawns a Tower.
   * Stores gridCol / gridRow in the tower for sell-time grid restoration.
   *
   * Grid states:  0 = free  |  1 = path  |  2 = tower
   */
  tryPlaceTower(pointer, grid) {
    const col = Math.floor(pointer.x / CELL_SIZE);
    const row = Math.floor(pointer.y / CELL_SIZE);

    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    if (grid[row][col] !== 0)                  return;
    if (this.scene.gold < this.selectedConfig.cost) return;

    this.scene.gold -= this.selectedConfig.cost;
    grid[row][col]   = 2;

    const worldX = col * CELL_SIZE + CELL_SIZE / 2;
    const worldY = row * CELL_SIZE + CELL_SIZE / 2;

    const tower = new Tower(this.scene, worldX, worldY, {
      ...this.selectedConfig,
      gridCol: col,  // stored for grid restoration on sell
      gridRow: row,
    });
    this.towers.push(tower);

    // Click on placed tower → open / toggle sell menu
    tower.on('pointerdown', () => {
      this.scene._uiIntercepted = true; // raise shield — clicking a tower must never place another
      if (this._sellTowerRef === tower) {
        this._closeSellMenu();
        this._justOpened = true;
      } else {
        this._openSellMenu(tower);
      }
    });

    // Modern range indicator on hover: clean blue-ink concentric circle.
    // Lives in scene space (not as a tower child) so it isn't affected by
    // the tower's scale/rotation; destroyed immediately on pointerout or sell.
    tower.on('pointerover', () => this._showRangeIndicator(tower));
    tower.on('pointerout',  () => this._hideRangeIndicator(tower));
  }

  // ---- Range indicator -----------------------------------------------------

  _showRangeIndicator(tower) {
    // Defensive: if one already exists (e.g. rapid hover), kill the old first.
    this._hideRangeIndicator(tower);

    const g = this.scene.add.graphics().setDepth(4); // below towers (6), above grid
    // Extremely tenuous fill — barely visible, hints the area without dominating
    g.fillStyle(0x2a4a8a, 0.04);
    g.fillCircle(tower.x, tower.y, tower.config.range);
    // Crisp hairline outline — the "perimeter" the player actually reads
    g.lineStyle(1.5, 0x2a4a8a, 0.25);
    g.strokeCircle(tower.x, tower.y, tower.config.range);

    tower._rangeIndicator = g;
  }

  _hideRangeIndicator(tower) {
    if (tower._rangeIndicator) {
      tower._rangeIndicator.destroy();
      tower._rangeIndicator = null;
    }
  }

  // ---- Update --------------------------------------------------------------

  updateAll(time, activeEnemies) {
    for (const tower of this.towers) {
      if (tower.active) tower.update(time, activeEnemies);
    }
  }

  // ---- Tower context menu (sell + upgrade) ---------------------------------

  /**
   * Floating dual-action panel above a clicked tower.
   *
   *  ┌───────────────────────────────┐
   *  │  💰  vender  ·  +70g          │
   *  ├───────────────────────────────┤
   *  │  🔼  mejorar  ·  nivel 2 · 75g│
   *  └───────────────────────────────┘
   *
   * Lives in SCENE space (not as a Tower child) so its position is global
   * regardless of tower scaling/rotation.  Re-uses _closeSellMenu /
   * _justOpened plumbing the old single-button menu had.
   */
  _openSellMenu(tower) {
    this._closeSellMenu(); // dismiss any existing menu first

    const scene = this.scene;

    // Layout — full panel ~190 wide, two stacked rows
    const W    = 190;
    const ROW_H = 30;
    const GAP  = 4;
    const H    = ROW_H * 2 + GAP + 12; // outer padding 6 top + 6 bottom

    // Anchor: above the tower's WORLD position.  We compensate for scaled
    // towers so the panel stays visually anchored.
    const mx = tower.x;
    const my = tower.y - 18 * (tower.scaleY ?? 1) - 38;

    // ── Backdrop card (rounded, hairline border, subtle shadow) ─────────
    const card = scene.make.graphics({ add: false });
    // Soft shadow
    card.fillStyle(0x000000, 0.07);
    card.fillRoundedRect(-W / 2 + 1, -H / 2 + 2, W, H, 12);
    // Main fill
    card.fillStyle(0xfaf7f1, 0.97);
    card.fillRoundedRect(-W / 2, -H / 2, W, H, 12);
    card.lineStyle(1, 0xb8b0a0, 0.55);
    card.strokeRoundedRect(-W / 2, -H / 2, W, H, 12);

    // ── Row 1: SELL button ──────────────────────────────────────────────
    const sellRowY = -H / 2 + 6 + ROW_H / 2;
    const sellBg   = scene.make.graphics({ add: false });
    sellBg.fillStyle(0xfff3f0, 0);
    sellBg.fillRoundedRect(-W / 2 + 6, sellRowY - ROW_H / 2, W - 12, ROW_H, 8);

    const sellText = scene.add.text(0, sellRowY,
      `💰  vender  ·  +${tower.sellPrice}g`,
      { fontFamily: FONT, fontSize: '13px', color: '#1a1a1a' }
    ).setOrigin(0.5, 0.5);

    // Hit zone for the sell row
    const sellZone = scene.add.zone(0, sellRowY, W - 12, ROW_H)
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });

    sellZone.on('pointerover', () => {
      sellBg.clear();
      sellBg.fillStyle(0xfde4dc, 0.85);
      sellBg.fillRoundedRect(-W / 2 + 6, sellRowY - ROW_H / 2, W - 12, ROW_H, 8);
      sellText.setStyle({ color: '#8a3030' });
    });
    sellZone.on('pointerout', () => {
      sellBg.clear();
      sellText.setStyle({ color: '#1a1a1a' });
    });
    sellZone.on('pointerdown', () => {
      this.scene._uiIntercepted = true;
      this._sellTower(tower);
      this._closeSellMenu();
    });

    // ── Row 2: UPGRADE button (or maxed-out indicator) ──────────────────
    const upRowY = sellRowY + ROW_H + GAP;
    const upBg   = scene.make.graphics({ add: false });

    const canUp     = tower.canUpgrade;
    const upCost    = tower.upgradeCost;
    const canAfford = canUp && scene.gold >= upCost;

    const upLabel = !canUp
      ? `★  nivel máximo (${tower.level}/${tower.maxLevel})`
      : `🔼  mejorar  ·  nv ${tower.level + 1}  ·  ${upCost}g`;

    const upText = scene.add.text(0, upRowY, upLabel, {
      fontFamily: FONT, fontSize: '13px',
      color: !canUp ? '#888888' : (canAfford ? '#1a1a1a' : '#9a948a'),
    }).setOrigin(0.5, 0.5);

    let upZone = null;
    if (canUp) {
      upZone = scene.add.zone(0, upRowY, W - 12, ROW_H)
        .setOrigin(0.5, 0.5)
        .setInteractive({ useHandCursor: canAfford });

      upZone.on('pointerover', () => {
        upBg.clear();
        upBg.fillStyle(canAfford ? 0xe5ecf8 : 0xf0eee8, 0.85);
        upBg.fillRoundedRect(-W / 2 + 6, upRowY - ROW_H / 2, W - 12, ROW_H, 8);
        if (canAfford) upText.setStyle({ color: '#2a4a8a' });
      });
      upZone.on('pointerout', () => {
        upBg.clear();
        upText.setStyle({ color: canAfford ? '#1a1a1a' : '#9a948a' });
      });
      upZone.on('pointerdown', () => {
        this.scene._uiIntercepted = true;
        if (!canAfford) return; // visual feedback only — no-op
        this._upgradeTower(tower);
        this._closeSellMenu();
        // Re-open at the (possibly new) state so the player can keep upgrading
        this._openSellMenu(tower);
      });
    }

    // ── Assemble container in SCENE space ───────────────────────────────
    const children = [card, sellBg, upBg, sellText, upText, sellZone];
    if (upZone) children.push(upZone);
    const container = scene.add.container(mx, my, children).setDepth(25);

    // Generous outer hit zone — clicks anywhere on the card belong to the menu,
    // but the per-row zones take precedence (they're added last → above).
    container.setInteractive(
      new Phaser.Geom.Rectangle(-W / 2 - 6, -H / 2 - 6, W + 12, H + 12),
      Phaser.Geom.Rectangle.Contains
    );
    container.on('pointerdown', () => {
      // Block placement when the card itself absorbs a click (e.g. between
      // rows).  Per-row zones already raise the flag in their own handlers.
      this.scene._uiIntercepted = true;
    });

    // Track child references so we can tear them down cleanly on close.
    container._owned = [card, sellBg, upBg, sellText, upText, sellZone];
    if (upZone) container._owned.push(upZone);

    this._sellMenu     = container;
    this._sellTowerRef = tower;
    this._justOpened   = true;
  }

  /**
   * Tears down the contextual menu and all child objects it owns.
   * Container.destroy() destroys its children, but Zones and scene-added
   * Text objects can outlive the container in some scenarios — we destroy
   * them explicitly to avoid input-listener leaks.
   */
  _closeSellMenu() {
    if (!this._sellMenu) return;
    const owned = this._sellMenu._owned || [];
    for (const o of owned) {
      if (o && o.active) {
        // Remove input listeners on zones explicitly
        if (o.input) o.removeAllListeners();
        o.destroy();
      }
    }
    this._sellMenu.removeAllListeners();
    this._sellMenu.destroy();
    this._sellMenu     = null;
    this._sellTowerRef = null;
  }

  // ---- Upgrade ------------------------------------------------------------

  /**
   * Pays the upgrade cost, bumps the tower's level, and reports the change.
   * Returns false if the tower can't be upgraded or the player can't afford.
   */
  _upgradeTower(tower) {
    if (!tower.canUpgrade) return false;
    const cost = tower.upgradeCost;
    if (this.scene.gold < cost) return false;

    this.scene.gold -= cost;
    return tower.upgrade();
  }

  /**
   * Sells a tower: refunds 70 % of its cost, frees its grid cell,
   * removes it from the active array, and destroys the Container + children.
   */
  _sellTower(tower) {
    // Refund
    this.scene.gold += tower.sellPrice;

    // Free the grid cell — read col/row from the values stored at placement
    const grid = this.scene.grid;
    if (grid && tower.config.gridRow >= 0 && tower.config.gridCol >= 0) {
      grid[tower.config.gridRow][tower.config.gridCol] = 0;
    }

    // Remove from active towers list
    this.towers = this.towers.filter(t => t !== tower);

    // Range indicator is scene-owned — kill it before destroying the tower
    // or its Graphics would orphan in the scene.
    this._hideRangeIndicator(tower);

    // Destroy Container and all its Graphics/Image children
    tower.destroy();
  }

  // ---- Level reset ---------------------------------------------------------

  /**
   * Destroys every placed tower (no refund) and empties the array.
   * Used when advancing to the next campaign level.
   */
  destroyAll() {
    this._closeSellMenu();
    for (const tower of [...this.towers]) {
      // Also kill any lingering range indicator (scene-owned Graphics)
      this._hideRangeIndicator(tower);
      if (tower.active) tower.destroy();
    }
    this.towers = [];
  }

  // ---- Accessors -----------------------------------------------------------

  getCount() {
    return this.towers.filter(t => t.active).length;
  }
}
