import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';
import { Server } from '../Server.js';
import type { BotPosition, GameState } from '../types.js';
import { ActionPlanner } from '../planning/ActionPlanner.js';
import { PlanInputController } from '../planning/PlanInputController.js';
import { PlanRenderer } from '../planning/PlanRenderer.js';
import { RoundController } from '../game/RoundController.js';
import { BarrierFactory } from '../world/BarrierFactory.js';
import { BotFactory } from '../world/BotFactory.js';
import { BulletSystem, type BulletSprite } from '../world/BulletSystem.js';
import { setupBotCollisions } from '../world/CollisionSetup.js';
import { TextureFactory } from '../world/TextureFactory.js';
import { DomUi } from '../ui/DomUi.js';
import { Hud } from '../ui/Hud.js';

/** Orchestrates all game subsystems. Holds shared state; delegates work. */
export class GameScene extends Phaser.Scene {
    private bots: Bot[] = [];
    private player1Bots: Bot[] = [];
    private player2Bots: Bot[] = [];
    private barriers!: Phaser.Physics.Arcade.StaticGroup;

    private textureFactory!: TextureFactory;
    private barrierFactory!: BarrierFactory;
    private botFactory!: BotFactory;
    private bullets!: BulletSystem;
    private planner!: ActionPlanner;
    private planRenderer!: PlanRenderer;
    private planInput!: PlanInputController;
    private roundController!: RoundController;
    private hud!: Hud;
    private domUi!: DomUi;

    private isPlanning = true;
    private planDirty = true;
    private server?: Server;

    create(): void {
        this.initSystems();
        this.initPhysicsWorld();

        this.hud.create();
        this.planRenderer.create();
        this.planInput.bind();

        this.domUi.bind({
            onWelcomeStart: () => this.startGame(),
            onStartRound: () => this.attemptStartRound(),
            onToggleFullscreen: () => this.toggleFullscreen(),
        });
        this.domUi.showWelcome();

        this.maybeBootstrapRemoteGame();
    }

    update(): void {
        if (this.isPlanning && this.planDirty) {
            this.planRenderer.render(this.player1Bots);
            this.planDirty = false;
        }
    }

    // --- initialization -----------------------------------------------------

    private initSystems(): void {
        this.textureFactory = new TextureFactory(this);
        this.barrierFactory = new BarrierFactory(this);
        this.botFactory = new BotFactory(this);
        this.bullets = new BulletSystem(this);
        this.planner = new ActionPlanner(
            GameConfig.MAX_MOVE_DISTANCE,
            GameConfig.SHOOT_PREVIEW_LENGTH,
            GameConfig.SNIPER_PREVIEW_LENGTH
        );
        this.planRenderer = new PlanRenderer(this);
        this.roundController = new RoundController(this, this.bullets);
        this.hud = new Hud(this);
        this.domUi = new DomUi();
        this.planInput = new PlanInputController(this, this.planner, {
            isPlanning: () => this.isPlanning,
            getPlayerBots: () => this.player1Bots,
            canStartRound: () => this.domUi.isStartEnabled,
            requestStartRound: () => this.attemptStartRound(),
            onPlanChanged: () => this.markPlanDirty(),
        });
    }

