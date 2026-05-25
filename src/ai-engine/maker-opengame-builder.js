import fs from 'fs/promises';
import path from 'path';

const SUPPORTED_OPENGAME_TEMPLATE_IDS = new Set([
    'phaser-top-down-action',
]);

function tsString(value) {
    return JSON.stringify(String(value || ''));
}

function summarizeSlots(assetContract = null) {
    return (Array.isArray(assetContract?.slots) ? assetContract.slots : [])
        .map((slot) => ({
            id: String(slot?.id || slot?.key || slot?.name || '').trim(),
            role: String(slot?.role || slot?.id || slot?.key || slot?.name || '').trim(),
            required: slot?.required !== false,
        }))
        .filter((slot) => slot.id || slot.role);
}

function inferTheme(qualityIntent = {}, prompt = '') {
    const joined = [
        qualityIntent.title,
        qualityIntent.playableExperience,
        ...(qualityIntent.playerActions || []),
        ...(qualityIntent.feelRules || []),
        prompt,
    ].join(' ').toLowerCase();
    if (/slice|fruit|cut|blade|cleaver|ninja|swipe/.test(joined)) {
        return {
            id: 'precision_slice',
            title: qualityIntent.title || 'Kinetic Slice',
            actionVerb: 'Slice',
            primaryObject: 'fruit',
            hazard: 'bomb',
            mechanic: 'swipe-to-slice',
            scoreLabel: 'combo',
        };
    }
    return {
        id: 'arena_action',
        title: qualityIntent.title || 'Arcade Arena',
        actionVerb: 'Strike',
        primaryObject: 'target',
        hazard: 'hazard',
        mechanic: 'pointer action',
        scoreLabel: 'score',
    };
}

export function shouldUseOpenGameMakerBuilder(_templateContract = null) {
    return false;
}

