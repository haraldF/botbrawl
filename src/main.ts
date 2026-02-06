import type { Bot, BotAction } from './Bot';
import { planAiActions } from './planAIActions.js';

type BulletSprite = Phaser.Physics.Arcade.Image & {
    ownerBot?: Bot;
};

class Scene extends Phaser.Scene {
    private welcomeBox?: HTMLElement | null;
    private welcomeStartButton?: HTMLButtonElement | null;
    private winText?: Phaser.GameObjects.Text;
    private barriers?: Phaser.Physics.Arcade.StaticGroup;
    private bots: Bot[] = [];
    private playerBots: Bot[] = [];
    private aiBots: Bot[] = [];
    private maxMoveDistance = 180;
    private shootPreviewLength = 180;
    private roundDurationMs = 2000;
    private roundTimer?: Phaser.Time.TimerEvent;
    private isPlanning = true;
    private infoText?: Phaser.GameObjects.Text;
    private statusEl?: HTMLElement | null;
    private startButton?: HTMLButtonElement | null;
    private fullscreenButton?: HTMLButtonElement | null;
    private particles?: Phaser.Physics.Arcade.Group;
    private planGraphics?: Phaser.GameObjects.Graphics;
    private isDragging = false;
    private draggingBot: Bot | undefined;
    private dragStart: Phaser.Math.Vector2 | undefined;
    private draggingIndicator: boolean = false;
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

