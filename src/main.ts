type ActionType = 'move' | 'shoot' | 'none';

type BotAction = {
    type: ActionType;
    direction: Phaser.Math.Vector2;
    distance: number;
    target?: Phaser.Math.Vector2;
};

type Bot = {
    id: number;
    sprite: Phaser.Physics.Arcade.Image;
    playerId: 1 | 2;
    action: BotAction;
    isAlive: boolean;
    selectedMode: Exclude<ActionType, 'none'>;
    plannedMove?: BotAction;
    plannedShoot?: BotAction;
};

type BulletSprite = Phaser.Physics.Arcade.Image & {
    ownerBot?: Bot;
};

class Scene extends Phaser.Scene {
    // Track the last selected bot index to prevent immediate mode toggle on first tap
    private lastSelectedIndex: number | null = null;
    private winText?: Phaser.GameObjects.Text;
    private bots: Bot[] = [];
    private playerBots: Bot[] = [];
    private aiBots: Bot[] = [];
    private selectedIndex = 0;
    private maxMoveDistance = 180;
    private shootPreviewLength = 180;
    private roundDurationMs = 2000;
    private roundTimer?: Phaser.Time.TimerEvent;
    private isPlanning = true;
    private infoText?: Phaser.GameObjects.Text;
    private statusEl?: HTMLElement | null;
    private startButton?: HTMLButtonElement | null;
    private particles?: Phaser.Physics.Arcade.Group;
    private planGraphics?: Phaser.GameObjects.Graphics;
    private isDragging = false;
    private draggingBot: Bot | undefined;
    private selectionRing?: Phaser.GameObjects.Graphics;
    private dragStart: Phaser.Math.Vector2 | undefined;
    private planDirty = true;