    private initPhysicsWorld(): void {
        this.cameras.main.setBackgroundColor(GameConfig.BACKGROUND_COLOR);
        this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height);
        this.scale.on('resize', (size: Phaser.Structs.Size) => {
            this.physics.world.setBounds(0, 0, size.width, size.height);
        });
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) =>
            this.onWorldBounds(body)
        );
    }

    private onWorldBounds(body: Phaser.Physics.Arcade.Body): void {
        const sprite = body.gameObject as Phaser.Physics.Arcade.Image | undefined;
        if (!sprite) return;
        if (sprite.texture?.key === GameConfig.PARTICLE_TEXTURE) {
            this.bullets.destroyBullet(sprite as BulletSprite);
            return;
        }
        sprite.setVelocity(0, 0);
    }

    // --- game lifecycle -----------------------------------------------------

    private startGame(): void {
        this.domUi.showGameUi();
        this.resetGame();
    }

    private resetGame(): void {
        this.hud.hideWin();
        this.bots.forEach(bot => bot.sprite.destroy());
        this.barriers?.clear(true, true);
        this.planRenderer.clear();
        this.bullets.clearAll();

        this.textureFactory.ensureAllTextures();
        this.barriers = this.barrierFactory.create();

        const { player1, player2 } = this.botFactory.spawnTeams();
        this.player1Bots = player1;
        this.player2Bots = player2;
        this.bots = [...player1, ...player2];

        setupBotCollisions(this, this.bots, this.barriers);
        this.bullets.initialize(this.bots, this.barriers, (bot, bullet) =>
            this.handleBotHit(bot, bullet)
        );

        this.isPlanning = true;
        this.markPlanDirty();
    }

    private attemptStartRound(): void {
        if (!this.isPlanning) return;
        this.isPlanning = false;
        this.planRenderer.clear();
        this.roundController.start({
            playerBots: this.player1Bots,
            aiBots: this.player2Bots,
            allBots: this.bots,
            barriers: this.barriers,
        }, () => this.endRound());
        this.refreshUi();
    }

    private endRound(): void {
        this.isPlanning = true;
        this.markPlanDirty();
    }

    private handleBotHit(bot: Bot, bullet: BulletSprite): void {
        if (!bot.isAlive || !bullet.ownerBot || bullet.ownerBot === bot) return;

        bot.isAlive = false;
        bot.sprite.setVisible(false);
        bot.sprite.disableBody(true, true);
        this.bullets.destroyBullet(bullet);

        this.bots = this.bots.filter(b => b !== bot);
        if (bot.playerId === 1) {
            this.player1Bots = this.player1Bots.filter(b => b !== bot);
        } else {
            this.player2Bots = this.player2Bots.filter(b => b !== bot);
        }
        this.checkWinCondition();
    }

    private checkWinCondition(): void {
        if (this.player2Bots.length === 0) this.endMatch('You win!');
        else if (this.player1Bots.length === 0) this.endMatch('You lose!');
    }

    private endMatch(message: string): void {
        this.hud.showWin(message);
        this.isPlanning = false;
        this.domUi.setStartEnabled(false);
        this.domUi.scheduleWelcomeReplay();
    }

    // --- ui refresh ---------------------------------------------------------

    private markPlanDirty(): void {
        this.planDirty = true;
        this.refreshUi();
    }

    private refreshUi(): void {
        const actionable = this.player1Bots.filter(bot => !bot.isDisabled);
        const plannedCount = actionable.filter(bot => bot.action.type !== 'none').length;
        const disabledCount = this.player1Bots.length - actionable.length;
        const disabledSuffix = disabledCount > 0 ? ` (${disabledCount} reloading)` : '';
        const statusLine = this.isPlanning
            ? `Planned: ${plannedCount}/${actionable.length}${disabledSuffix}`
            : 'Executing round...';
        this.hud.setInfo([
            statusLine,
            this.isPlanning
                ? 'Drag from a bot to set move/shoot/sniper. Tap bot to cycle modes.'
                : 'Executing round...',
        ]);
        this.domUi.setStatus(statusLine);
        this.domUi.setStartEnabled(this.isPlanning);
    }

    private toggleFullscreen(): void {
        if (this.scale.isFullscreen) this.scale.stopFullscreen();
        else this.scale.startFullscreen();
    }

    // --- remote game --------------------------------------------------------

    private async maybeBootstrapRemoteGame(): Promise<void> {
        const params = new URLSearchParams(window.location.search);
        const serverUrl = params.get('server');
        if (!serverUrl) return;

        this.server = new Server(serverUrl);
        const gameId = params.get('gameId');

        if (gameId) {
            await this.server.joinGame(gameId);
            if (this.server.gameState) {
                this.startGame();
                this.applyGameState(this.server.gameState);
            }
            return;
        }

        this.startGame();
        await this.server.startGame(this.barriers, this.player1Bots, this.player2Bots);
    }

    private applyGameState(state: GameState): void {
        const barrierChildren = this.barriers.getChildren();
        if (state.barrierPositions.length !== barrierChildren.length) {
            throw new Error('Game state barrier count does not match current barriers');
        }
        for (let i = 0; i < state.barrierPositions.length; i++) {
            const child = barrierChildren[i] as Phaser.Physics.Arcade.Image;
            const pos = state.barrierPositions[i]!;
            child.setPosition(pos.x, pos.y);
        }
        this.applyTeamPositions(this.player1Bots, state.player1BotPositions);
        this.applyTeamPositions(this.player2Bots, state.player2BotPositions);
    }

    private applyTeamPositions(team: Bot[], states: BotPosition[]): void {
        for (const bot of team) {
            const state = states.find(s => s.botId === bot.id);
            if (!state) {
                bot.isAlive = false;
            } else {
                bot.sprite.setPosition(state.x, state.y);
            }
        }
    }
}