        this.createUi();
        this.welcomeBox = document.getElementById('welcome-box');
        this.welcomeStartButton = document.getElementById('welcome-start') as HTMLButtonElement | null;
        if (this.welcomeStartButton) {
            this.welcomeStartButton.addEventListener('click', () => {
                this.startGame();
            });
        }
        // Hide game UI until game starts
        const ui = document.getElementById('ui');
        if (ui) ui.style.display = 'none';
        if (this.welcomeBox) this.welcomeBox.style.display = '';
    }

    private startGame() {
        // Hide welcome, show UI, reset game state
        if (this.welcomeBox) this.welcomeBox.style.display = 'none';
        const ui = document.getElementById('ui');
        if (ui) ui.style.display = '';

        // Reset all game state
        this.resetGame();
    }

    private resetGame() {
        // Remove win text if present
        if (this.winText) {
            this.winText.setVisible(false);
        }
        // Remove all bots, barriers, particles
        this.bots.forEach(bot => bot.sprite.destroy());
        this.bots = [];
        this.playerBots = [];
        this.aiBots = [];
        if (this.barriers) {
            this.barriers.clear(true, true);
        }
        this.clearParticles();
        this.createBotTextures();
        this.createBarriers();
        this.createBots();
        this.createParticles();
        this.createPlanningGraphics();
        this.setupInput();
        this.isPlanning = true;
        this.planDirty = true;
        this.updateUi();
    }

    private createBarriers() {
        // Create a static group for barriers
        this.barriers = this.physics.add.staticGroup();

        // Place 6 shorter, well-distributed vertical barriers between the two teams
        const barrierCount = 6;
        const padding = 80;
        const barrierWidth = 16;
        const barrierHeight = 90;
        const fieldWidth = this.scale.width;
        const fieldHeight = this.scale.height;
        // Divide the central field into equal vertical slices for even distribution
        const minX = fieldWidth * 0.22;
        const maxX = fieldWidth * 0.78;
        const sliceWidth = (maxX - minX) / (barrierCount - 1);
        // Create a graphics texture for square barriers
        if (!this.textures.exists('barrier-rect')) {
            const g = this.add.graphics();
            g.fillStyle(0x888888, 0.95);
            g.fillRect(0, 0, barrierWidth, barrierHeight);
            g.generateTexture('barrier-rect', barrierWidth, barrierHeight);
            g.destroy();
        }
        for (let i = 0; i < barrierCount; i++) {
            // Evenly distribute x, with a small random offset for variety
            const baseX = minX + i * sliceWidth;
            const x = baseX + Phaser.Math.Between(-16, 16);
            // Random y, but keep inside field
            const y = Phaser.Math.Between(padding + barrierHeight/2, fieldHeight - padding - barrierHeight/2);
            // Add a vertical static physics image barrier using the square texture
            const barrier = this.physics.add.staticImage(x, y, 'barrier-rect');
            barrier.setOrigin(0.5, 0.5);
            this.barriers.add(barrier);
        }
        this.barriers.refresh();
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
            bot.sprite.setBounce(1, 1); // Full bounce for bot-bot
        });
        // Add collider for each unique pair of bots
        for (let i = 0; i < this.bots.length; i++) {
            for (let j = i + 1; j < this.bots.length; j++) {
                this.physics.add.collider(this.bots[i]!.sprite, this.bots[j]!.sprite);
            }
        }

        // Add collider between bots and barriers with low bounce
        if (this.barriers) {
            this.bots.forEach(bot => {
                this.physics.add.collider(bot.sprite, this.barriers!, undefined, (botObj, barrierObj) => {
                    // Set a low bounce only for bot-barrier collision
                    (botObj as Phaser.Physics.Arcade.Image).setBounce(0.15, 0.15);
                    return true;
                });
            });
        }
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

        // Bullets hit bots
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

        // Bullets collide with barriers (destroy bullet)
        if (this.barriers) {
            const destroyBullet: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (obj1, obj2) => {
                // obj1 is the bullet, obj2 is the barrier
                const particle = obj1 as BulletSprite;
                if (particle.active) {
                    delete particle.ownerBot;
                    particle.destroy();
                }
            };
            this.physics.add.collider(this.particles, this.barriers, destroyBullet);
            this.physics.add.overlap(this.particles, this.barriers, destroyBullet);
        }
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

        // After a short delay, show the welcome box again for replay
        setTimeout(() => {
            const ui = document.getElementById('ui');
            if (ui) ui.style.display = 'none';
            if (this.welcomeBox) this.welcomeBox.style.display = '';
        }, 1800);
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
        this.fullscreenButton = document.getElementById('fullscreen-button') as HTMLButtonElement | null;
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
        if (this.fullscreenButton) {
            this.fullscreenButton.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }
    }

    private toggleFullscreen() {
        if (this.scale.isFullscreen) {
            this.scale.stopFullscreen();
        } else {
            this.scale.startFullscreen();
        }
    }

    private createPlanningGraphics() {
        this.planGraphics = this.add.graphics();
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
            // Check if pointer is on an indicator (move or shoot)
            const indicatorHit = this.getIndicatorAt(pointer.worldX, pointer.worldY);
            if (indicatorHit) {
                this.isDragging = true;
                this.draggingBot = indicatorHit.bot;
                this.draggingIndicator = true;
                this.dragStart = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
                return;
            }
            // Otherwise, check for bot
            const hitBot = this.getPlayerBotAt(pointer.worldX, pointer.worldY);
            if (hitBot) {
                this.isDragging = true;
                this.draggingBot = hitBot;
                this.draggingIndicator = false;
                this.dragStart = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
            }
        });

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (!this.isPlanning || !this.isDragging || !this.draggingBot || !this.dragStart) {
                return;
            }
            const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
            if (distance >= 6 || this.draggingIndicator) {
                this.applyDragAction(this.draggingBot, pointer, this.draggingIndicator);
            }
        });

        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (!this.isPlanning) {
                return;
            }
            if (this.isDragging && this.dragStart) {
                const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY);
                const wasTap = distance < 6;
                if (wasTap && !this.draggingIndicator) {
                    // Re-check which bot is under the pointer for tap reliability
                    const tappedBot = this.getPlayerBotAt(pointer.worldX, pointer.worldY);
                    if (tappedBot && tappedBot.isAlive) {
                        this.toggleBotMode(tappedBot);
                    }
                }
            }
            this.isDragging = false;
            this.draggingBot = undefined;
            this.dragStart = undefined;
            this.draggingIndicator = false;
        });
    }

    // Removed handleTap, replaced by toggleBotMode
    private toggleBotMode(bot: Bot) {
        bot.selectedMode = bot.selectedMode === 'move' ? 'shoot' : 'move';
        this.syncActionWithMode(bot);
        this.planDirty = true;
        this.updateUi();
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

    private applyDragAction(bot: Bot, pointer: Phaser.Input.Pointer, draggingIndicator?: boolean) {
        // If dragging indicator, set target directly to pointer position
        if (draggingIndicator) {
            if (bot.selectedMode === 'move') {
                const origin = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
                const direction = new Phaser.Math.Vector2(pointer.worldX - origin.x, pointer.worldY - origin.y);
                if (direction.lengthSq() === 0) direction.set(1, 0);
                direction.normalize();
                const distance = Math.min(this.maxMoveDistance, Phaser.Math.Distance.Between(origin.x, origin.y, pointer.worldX, pointer.worldY));
                const clampedTarget = direction.clone().scale(distance).add(origin);
                bot.action = { type: 'move', direction, distance, target: clampedTarget };
                bot.plannedMove = {
                    type: 'move',
                    direction: direction.clone(),
                    distance,
                    target: clampedTarget.clone()
                };
            } else if (bot.selectedMode === 'shoot') {
                const origin = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y);
                const direction = new Phaser.Math.Vector2(pointer.worldX - origin.x, pointer.worldY - origin.y);
                if (direction.lengthSq() === 0) direction.set(1, 0);
                direction.normalize();
                const target = direction.clone().scale(this.shootPreviewLength).add(origin);
                bot.action = { type: 'shoot', direction, distance: 0, target };
                bot.plannedShoot = {
                    type: 'shoot',
                    direction: direction.clone(),
                    distance: 0,
                    target: target.clone()
                };
            }
            this.planDirty = true;
            this.updateUi();
            return;
        }
        // ...existing code...
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
    // Returns the bot and type of indicator hit (move/shoot) if pointer is on an indicator
    private getIndicatorAt(x: number, y: number): { bot: Bot } | undefined {
        // Move indicator: large circle at planned move target
        // Shoot indicator: allow dragging anywhere along the shoot preview line
        const MOVE_RADIUS = 16 * (window.devicePixelRatio || 1);
        // Make shoot endpoint easier to hit on touch/hi-dpi
        const SHOOT_RADIUS = 32 * (window.devicePixelRatio || 1);
        const SHOOT_LINE_TOLERANCE = 18 * (window.devicePixelRatio || 1);
        for (const bot of this.playerBots) {
            if (!bot.isAlive) continue;
            if (bot.selectedMode === 'move' && bot.action.type === 'move' && bot.action.target) {
                const dist = Phaser.Math.Distance.Between(x, y, bot.action.target.x, bot.action.target.y);
                if (dist <= MOVE_RADIUS) {
                    return { bot };
                }
            } else if (bot.selectedMode === 'shoot' && bot.action.type === 'shoot' && bot.action.target && bot.action.direction) {
                // Calculate the actual endpoint as in renderPlans
                const fieldWidth = this.scale.width;
                const fieldHeight = this.scale.height;
                const maxBulletDistance = Math.min(fieldWidth, fieldHeight) / 2;
                const startOffset = 18;
                const direction = bot.action.direction.clone().normalize();
                const start = new Phaser.Math.Vector2(bot.sprite.x, bot.sprite.y).add(direction.clone().scale(startOffset));
                const end = start.clone().add(direction.clone().scale(maxBulletDistance));
                // Check endpoint first
                const endDist = Phaser.Math.Distance.Between(x, y, end.x, end.y);
                if (endDist <= SHOOT_RADIUS) {
                    return { bot };
                }
                // Check if pointer is near the shoot line
                const lineLength = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
                if (lineLength < 1) continue;
                // Project pointer onto line segment
                const toPointer = new Phaser.Math.Vector2(x - start.x, y - start.y);
                const lineDir = new Phaser.Math.Vector2(end.x - start.x, end.y - start.y).normalize();
                const proj = Phaser.Math.Clamp(toPointer.dot(lineDir), 0, lineLength);
                const closest = new Phaser.Math.Vector2(start.x + lineDir.x * proj, start.y + lineDir.y * proj);
                const distToLine = Phaser.Math.Distance.Between(x, y, closest.x, closest.y);
                if (distToLine <= SHOOT_LINE_TOLERANCE) {
                    return { bot };
                }
            }
        }
        return undefined;
    }

    private startRound() {
        this.isPlanning = false;
        // Revert all player bot sizes to normal at round start
        this.playerBots.forEach((bot) => {
            bot.sprite.setScale(1);
        });
        planAiActions(this.playerBots, this.aiBots, this.barriers!, this.maxMoveDistance, this.shootPreviewLength);
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

    // Removed highlightSelected and updateSelectionRing

    private updateUi() {
        const plannedCount = this.playerBots.filter((bot) => bot.action.type !== 'none').length;
        if (this.infoText) {
            const instructions = [
                `Planned: ${plannedCount}/5`,
                this.isPlanning ? 'Drag from a bot to set move/shoot. Tap bot to switch mode.' : 'Executing round...'
            ];
            this.infoText.setText(instructions);
        }
        if (this.statusEl) {
            this.statusEl.textContent = this.isPlanning
                ? `Planned: ${plannedCount}/5`
                : 'Executing round...';
        }
        if (this.startButton) {
            this.startButton.disabled = !this.isPlanning;
        }
    }

    // Removed selectBot and toggleSelectedMode

    private getPlayerBotAt(x: number, y: number): Bot | undefined {
        // Adapt tap radius for hi-dpi (retina) displays
        const BASE_RADIUS = 64;
        const pixelRatio = window.devicePixelRatio || 1;
        const TAP_RADIUS = Math.max(BASE_RADIUS * pixelRatio, BASE_RADIUS); // Ensure minimum size
        const result = this.playerBots
            .filter(bot => bot.isAlive)
            .reduce<{ bot: Bot | undefined; dist: number }>(
                (acc, bot) => {
                    const dist = Phaser.Math.Distance.Between(x, y, bot.sprite.x, bot.sprite.y);
                    if (dist <= TAP_RADIUS && dist < acc.dist) {
                        return { bot, dist };
                    }
                    return acc;
                },
                { bot: undefined, dist: TAP_RADIUS + 1 }
            );
        return result.bot;
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
    }

    update() {
        if (this.isPlanning) {
            if (this.planDirty) {
                this.renderPlans();
                this.planDirty = false;
            }
        }
    }
}

// Fixed aspect ratio (e.g., 16:9)
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
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
        fullscreenTarget: 'game-container'
    }
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => {
    setTimeout(() => {
        window.scrollTo(0, 0);
    }, 100);
});