export function buildOpenGameMakerSource({
    qualityIntent = {},
    prompt = '',
    assetContract = null,
    generatedAssets = null,
} = {}) {
    const theme = inferTheme(qualityIntent, prompt);
    const requiredSlots = summarizeSlots(assetContract);
    const roleLiterals = Array.from(new Set([
        ...requiredSlots.flatMap((slot) => [slot.id, slot.role]),
        'player',
        'enemy',
        'item',
        'primary_enemy',
        'background',
        'environment',
        'effect',
        'prop',
    ].filter(Boolean)));
    const title = theme.title;
    const assetSummary = {
        slots: requiredSlots,
        roles: roleLiterals,
        generatedAssetCount: Object.keys(generatedAssets?.assets || {}).length,
    };

    return `import Phaser from 'phaser';
import './styles/tailwind.css';

(window as any).Phaser = Phaser;

type SpawnKind = 'item' | 'enemy';

type FlyingTarget = {
  sprite: Phaser.Physics.Arcade.Sprite;
  kind: SpawnKind;
  role: string;
  sliced: boolean;
  bornAt: number;
};

type SlashPoint = { x: number; y: number; t: number };

const GAME_TITLE = ${tsString(title)};
const THEME = ${JSON.stringify(theme, null, 2)} as const;
const REQUIRED_ASSET_ROLES = ${JSON.stringify(roleLiterals, null, 2)} as const;
const ASSET_CONTRACT_SUMMARY = ${JSON.stringify(assetSummary, null, 2)} as const;
const SAFE_WIDTH = 390;
const SAFE_HEIGHT = 844;

function dreamAssets(): any {
  return (window as any).DreamAssets || null;
}

function markRendered(key: string, role: string) {
  try {
    dreamAssets()?.markRendered?.(key, role);
  } catch {}
}

function firstAssetKey(...roles: string[]): string | null {
  const runtime = dreamAssets();
  for (const role of roles) {
    const entry = runtime?.firstByRole?.(role);
    const key = entry?.key || entry?.runtimeKey || entry?.id || null;
    if (typeof key === 'string' && key.length > 0) return key;
  }
  const pack = (window as any).DREAM_ASSET_PACK;
  const list = Array.isArray(pack) ? pack : Array.isArray(pack?.meta?.runtimeAssets) ? pack.meta.runtimeAssets : [];
  for (const role of roles) {
    const entry = list.find((asset: any) => asset?.role === role || asset?.category === role || asset?.id === role);
    const key = entry?.key || entry?.runtimeKey || entry?.id || null;
    if (typeof key === 'string' && key.length > 0) return key;
  }
  return null;
}

function createFallbackTexture(scene: Phaser.Scene, key: string, color: number, accent: number, size = 96): string {
  if (scene.textures.exists(key)) return key;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(color, 1);
  graphics.fillCircle(size / 2, size / 2, size * 0.42);
  graphics.lineStyle(6, 0x111111, 1);
  graphics.strokeCircle(size / 2, size / 2, size * 0.42);
  graphics.fillStyle(accent, 1);
  graphics.fillCircle(size * 0.35, size * 0.32, size * 0.1);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
  return key;
}

function createSlashTexture(scene: Phaser.Scene): string {
  const key = 'opengame_fallback_slash';
  if (scene.textures.exists(key)) return key;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.lineStyle(14, 0xffffff, 0.95);
  graphics.beginPath();
  graphics.arc(64, 64, 48, Phaser.Math.DegToRad(210), Phaser.Math.DegToRad(320));
  graphics.strokePath();
  graphics.lineStyle(6, 0x00f0ff, 0.9);
  graphics.beginPath();
  graphics.arc(64, 64, 42, Phaser.Math.DegToRad(210), Phaser.Math.DegToRad(320));
  graphics.strokePath();
  graphics.generateTexture(key, 128, 128);
  graphics.destroy();
  return key;
}

class GameScene extends Phaser.Scene {
  private targets: FlyingTarget[] = [];
  private slash: SlashPoint[] = [];
  private score = 0;
  private combo = 0;
  private lives = 3;
  private nextSpawnAt = 0;
  private itemKey = '';
  private enemyKey = '';
  private playerKey = '';
  private backgroundKey = '';
  private effectKey = '';
  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private announcerText!: Phaser.GameObjects.Text;
  private slashGraphics!: Phaser.GameObjects.Graphics;
  private lastSliceAt = 0;
  private playerState = { x: SAFE_WIDTH / 2, y: SAFE_HEIGHT * 0.72, health: 3 };
  private probeProjectileCount = 0;
  private bladeHint?: Phaser.GameObjects.Image;

  constructor() {
    super('GameScene');
  }

  preload() {
    dreamAssets()?.preloadPhaser?.(this);
  }

  create() {
    this.cameras.main.setBackgroundColor('#150c1f');
    this.physics.world.setBounds(0, 0, SAFE_WIDTH, SAFE_HEIGHT);
    this.itemKey = firstAssetKey('item', 'arcade_primary_object', 'collectible', 'prop') || createFallbackTexture(this, 'opengame_fallback_item', 0x2ec4b6, 0xffffff, 112);
    this.enemyKey = firstAssetKey('enemy', 'primary_enemy', 'arcade_primary_threat', 'hazard') || createFallbackTexture(this, 'opengame_fallback_enemy', 0xe71d36, 0xffd23f, 112);
    this.playerKey = firstAssetKey('player', 'player_actor', 'effect') || createSlashTexture(this);
    this.effectKey = firstAssetKey('effect', 'slash', 'prop') || this.playerKey;
    this.backgroundKey = firstAssetKey('background', 'environment', 'arcade_background') || '';
    this.renderBackground();
    this.createHud();
    this.slashGraphics = this.add.graphics().setDepth(60);
    this.renderBladeHint();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.beginSlash(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.extendSlash(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.finishSlash(pointer));
    this.spawnTarget('item');
    this.spawnTarget('enemy');
    this.spawnTarget('item');
    this.announcer('READY. SWIPE TO ' + THEME.actionVerb.toUpperCase() + '.');
    (window as any).__GAMETOK_TEMPLATE_PROBE__ = {
      snapshot: () => ({
        title: GAME_TITLE,
        score: this.score,
        combo: this.combo,
        lives: this.lives,
        player: { ...this.playerState, health: this.lives },
        enemyCount: this.targets.filter((entry) => entry.kind === 'enemy' && !entry.sliced).length,
        projectileCount: this.probeProjectileCount,
        targets: this.targets.length,
        requiredAssetRoles: REQUIRED_ASSET_ROLES,
        assetContract: ASSET_CONTRACT_SUMMARY,
      }),
      move: (dx = 80, dy = 0, duration = 180) => {
        const startX = this.playerState.x;
        const startY = this.playerState.y;
        this.playerState.x = Phaser.Math.Clamp(startX + Number(dx || 0) * Math.max(1, Number(duration || 1)) / 180, 42, SAFE_WIDTH - 42);
        this.playerState.y = Phaser.Math.Clamp(startY + Number(dy || 0) * Math.max(1, Number(duration || 1)) / 180, 142, SAFE_HEIGHT - 58);
        this.bladeHint?.setPosition(this.playerState.x, this.playerState.y);
        this.slash = [
          { x: startX, y: startY, t: this.time.now },
          { x: this.playerState.x, y: this.playerState.y, t: this.time.now + 1 },
        ];
        this.checkSlashHits(true);
        return (window as any).__GAMETOK_TEMPLATE_PROBE__.snapshot();
      },
      attack: () => {
        this.probeProjectileCount += 1;
        this.spawnImpact(this.playerState.x, this.playerState.y - 34, -0.7);
        const target = this.targets.find((entry) => entry.kind === 'enemy') || this.targets.find((entry) => entry.kind === 'item') || this.spawnTarget('enemy', this.playerState.x, this.playerState.y - 128);
        if (target) this.resolveSlice(target, new Phaser.Math.Vector2(110, -42));
        return (window as any).__GAMETOK_TEMPLATE_PROBE__.snapshot();
      },
      spawnEnemyNearPlayer: () => {
        this.spawnTarget('enemy', this.playerState.x, this.playerState.y - 116);
        return (window as any).__GAMETOK_TEMPLATE_PROBE__.snapshot();
      },
      primaryAction: () => {
        return (window as any).__GAMETOK_TEMPLATE_PROBE__.attack();
      },
      reset: () => {
        this.scene.restart();
        return true;
      },
    };
  }

  update(_time: number, delta: number) {
    const now = this.time.now;
    if (now >= this.nextSpawnAt) {
      this.spawnTarget(Math.random() < 0.78 ? 'item' : 'enemy');
      this.nextSpawnAt = now + Math.max(520, 1250 - this.score * 12);
    }
    for (const target of [...this.targets]) {
      if (target.sprite.y > SAFE_HEIGHT + 100 || target.sprite.x < -140 || target.sprite.x > SAFE_WIDTH + 140) {
        if (!target.sliced && target.kind === 'item' && now - target.bornAt > 900) {
          this.combo = 0;
          this.lives = Math.max(0, this.lives - 1);
          this.announcer(this.lives === 0 ? 'GAME OVER. TAP TO RESET.' : 'MISS');
        }
        this.removeTarget(target);
      }
    }
    if (this.lives <= 0 && this.input.activePointer.isDown) {
      this.scene.restart();
    }
    this.drawSlashTrail(delta);
    this.updateHud();
  }

  private renderBackground() {
    if (this.backgroundKey && this.textures.exists(this.backgroundKey)) {
      const bg = this.add.image(SAFE_WIDTH / 2, SAFE_HEIGHT / 2, this.backgroundKey);
      markRendered(this.backgroundKey, 'background');
      const scale = Math.max(SAFE_WIDTH / Math.max(1, bg.width), SAFE_HEIGHT / Math.max(1, bg.height));
      bg.setScale(scale).setDepth(-20).setAlpha(0.86);
    }
    const vignette = this.add.graphics().setDepth(-10);
    vignette.fillGradientStyle(0x0d0221, 0x261447, 0x120917, 0x08040d, 0.55, 0.5, 0.86, 0.92);
    vignette.fillRect(0, 0, SAFE_WIDTH, SAFE_HEIGHT);
    for (let i = 0; i < 14; i += 1) {
      const x = (i * 37) % SAFE_WIDTH;
      vignette.lineStyle(1, 0xffffff, 0.05);
      vignette.lineBetween(x, 104, SAFE_WIDTH - x * 0.35, SAFE_HEIGHT - 90);
    }
  }

  private createHud() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '20px',
      color: '#ffffff',
      stroke: '#111111',
      strokeThickness: 4,
    };
    this.add.text(20, 22, GAME_TITLE, { ...style, fontSize: '22px', color: '#ffd23f' }).setDepth(80);
    this.scoreText = this.add.text(20, 58, '', style).setDepth(80);
    this.comboText = this.add.text(205, 58, '', style).setDepth(80);
    this.livesText = this.add.text(20, 88, '', style).setDepth(80);
    this.announcerText = this.add.text(SAFE_WIDTH / 2, 146, '', {
      ...style,
      fontSize: '24px',
      align: 'center',
      wordWrap: { width: SAFE_WIDTH - 40 },
    }).setOrigin(0.5).setDepth(90);
    this.updateHud();
  }

  private renderBladeHint() {
    const key = this.playerKey || this.effectKey || createSlashTexture(this);
    this.bladeHint = this.add.image(this.playerState.x, this.playerState.y, key);
    this.bladeHint
      .setDepth(52)
      .setAlpha(0.72)
      .setDisplaySize(94, 94)
      .setRotation(-0.7)
      .setData('role', 'player')
      .setData('assetKey', key);
    markRendered(key, 'player');
  }

  private updateHud() {
    this.scoreText.setText('SCORE ' + this.score);
    this.comboText.setText(THEME.scoreLabel.toUpperCase() + ' x' + this.combo);
    this.livesText.setText('LIVES ' + this.lives + '/3');
  }

  private spawnTarget(kind: SpawnKind, forcedX?: number, forcedY?: number): FlyingTarget {
    const key = kind === 'enemy' ? this.enemyKey : this.itemKey;
    const x = typeof forcedX === 'number' ? Phaser.Math.Clamp(forcedX, 56, SAFE_WIDTH - 56) : Phaser.Math.Between(56, SAFE_WIDTH - 56);
    const y = typeof forcedY === 'number' ? Phaser.Math.Clamp(forcedY, 128, SAFE_HEIGHT + 40) : SAFE_HEIGHT + 40;
    const sprite = this.physics.add.sprite(x, y, key);
    sprite.setDepth(kind === 'enemy' ? 35 : 30);
    sprite.setDisplaySize(kind === 'enemy' ? 86 : 96, kind === 'enemy' ? 86 : 96);
    sprite.setCircle(Math.min(sprite.displayWidth, sprite.displayHeight) * 0.36);
    sprite.setBounce(0.9);
    sprite.setAngularVelocity(Phaser.Math.Between(-180, 180));
    sprite.setVelocity(Phaser.Math.Between(-95, 95), typeof forcedY === 'number' ? Phaser.Math.Between(-70, 30) : Phaser.Math.Between(-760, -560));
    sprite.setGravityY(760);
    sprite.setData('role', kind === 'enemy' ? 'enemy' : 'item');
    sprite.setData('assetKey', key);
    markRendered(key, kind === 'enemy' ? 'enemy' : 'item');
    const target = { sprite, kind, role: kind === 'enemy' ? 'enemy' : 'item', sliced: false, bornAt: this.time.now };
    this.targets.push(target);
    return target;
  }

  private beginSlash(pointer: Phaser.Input.Pointer) {
    this.slash = [{ x: pointer.x, y: pointer.y, t: this.time.now }];
  }

  private extendSlash(pointer: Phaser.Input.Pointer) {
    if (!pointer.isDown) return;
    this.slash.push({ x: pointer.x, y: pointer.y, t: this.time.now });
    if (this.slash.length > 9) this.slash.shift();
    this.checkSlashHits();
  }

  private finishSlash(pointer: Phaser.Input.Pointer) {
    this.extendSlash(pointer);
    this.checkSlashHits(true);
    this.time.delayedCall(130, () => {
      this.slash = [];
      this.slashGraphics?.clear();
    });
  }

  private checkSlashHits(force = false) {
    if (this.slash.length < 2 || this.time.now - this.lastSliceAt < 45) return;
    const a = this.slash[this.slash.length - 2];
    const b = this.slash[this.slash.length - 1];
    const swipe = new Phaser.Math.Vector2(b.x - a.x, b.y - a.y);
    if (!force && swipe.lengthSq() < 64) return;
    for (const target of [...this.targets]) {
      if (target.sliced) continue;
      const distance = this.distanceToSegment(target.sprite.x, target.sprite.y, a.x, a.y, b.x, b.y);
      if (distance <= Math.max(42, target.sprite.displayWidth * 0.47)) {
        this.resolveSlice(target, swipe);
        this.lastSliceAt = this.time.now;
        break;
      }
    }
  }

  private distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0001) return Phaser.Math.Distance.Between(px, py, ax, ay);
    const t = Phaser.Math.Clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
    return Phaser.Math.Distance.Between(px, py, ax + dx * t, ay + dy * t);
  }

  private resolveSlice(target: FlyingTarget, swipe: Phaser.Math.Vector2) {
    target.sliced = true;
    const normal = swipe.clone().normalize().rotate(Math.PI / 2);
    if (target.kind === 'enemy') {
      this.lives = Math.max(0, this.lives - 1);
      this.playerState.health = this.lives;
      this.combo = 0;
      this.cameras.main.shake(260, 0.026);
      this.announcer(this.lives === 0 ? 'BOMB HIT. TAP TO RESET.' : 'BOMB!');
    } else {
      this.score += 10 + this.combo * 2;
      this.combo += 1;
      this.cameras.main.shake(this.combo % 5 === 0 ? 260 : 120, this.combo % 5 === 0 ? 0.018 : 0.008);
      this.announcer(this.combo >= 5 ? 'PERFECT CUT x' + this.combo : THEME.actionVerb.toUpperCase() + '!');
    }
    this.spawnHalves(target, normal);
    this.spawnImpact(target.sprite.x, target.sprite.y, swipe.angle());
    this.removeTarget(target);
    this.physics.world.timeScale = 0.12;
    this.time.delayedCall(target.kind === 'enemy' ? 90 : 55, () => {
      this.physics.world.timeScale = 1;
    });
    this.updateHud();
  }

  private spawnHalves(target: FlyingTarget, normal: Phaser.Math.Vector2) {
    const key = target.kind === 'enemy' ? this.enemyKey : this.itemKey;
    const body = target.sprite.body as Phaser.Physics.Arcade.Body | null;
    const baseVx = body?.velocity.x || 0;
    const baseVy = body?.velocity.y || -160;
    for (const direction of [-1, 1]) {
      const half = this.physics.add.sprite(target.sprite.x, target.sprite.y, key);
      half.setDepth(38);
      half.setDisplaySize(target.sprite.displayWidth * 0.58, target.sprite.displayHeight * 0.88);
      half.setTint(direction < 0 ? 0xffffff : 0xffd7d7);
      half.setAlpha(0.96);
      half.setVelocity(baseVx + normal.x * 320 * direction, baseVy + normal.y * 320 * direction - 120);
      half.setGravityY(880);
      half.setAngularVelocity(Phaser.Math.Between(220, 520) * direction);
      this.tweens.add({ targets: half, alpha: 0, duration: 760, delay: 280, onComplete: () => half.destroy() });
    }
  }

  private spawnImpact(x: number, y: number, angle: number) {
    const flash = this.add.image(x, y, this.effectKey || this.playerKey);
    markRendered(this.effectKey || this.playerKey, 'effect');
    flash.setDepth(70).setRotation(angle).setDisplaySize(132, 132).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, scale: 1.45, alpha: 0, duration: 220, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
    for (let i = 0; i < 12; i += 1) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(3, 8), Phaser.Display.Color.GetColor(255, Phaser.Math.Between(60, 220), 45), 0.9).setDepth(65);
      this.tweens.add({
        targets: dot,
        x: x + Phaser.Math.Between(-90, 90),
        y: y + Phaser.Math.Between(-80, 80),
        alpha: 0,
        scale: 0.3,
        duration: 360,
        onComplete: () => dot.destroy(),
      });
    }
  }

  private removeTarget(target: FlyingTarget) {
    this.targets = this.targets.filter((entry) => entry !== target);
    target.sprite.destroy();
  }

  private drawSlashTrail(delta: number) {
    this.slashGraphics.clear();
    const now = this.time.now;
    this.slash = this.slash.filter((point) => now - point.t < 180);
    if (this.slash.length < 2) return;
    for (let i = 1; i < this.slash.length; i += 1) {
      const a = this.slash[i - 1];
      const b = this.slash[i];
      const alpha = Phaser.Math.Clamp(1 - (now - b.t) / 190, 0, 1);
      this.slashGraphics.lineStyle(18, 0xffffff, alpha * 0.78);
      this.slashGraphics.lineBetween(a.x, a.y, b.x, b.y);
      this.slashGraphics.lineStyle(8, 0x00f0ff, alpha * 0.92);
      this.slashGraphics.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private announcer(text: string) {
    this.announcerText.setText(text);
    this.announcerText.setScale(1.16).setAlpha(1);
    this.tweens.killTweensOf(this.announcerText);
    this.tweens.add({ targets: this.announcerText, scale: 1, duration: 120 });
    this.tweens.add({ targets: this.announcerText, alpha: 0, duration: 450, delay: 780 });
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: SAFE_WIDTH,
  height: SAFE_HEIGHT,
  backgroundColor: '#0d0221',
  dom: { createContainer: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      fps: 120,
      debug: false,
      gravity: { x: 0, y: 0 },
    },
  },
  scene: [GameScene],
};

window.addEventListener('load', () => {
  const mount = document.getElementById('game-container') || document.body;
  if (mount instanceof HTMLElement) {
    mount.style.width = '100vw';
    mount.style.height = '100vh';
    mount.style.overflow = 'hidden';
    mount.style.touchAction = 'none';
  }
  document.documentElement.style.margin = '0';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#05030a';
  new Phaser.Game(config);
});
`;
}

export async function applyOpenGameMakerTemplate(projectRoot, options = {}) {
    const source = buildOpenGameMakerSource(options);
    const mainPath = path.join(projectRoot, 'src', 'main.ts');
    await fs.mkdir(path.dirname(mainPath), { recursive: true });
    await fs.writeFile(mainPath, source, 'utf8');
    return [{
        path: 'src/main.ts',
        bytes: Buffer.byteLength(source, 'utf8'),
        type: 'opengame_template_owned_runtime',
    }];
}
