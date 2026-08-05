import type { Bot } from '../Bot.js';
import { GameConfig } from '../GameConfig.js';
import { Server } from '../Server.js';
import type { BotMove, BotPosition, GameState } from '../types.js';
import { ActionPlanner } from '../planning/ActionPlanner.js';
import { PlanInputController } from '../planning/PlanInputController.js';
import { PlanRenderer } from '../planning/PlanRenderer.js';
import { RoundController } from '../game/RoundController.js';
import { BarrierFactory } from '../world/BarrierFactory.js';
import { BotFactory } from '../world/BotFactory.js';
import { BulletSystem, type BulletSprite } from '../world/BulletSystem.js';
import { setupBotCollisions } from '../world/CollisionSetup.js';
import { TextureFactory } from '../world/TextureFactory.js';
import { DomUi, type LobbyChoice } from '../ui/DomUi.js';
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
    private selfPlayerId: 1 | 2 = 1;
    private nextMoveId = 0;

    create(): void {
        this.initSystems();
        this.initPhysicsWorld();

        this.hud.create();
        this.planRenderer.create();
        this.planInput.bind();

        this.domUi.bind({
            onWelcomeStart: () => this.startSinglePlayer(),
            onStartRound: () => this.attemptStartRound(),
            onToggleFullscreen: () => this.toggleFullscreen(),
            onLobbyChoice: choice => this.handleLobbyChoice(choice),
        });
        this.domUi.showWelcome();

        this.maybeBootstrapFromUrl();
    }

    update(): void {
        if (this.isPlanning && this.planDirty) {
            this.planRenderer.render(this.getSelfBots());
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
            getPlayerBots: () => this.getSelfBots(),
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

    private startSinglePlayer(): void {
        delete this.server;
        this.selfPlayerId = 1;
        this.nextMoveId = 0;
        this.startGame();
    }

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
        if (this.server) {
            this.runMultiplayerRound().catch(error => {
                console.error('Multiplayer round failed:', error);
                this.hud.setInfo(['Network error: ' + (error?.message ?? error)]);
                this.isPlanning = true;
                this.markPlanDirty();
            });
        } else {
            this.roundController.start({
                playerBots: this.player1Bots,
                aiBots: this.player2Bots,
                allBots: this.bots,
                barriers: this.barriers,
            }, () => this.endRound());
        }
        this.refreshUi();
    }

    private async runMultiplayerRound(): Promise<void> {
        const server = this.server!;
        const selfBots = this.getSelfBots();
        const opponentBots = this.getOpponentBots();
        const moveId = this.nextMoveId;

        const myMoves = selfBots.map(serializeBotAction);
        this.hud.setInfo(['Waiting for opponent...']);
        this.domUi.setStatus('Waiting for opponent...');

        await server.submitMove(moveId, myMoves);
        const roundMoves = await server.waitForRoundMoves(moveId);

        const opponentMove = this.selfPlayerId === 1 ? roundMoves.player2Move : roundMoves.player1Move;
        applyMovesToBots(opponentBots, opponentMove.moves);

        this.nextMoveId = moveId + 1;

        this.roundController.start({
            playerBots: selfBots,
            aiBots: opponentBots,
            allBots: this.bots,
            barriers: this.barriers,
            planOpponentActions: () => { /* already applied from remote */ },
        }, () => {
            this.syncMultiplayerRound(moveId).catch(error => {
                console.error('Multiplayer state sync failed:', error);
                this.hud.setInfo(['Network error: ' + (error?.message ?? error)]);
                this.isPlanning = true;
                this.markPlanDirty();
            });
        });
        this.refreshUi();
    }

    private async syncMultiplayerRound(moveId: number): Promise<void> {
        const server = this.server!;
        if (this.selfPlayerId === 1) {
            await server.updateGameState(moveId, this.player1Bots, this.player2Bots);
        } else {
            const state = await server.waitForGameState(moveId);
            this.applyGameState(state);
        }
        this.endRound();
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
        const selfTeam = this.getSelfBots();
        const opponentTeam = this.getOpponentBots();
        if (opponentTeam.length === 0 && selfTeam.length === 0) this.endMatch('Draw!');
        else if (opponentTeam.length === 0) this.endMatch('You win!');
        else if (selfTeam.length === 0) this.endMatch('You lose!');
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
        const selfBots = this.getSelfBots();
        const actionable = selfBots.filter(bot => !bot.isDisabled);
        const plannedCount = actionable.filter(bot => bot.action.type !== 'none').length;
        const disabledCount = selfBots.length - actionable.length;
        const disabledSuffix = disabledCount > 0 ? ` (${disabledCount} reloading)` : '';
        const statusLine = this.isPlanning
            ? `Planned: ${plannedCount}/${actionable.length}${disabledSuffix}`
            : (this.server ? 'Waiting for opponent...' : 'Executing round...');
        this.hud.setInfo([
            statusLine,
            this.isPlanning
                ? 'Drag from a bot to set move/shoot/sniper. Tap bot to cycle modes.'
                : statusLine,
        ]);
        this.domUi.setStatus(statusLine);
        this.domUi.setStartEnabled(this.isPlanning);
    }

    private toggleFullscreen(): void {
        if (this.scale.isFullscreen) this.scale.stopFullscreen();
        else this.scale.startFullscreen();
    }

    // --- multiplayer --------------------------------------------------------

    private getSelfBots(): Bot[] {
        return this.selfPlayerId === 1 ? this.player1Bots : this.player2Bots;
    }

    private getOpponentBots(): Bot[] {
        return this.selfPlayerId === 1 ? this.player2Bots : this.player1Bots;
    }

    private async maybeBootstrapFromUrl(): Promise<void> {
        const params = new URLSearchParams(window.location.search);
        const serverUrl = params.get('server');
        if (!serverUrl) return;

        const gameId = params.get('gameId');
        try {
            if (gameId) {
                await this.joinMultiplayer(serverUrl, gameId);
            } else {
                await this.createMultiplayer(serverUrl);
            }
        } catch (error) {
            console.error('Failed to bootstrap multiplayer from URL:', error);
            this.domUi.setLobbyError(error instanceof Error ? error.message : String(error));
        }
    }

    private handleLobbyChoice(choice: LobbyChoice): void {
        const action = choice.action === 'create'
            ? this.createMultiplayer(choice.serverUrl)
            : this.joinMultiplayer(choice.serverUrl, choice.gameId!);
        action.catch(error => {
            console.error('Multiplayer setup failed:', error);
            this.domUi.setLobbyError(error instanceof Error ? error.message : String(error));
        });
    }

    private async createMultiplayer(serverUrl: string): Promise<void> {
        this.domUi.setLobbyBusy('Creating game...');
        this.domUi.showCreateSpinner(true);
        try {
            this.server = new Server(serverUrl);
            this.selfPlayerId = 1;
            this.nextMoveId = 0;
            // Prepare game state, but do not show game UI yet
            this.resetGame();
            await this.server.startGame(this.barriers, this.player1Bots, this.player2Bots);
            this.domUi.showGameUi();
            const shareUrl = this.buildShareUrl(serverUrl, this.server.gameId!);
            this.domUi.showShareLink(shareUrl);
        } finally {
            this.domUi.showCreateSpinner(false);
        }
    }

    private async joinMultiplayer(serverUrl: string, gameId: string): Promise<void> {
        this.domUi.setLobbyBusy('Joining game...');
        this.server = new Server(serverUrl);
        await this.server.joinGame(gameId);
        if (!this.server.gameState) {
            throw new Error('Joined game has no state');
        }
        this.selfPlayerId = 2;
        this.nextMoveId = this.server.gameState.moveId;
        this.startGame();
        this.applyGameState(this.server.gameState);
        this.markPlanDirty();
    }

    private buildShareUrl(serverUrl: string, gameId: string): string {
        const url = new URL(window.location.href);
        url.searchParams.set('server', serverUrl);
        url.searchParams.set('gameId', gameId);
        return url.toString();
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
            child.refreshBody();
        }
        this.player1Bots = this.applyTeamPositions(this.player1Bots, state.player1BotPositions);
        this.player2Bots = this.applyTeamPositions(this.player2Bots, state.player2BotPositions);
        this.bots = [...this.player1Bots, ...this.player2Bots];
    }

    private applyTeamPositions(team: Bot[], states: BotPosition[]): Bot[] {
        return team.filter(bot => {
            const state = states.find(s => s.botId === bot.id);
            if (!state) {
                bot.isAlive = false;
                bot.sprite.setVisible(false);
                bot.sprite.disableBody(true, true);
                return false;
            } else {
                bot.sprite.setPosition(state.x, state.y);
                bot.sprite.body?.reset(state.x, state.y);
                return true;
            }
        });
    }
}

/** Pack a bot's currently-planned action as a wire-format BotMove. */
function serializeBotAction(bot: Bot): BotMove {
    const action = bot.action;
    const mode = bot.isDisabled ? 'none' : action.type;
    const direction = action.direction;
    return {
        botId: bot.id,
        mode,
        directionX: direction.x,
        directionY: direction.y,
        distance: action.distance,
    };
}

/** Apply a list of remote BotMoves to the matching bots in `bots`. */
function applyMovesToBots(bots: Bot[], moves: BotMove[]): void {
    for (const bot of bots) {
        if (!bot.isAlive || bot.isDisabled) continue;
        const move = moves.find(m => m.botId === bot.id);
        if (!move || move.mode === 'none') {
            bot.action = {
                type: 'none',
                direction: new Phaser.Math.Vector2(1, 0),
                distance: 0,
            };
            continue;
        }
        const direction = new Phaser.Math.Vector2(move.directionX, move.directionY);
        if (direction.lengthSq() === 0) direction.set(1, 0);
        direction.normalize();
        bot.action = {
            type: move.mode,
            direction,
            distance: move.distance,
        };
    }
}
