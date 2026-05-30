import { GameConfig } from './GameConfig.js';
import type { Bot } from './Bot.js';
import type { GameState, NewGameRequest } from './types.js';

export class Server {

    public gameId?: string = undefined;
    public gameState?: GameState = undefined;

    constructor(public readonly url: string) {
    }

    async joinGame(gameId: string) {
        const response = await fetch(`${this.url}/botbrawl/game/state/${gameId}`);
        if (!response.ok) {
            throw new Error(`Failed to join game: ${response.status} ${response.statusText}`);
        }
        this.gameId = gameId;

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

        console.log("Started new game with ID:", this.gameId);
    }
}