    create() {
        this.cameras.main.setBackgroundColor('#0b0b0f');
        this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
        this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height);
        });
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) => {
            const sprite = body.gameObject as Phaser.Physics.Arcade.Image | undefined;
            if (sprite) {
                if (sprite.texture?.key === 'particle') {
                    const bullet = sprite as BulletSprite;
                    delete bullet.ownerBot;
                    bullet.destroy();
                    return;
                }
                sprite.setVelocity(0, 0);
            }
        });

        this.createBotTextures();
        this.createBots();
        this.createUi();
        this.createParticles();
        this.createPlanningGraphics();
        this.setupInput();
        this.updateUi();
    }

    private createBotTextures() {
        const makeCircle = (key: string, color: number) => {
            const g = this.add.graphics();
            g.fillStyle(color, 1);
            g.fillCircle(12, 12, 12);
            g.generateTexture(key, 24, 24);
            g.destroy();
        };

        makeCircle('bot-player', 0x4aa3ff);
        makeCircle('bot-ai', 0xff6b6b);
        makeCircle('particle', 0xffffff);
    }

    private createBots() {
        const padding = 60;
        const leftX = padding;
        const rightX = this.scale.width - padding;
        const minDist = 36; // Minimum distance between bots (diameter + margin)

        // Helper to find a non-overlapping y position
        const findNonOverlappingY = (x: number, bots: Bot[]): number => {
            let attempts = 0;
            while (attempts < 100) {
                const y = Phaser.Math.Between(padding, this.scale.height - padding);
                const tooClose = bots.some(b => Phaser.Math.Distance.Between(x, y, b.sprite.x, b.sprite.y) < minDist);
                if (!tooClose) return y;
                attempts++;
            }
            // fallback: just space them evenly
            return padding + (bots.length * ((this.scale.height - 2 * padding) / 5));
        };

        for (let i = 0; i < 5; i += 1) {
            const y = findNonOverlappingY(leftX, this.playerBots);
            const bot = this.createBot(leftX, y, 1, 'bot-player');
            this.playerBots.push(bot);
            this.bots.push(bot);
        }

        for (let i = 0; i < 5; i += 1) {
            const y = findNonOverlappingY(rightX, this.aiBots.concat(this.playerBots));
            const bot = this.createBot(rightX, y, 2, 'bot-ai');
            this.aiBots.push(bot);
            this.bots.push(bot);
        }

        // Enable collision and bounce between all bots
        this.bots.forEach(bot => {
            bot.sprite.setBounce(1, 1);
        });
        // Add collider for each unique pair of bots
        for (let i = 0; i < this.bots.length; i++) {
            for (let j = i + 1; j < this.bots.length; j++) {
                this.physics.add.collider(this.bots[i]!.sprite, this.bots[j]!.sprite);
            }
        }

        this.highlightSelected();
    }

    private botIdCounter = 1;
    private createBot(x: number, y: number, playerId: 1 | 2, texture: string): Bot {
        const sprite = this.physics.add.image(x, y, texture);
        sprite.setCollideWorldBounds(true);
        sprite.setDamping(true);
        sprite.setDrag(0.9, 0.9);
        sprite.setMaxVelocity(260, 260);
        sprite.body.onWorldBounds = true;

        const action: BotAction = {
            type: 'none',
            direction: new Phaser.Math.Vector2(1, 0),
            distance: 0
        };

        const bot: Bot = {
            id: this.botIdCounter++,
            sprite,
            playerId,
            action,
            isAlive: true,
            selectedMode: 'move'
        };
        return bot;
    }

    private createParticles() {
        this.particles = this.physics.add.group({
            defaultKey: 'particle',
            maxSize: 200
        });

        this.physics.add.overlap(
            this.particles,
            this.bots.map(bot => bot.sprite),
            (obj1, obj2) => {
                const maybeBullet1 = obj1 as BulletSprite;
                const maybeBullet2 = obj2 as BulletSprite;
                const particle = maybeBullet1.ownerBot ? maybeBullet1 : maybeBullet2.ownerBot ? maybeBullet2 : undefined;
                const other = particle === maybeBullet1 ? (obj2 as Phaser.Physics.Arcade.Image) : (obj1 as Phaser.Physics.Arcade.Image);
                if (!particle) {
                    return;
                }
                const bot = this.bots.find(b => b.sprite === other);
                if (bot) {
                    this.handleBotHit(bot, particle);
                }
            }
        );
    }

    private handleBotHit(bot: Bot, particle: BulletSprite) {
        if (!bot.isAlive) {
            return;
        }
        // Ignore bullets with no owner (not yet assigned)
        if (!particle.ownerBot) {
            return;
        }
        // Debug: Log collision details
        // eslint-disable-next-line no-console
        console.log('handleBotHit: valid collision', {
            botId: bot.id,
            ownerBotId: particle.ownerBot?.id,
            isSame: particle.ownerBot === bot
        });
        // Prevent a bot from shooting itself, but allow friendly fire
        const ownerBot = particle.ownerBot;
        if (ownerBot && ownerBot === bot) {
            // eslint-disable-next-line no-console
            console.log('Ignored self-hit for bot', bot.id);
            return;
        }
        bot.isAlive = false;
        bot.sprite.setVisible(false);
        bot.sprite.disableBody(true, true);
        if (particle.active) {
            delete particle.ownerBot;
            particle.destroy();
        }
        // Remove from bot arrays
        this.bots = this.bots.filter(b => b !== bot);
        if (bot.playerId === 1) {
            this.playerBots = this.playerBots.filter(b => b !== bot);
        } else {
            this.aiBots = this.aiBots.filter(b => b !== bot);
        }
        this.checkWinCondition();
    }

    private checkWinCondition() {
        if (this.aiBots.length === 0) {
            this.showWinMessage('You win!');
        } else if (this.playerBots.length === 0) {
            this.showWinMessage('You lose!');
        }
    }

    private showWinMessage(msg: string) {
        if (this.winText) {
            this.winText.setText(msg);
            this.winText.setVisible(true);
        } else {
            this.winText = this.add.text(this.scale.width / 2, this.scale.height / 2, msg, {
                fontFamily: 'system-ui, sans-serif',
                fontSize: '32px',
                color: '#fff',
                backgroundColor: 'rgba(0,0,0,0.7)',
                padding: { x: 24, y: 16 },
                align: 'center',
            }).setOrigin(0.5);
        }
        this.isPlanning = false;
        if (this.startButton) this.startButton.disabled = true;
    }

    private createUi() {
        this.infoText = this.add.text(16, 16, '', {
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            color: '#e6e6e6',
            backgroundColor: 'rgba(11, 11, 15, 0.65)',
            padding: { x: 10, y: 6 }
        });
        this.infoText.setScrollFactor(0);
        this.statusEl = document.getElementById('status');
        this.startButton = document.getElementById('start-round') as HTMLButtonElement | null;
        if (this.statusEl) {
            this.infoText.setVisible(false);
        }
        if (this.startButton) {
            this.startButton.addEventListener('click', () => {
                if (!this.isPlanning) {
                    return;
                }
                this.startRound();
            });
        }
    }

    private createPlanningGraphics() {
        this.planGraphics = this.add.graphics();
        this.selectionRing = this.add.graphics();
        this.selectionRing.setDepth(10);
    }

    private setupInput() {
        // Keyboard: Space or Enter to start round if planning
        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
            if (!this.isPlanning) return;
            if (!this.startButton || this.startButton.disabled) return;
            if (event.code === 'Space' || event.code === 'Enter') {
                this.startRound();
                event.preventDefault();
            }
        });

        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!this.isPlanning) {
                return;
            }

            const hitBot = this.getPlayerBotAt(pointer.worldX, pointer.worldY);
            if (hitBot) {
                this.selectBot(hitBot);
                this.isDragging = true;
                this.draggingBot = hitBot;
                this.dragStart = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
            }

            this.updateUi();
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (!this.isPlanning || !this.isDragging || !this.draggingBot || !this.dragStart) {
                return;
            }

            const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
            if (distance >= 6) {
                this.applyDragAction(this.draggingBot, pointer);
            }
        });

        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (!this.isPlanning) {
                return;
            }

            if (this.isDragging && this.draggingBot && this.dragStart) {
                const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
                const wasTap = distance < 6;
                if (wasTap) {
                    this.handleTap(this.draggingBot);
                }
            }

            this.isDragging = false;
            this.draggingBot = undefined;
            this.dragStart = undefined;
        });
    }

    private handleTap(hitBot: Bot) {
        const selected = this.playerBots[this.selectedIndex];
        if (selected !== hitBot) {
            this.selectBot(hitBot);
            this.updateUi();
            // Update lastSelectedIndex to current
            this.lastSelectedIndex = this.selectedIndex;
            return;
        }
        // Only toggle mode if the bot was already selected before this tap
        if (this.lastSelectedIndex === this.selectedIndex) {
            this.toggleSelectedMode();
        }
        // Update lastSelectedIndex to current
        this.lastSelectedIndex = this.selectedIndex;
    }

    private syncActionWithMode(bot: Bot) {
        const planned = bot.selectedMode === 'move' ? bot.plannedMove : bot.plannedShoot;
        if (planned) {
            bot.action = {
                type: planned.type,
                direction: planned.direction.clone(),
                distance: planned.distance,
                ...(planned.target ? { target: planned.target.clone() } : {})
            };
            return;
        }

        const origin = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
        const baseDirection = bot.action.direction ? bot.action.direction.clone() : new Phaser.Math.Vector2(1, 0);
        if (baseDirection.lengthSq() === 0) {
            baseDirection.set(1, 0);
        }
        baseDirection.normalize();

        if (bot.selectedMode === 'move') {
            const fallbackTarget = bot.action.target ? bot.action.target.clone() : origin.clone().add(baseDirection.clone().scale(this.maxMoveDistance));
            const distance = Math.min(this.maxMoveDistance, Phaser.Math.Distance.Between(origin.x, origin.y, fallbackTarget.x, fallbackTarget.y));
            const target = origin.clone().add(baseDirection.clone().scale(distance));
            const action: BotAction = { type: 'move', direction: baseDirection.clone(), distance, target };
            bot.action = action;
            bot.plannedMove = {
                type: 'move',
                direction: baseDirection.clone(),
                distance,
                target: target.clone()
            };
            return;
        }

        const target = origin.clone().add(baseDirection.clone().scale(this.shootPreviewLength));
        const shootAction: BotAction = { type: 'shoot', direction: baseDirection.clone(), distance: 0, target };
        bot.action = shootAction;
        bot.plannedShoot = {
            type: 'shoot',
            direction: baseDirection.clone(),
            distance: 0,
            target: target.clone()
        };
    }

    private applyDragAction(bot: Bot, pointer: Phaser.Input.Pointer) {
        const direction = new Phaser.Math.Vector2(pointer.worldX - bot.sprite.x, pointer.worldY - bot.sprite.y);
        if (direction.lengthSq() === 0) {
            direction.set(1, 0);
        }
        direction.normalize();

        if (bot.selectedMode === 'move') {
            const distance = Math.min(this.maxMoveDistance, Phaser.Math.Distance.Between(bot.sprite.x, bot.sprite.y, pointer.worldX, pointer.worldY));
            const clampedTarget = direction.clone().scale(distance).add(new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y));
            const action: BotAction = { type: 'move', direction, distance, target: clampedTarget };
            bot.action = action;
            bot.plannedMove = {
                type: 'move',
                direction: direction.clone(),
                distance,
                target: clampedTarget.clone()
            };
        } else if (bot.selectedMode === 'shoot') {
            const target = direction.clone().scale(this.shootPreviewLength).add(new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y));
            const action: BotAction = { type: 'shoot', direction, distance: 0, target };
            bot.action = action;
            bot.plannedShoot = {
                type: 'shoot',
                direction: direction.clone(),
                distance: 0,
                target: target.clone()
            };
        }

        this.planDirty = true;
        this.updateUi();
    }

    private startRound() {
        this.isPlanning = false;
        this.planAiActions();
        this.executeActions();
        this.clearPlanGraphics();
        this.updateUi();
        this.roundTimer = this.time.delayedCall(this.roundDurationMs, () => this.endRound());
    }

    private endRound() {
        this.isPlanning = true;
        this.bots.forEach((bot) => {
            if (bot.isAlive) {
                bot.sprite.setVelocity(0, 0);
                bot.action = { type: 'none', direction: new Phaser.Math.Vector2(1, 0), distance: 0 };
                delete bot.plannedMove;
                delete bot.plannedShoot;
            }
        });
        this.clearParticles();
        this.planDirty = true;
        this.updateUi();
    }

    private clearParticles() {
        if (!this.particles) {
            return;
        }
        this.particles.getChildren().forEach((child) => {
            const particle = child as BulletSprite;
            delete particle.ownerBot;
            particle.destroy();
        });
        this.particles.clear(true, true);
    }

    private executeActions() {
        this.bots.forEach((bot) => {
            if (bot.action.type === 'move') {
                const speed = bot.action.distance / (this.roundDurationMs / 1000);
                bot.sprite.setVelocity(bot.action.direction.x * speed, bot.action.direction.y * speed);
            }
            if (bot.action.type === 'shoot') {
                this.spawnShot(bot);
            }
        });
    }

    private spawnShot(bot: Bot) {
        if (!this.particles) {
            return;
        }

        const baseDirection = bot.action.direction.clone().normalize();
        const spreadDeg = 8; // Small spread in degrees
        const speed = 420;
        const startOffset = 18;
        // Calculate max bullet travel distance as half the smaller game dimension
        const fieldWidth = this.scale.width;
        const fieldHeight = this.scale.height;
        const maxBulletDistance = Math.min(fieldWidth, fieldHeight) / 2;
        // Bullet lifetime in ms = distance / speed * 1000
        const bulletLifetime = (maxBulletDistance / speed) * 1000;

        for (let i = 0; i < 3; i++) {
            const angleDeg = Phaser.Math.FloatBetween(-spreadDeg, spreadDeg);
            const direction = baseDirection.clone().rotate(Phaser.Math.DegToRad(angleDeg));
            const startX = bot.sprite.x + direction.x * startOffset;
            const startY = bot.sprite.y + direction.y * startOffset;

            const particle = this.particles!.get(startX, startY, 'particle') as BulletSprite | null;
            if (!particle) {
                continue;
            }

            particle.setActive(true);
            particle.setVisible(true);
            particle.setScale(0.18); // Smaller bullet size
            particle.setDepth(5);
            particle.setCollideWorldBounds(true);
            particle.ownerBot = bot;
            particle.setVelocity(direction.x * speed, direction.y * speed);

            this.time.delayedCall(bulletLifetime, () => {
                if (particle.active) {
                    delete particle.ownerBot;
                    particle.destroy();
                }
            });
        }
    }

    private planAiActions() {
        const enemies = this.playerBots;
        this.aiBots.forEach((bot) => {
            // Find the closest enemy
            let target: Bot | null = null;
            let minDist = Number.POSITIVE_INFINITY;
            for (const e of enemies) {
                const d = Phaser.Math.Distance.Between(bot.sprite.x, bot.sprite.y, e.sprite.x, e.sprite.y);
                if (d < minDist) {
                    minDist = d;
                    target = e;
                }
            }
            if (target === null) {
                return;
            }
            const direction = new Phaser.Math.Vector2(
                target.sprite.x - bot.sprite.x,
                target.sprite.y - bot.sprite.y
            );
            if (direction.lengthSq() === 0) {
                direction.set(1, 0);
            }
            direction.normalize();

            // Randomly shoot or move if within shootPreviewLength
            if (minDist <= this.shootPreviewLength * 4) {
                if (Phaser.Math.Between(0, 1) === 0) {
                    bot.action = { type: 'shoot', direction, distance: 0 };
                    return;
                }
            }
            // Otherwise, move
            const distance = Phaser.Math.Between(60, this.maxMoveDistance);
            bot.action = { type: 'move', direction, distance };
        });
    }

    private highlightSelected() {
        this.playerBots.forEach((bot, index) => {
            bot.sprite.setScale(index === this.selectedIndex ? 1.25 : 1);
        });
        this.updateSelectionRing();
    }

    private updateSelectionRing() {
        if (!this.selectionRing) {
            return;
        }
        const selected = this.playerBots[this.selectedIndex];
        if (!selected) {
            return;
        }
        const color = selected.selectedMode === 'move' ? 0x22c55e : 0xf59e0b;
        this.selectionRing.clear();
        this.selectionRing.lineStyle(2, color, 0.9);
        this.selectionRing.strokeCircle(selected.sprite.x, selected.sprite.y, 18);
    }

    private updateUi() {
        const selected = this.playerBots[this.selectedIndex];

        if (selected === undefined) {
            return;
        }

        const plannedCount = this.playerBots.filter((bot) => bot.action.type !== 'none').length;
        const modeText = selected.selectedMode === 'move' ? 'move' : 'shoot';

        if (this.infoText) {
            const instructions = [
                `Selected bot: ${this.selectedIndex + 1}/5`,
                `Mode: ${modeText}`,
                `Planned: ${plannedCount}/5`,
                this.isPlanning ? 'Tap to select. Drag to set move/shoot.' : 'Executing round...'
            ];
            this.infoText.setText(instructions);
        }

        if (this.statusEl) {
            this.statusEl.textContent = this.isPlanning
                ? `Bot ${this.selectedIndex + 1} • Mode: ${modeText} • Planned: ${plannedCount}/5`
                : 'Executing round...';
        }

        if (this.startButton) {
            this.startButton.disabled = !this.isPlanning;
        }

        // Always update the selection ring to reflect the current mode
        this.updateSelectionRing();
    }

    private selectBot(bot: Bot) {
        const index = this.playerBots.indexOf(bot);
        if (index >= 0) {
            this.selectedIndex = index;
            this.highlightSelected();
            this.planDirty = true;
            // Do not update lastSelectedIndex here; handleTap manages it
        }
    }

    private toggleSelectedMode() {
        const selected = this.playerBots[this.selectedIndex];
        if (!selected) return;
        selected.selectedMode = selected.selectedMode === 'move' ? 'shoot' : 'move';
        this.syncActionWithMode(selected);
        this.updateSelectionRing(); // Update ring color immediately after mode change
        this.planDirty = true; // Mark plan as dirty to trigger re-render if needed
        this.updateUi();
    }

    private getPlayerBotAt(x: number, y: number): Bot | undefined {
        return this.playerBots.find((bot) => Phaser.Math.Distance.Between(x, y, bot.sprite.x, bot.sprite.y) <= 18);
    }

    private renderPlans() {
        const planGraphics = this.planGraphics;
        if (!planGraphics) {
            return;
        }
        planGraphics.clear();
        this.playerBots.forEach((bot) => {
            if (bot.action.type === 'none') {
                return;
            }
            const isMove = bot.action.type === 'move';
            const color = isMove ? 0x22c55e : 0xf59e0b;
            planGraphics.lineStyle(2, color, 0.7);
            if (isMove) {
                const target = bot.action.target ?? new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
                planGraphics.strokeLineShape(new Phaser.Geom.Line(bot.sprite.x, bot.sprite.y, target.x, target.y));
                planGraphics.fillStyle(color, 0.25);
                planGraphics.fillCircle(target.x, target.y, 8);
                planGraphics.lineStyle(1.5, color, 0.9);
                planGraphics.strokeCircle(target.x, target.y, 10);
            } else {
                // Match the bullet travel distance to the preview (including startOffset)
                const fieldWidth = this.scale.width;
                const fieldHeight = this.scale.height;
                const maxBulletDistance = Math.min(fieldWidth, fieldHeight) / 2;
                const startOffset = 18;
                const direction = bot.action.direction?.clone().normalize() ?? new Phaser.Math.Vector2(1, 0);
                // The bullet starts at startOffset from the bot, and travels maxBulletDistance from there
                const start = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y).add(direction.clone().scale(startOffset));
                const end = start.clone().add(direction.clone().scale(maxBulletDistance));
                planGraphics.strokeLineShape(new Phaser.Geom.Line(bot.sprite.x, bot.sprite.y, end.x, end.y));
                planGraphics.fillStyle(color, 0.4);
                planGraphics.fillCircle(end.x, end.y, 4);
            }
        });
    }

    private clearPlanGraphics() {
        if (this.planGraphics) {
            this.planGraphics.clear();
        }
        if (this.selectionRing) {
            this.selectionRing.clear();
        }
    }

    update() {
        if (this.isPlanning) {
            if (this.planDirty) {
                this.renderPlans();
                this.planDirty = false;
            }
            this.updateSelectionRing();
        } else {
            // Hide the selection ring when not planning
            if (this.selectionRing) {
                this.selectionRing.clear();
            }
        }
    }
}

// Fixed aspect ratio (e.g., 16:9)
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    scene: Scene,
    input: {
        keyboard: true
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
    }
};

const game = new Phaser.Game(config);

// Responsive resize: scale canvas to fit window while maintaining aspect ratio
function resizeGame() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const scale = Math.min(windowWidth / GAME_WIDTH, windowHeight / GAME_HEIGHT);
    const displayWidth = Math.floor(GAME_WIDTH * scale);
    const displayHeight = Math.floor(GAME_HEIGHT * scale);
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    canvas.style.display = 'block';
    canvas.style.margin = 'auto';
}

window.addEventListener('resize', resizeGame);
window.addEventListener('DOMContentLoaded', resizeGame);
setTimeout(resizeGame, 0);
