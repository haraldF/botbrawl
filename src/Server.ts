import { GameConfig } from './GameConfig.js';
import type { Bot } from './Bot.js';
import type { BotMove, GameState, GameStateUpdate, Move, NewGameRequest, RoundMovesResponse } from './types.js';

export class Server {

    public gameId?: string = undefined;
    public gameState?: GameState = undefined;
    public playerId: 1 | 2 = 1;

    constructor(public readonly url: string) {
    }

    async joinGame(gameId: string) {
        const response = await fetch(`${this.url}/botbrawl/game/state/${gameId}`);
        if (!response.ok) {
            throw new Error(`Failed to join game: ${response.status} ${response.statusText}`);
        }
        this.gameId = gameId;
        this.playerId = 2;

        console.log("Joined game with ID:", this.gameId);

        this.gameState = await response.json();
    }

    async startGame(barriers: Phaser.Physics.Arcade.StaticGroup, player1Bots: Array<Bot>, player2Bots: Array<Bot>) {
        const barrierPositions = barriers.children.entries.map(barrier => ({
            x: barrier.body!.position.x,
            y: barrier.body!.position.y
        }));

        const player1BotPositions = player1Bots.filter(bot => bot.isAlive).map(bot => ({
            botId: bot.id,
            x: bot.sprite.body!.position.x,
            y: bot.sprite.body!.position.y
        }));
        const player2BotPositions = player2Bots.filter(bot => bot.isAlive).map(bot => ({
            botId: bot.id,
            x: bot.sprite.body!.position.x,
            y: bot.sprite.body!.position.y
        }));

        const newGameRequest: NewGameRequest = {
            clientVersion: GameConfig.CLIENT_VERSION,
            barrierPositions,
            player1BotPositions,
            player2BotPositions,
        }

        const response = await fetch(`${this.url}/botbrawl/game`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newGameRequest)
        });
        if (!response.ok) {
            throw new Error(`Failed to start game: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        this.gameId = data.gameId;
        this.playerId = 1;

        console.log("Started new game with ID:", this.gameId);
    }

    /** Submit this player's moves for the given round. */
    async submitMove(moveId: number, moves: BotMove[]): Promise<void> {
        if (!this.gameId) throw new Error('Cannot submit move: no active game');
        const payload: Move = { playerId: this.playerId, moveId, moves };
        const response = await fetch(`${this.url}/botbrawl/game/move/${this.gameId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Failed to submit move: ${response.status} ${response.statusText}`);
        }
    }

    /**
     * Long-poll until both players have submitted moves for the given round.
     * Retries on timeout (504) until moves are available.
     */
    async waitForRoundMoves(moveId: number): Promise<RoundMovesResponse> {
        if (!this.gameId) throw new Error('Cannot wait for moves: no active game');
        while (true) {
            const response = await fetch(`${this.url}/botbrawl/game/move/${this.gameId}?moveId=${moveId}`);
            if (response.ok) {
                return await response.json();
            }
            if (response.status === 504) {
                // Long-poll timeout, retry.
                continue;
            }
            throw new Error(`Failed to fetch round moves: ${response.status} ${response.statusText}`);
        }
    }

    /** Publish the host's final unit positions for a completed round. */
    async updateGameState(moveId: number, player1Bots: Bot[], player2Bots: Bot[]): Promise<void> {
        if (!this.gameId) throw new Error('Cannot update game state: no active game');
        const payload: GameStateUpdate = {
            playerId: 1,
            moveId,
            player1BotPositions: this.serializeLivePositions(player1Bots),
            player2BotPositions: this.serializeLivePositions(player2Bots),
        };
        const response = await fetch(`${this.url}/botbrawl/game/state/${this.gameId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Failed to update game state: ${response.status} ${response.statusText}`);
        }
    }

    /** Long-poll until the host publishes state after the given completed round. */
    async waitForGameState(moveId: number): Promise<GameState> {
        if (!this.gameId) throw new Error('Cannot wait for game state: no active game');
        while (true) {
            const response = await fetch(
                `${this.url}/botbrawl/game/state/${this.gameId}?stateMoveId=${moveId}`
            );
            if (response.ok) {
                return await response.json();
            }
            if (response.status === 504) {
                continue;
            }
            throw new Error(`Failed to fetch game state: ${response.status} ${response.statusText}`);
        }
    }

    private serializeLivePositions(bots: Bot[]) {
        return bots.filter(bot => bot.isAlive).map(bot => ({
            botId: bot.id,
            x: bot.sprite.x,
            y: bot.sprite.y,
        }));
    }
}

